//! Opaque session tokens (`<session id>.<secret>`) and HMAC-signed MFA tickets.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};

pub struct NewToken {
    pub token: String,
    pub hash: Vec<u8>,
}

pub fn new_session_token(session_id: i64) -> NewToken {
    let mut secret = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut secret);
    NewToken {
        token: format!(
            "{}.{}",
            B64.encode(session_id.to_string()),
            B64.encode(secret)
        ),
        hash: Sha256::digest(secret).to_vec(),
    }
}

/// Splits a token into (session id, sha256(secret)).
pub fn parse_session_token(token: &str) -> Option<(i64, Vec<u8>)> {
    let token = token.strip_prefix("Bearer ").unwrap_or(token).trim();
    let (id, secret) = token.split_once('.')?;
    let id: i64 = String::from_utf8(B64.decode(id).ok()?).ok()?.parse().ok()?;
    let secret = B64.decode(secret).ok()?;
    if secret.len() != 32 {
        return None;
    }
    Some((id, Sha256::digest(&secret).to_vec()))
}

pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn sign(key: &[u8], payload: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(payload.as_bytes());
    B64.encode(mac.finalize().into_bytes())
}

/// Ticket proving that the password step of a MFA login succeeded.
pub fn mfa_ticket(key: &[u8], user_id: i64, now: i64) -> String {
    let payload = format!("mfa.{user_id}.{}", now + 300);
    let sig = sign(key, &payload);
    format!("{}.{sig}", B64.encode(payload))
}

pub fn verify_mfa_ticket(key: &[u8], ticket: &str, now: i64) -> Option<i64> {
    let (payload, sig) = ticket.split_once('.')?;
    let payload = String::from_utf8(B64.decode(payload).ok()?).ok()?;
    if !constant_time_eq(sign(key, &payload).as_bytes(), sig.as_bytes()) {
        return None;
    }
    let mut parts = payload.split('.');
    (parts.next()? == "mfa").then_some(())?;
    let user_id: i64 = parts.next()?.parse().ok()?;
    let exp: i64 = parts.next()?.parse().ok()?;
    (exp >= now).then_some(user_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_token_roundtrip() {
        let t = new_session_token(987654321);
        let (id, hash) = parse_session_token(&t.token).unwrap();
        assert_eq!(id, 987654321);
        assert!(constant_time_eq(&hash, &t.hash));
        assert!(parse_session_token(&format!("Bearer {}", t.token)).is_some());
        assert!(parse_session_token("garbage").is_none());
        assert!(parse_session_token("a.b").is_none());
    }

    #[test]
    fn mfa_ticket_validation() {
        let key = b"k".repeat(32);
        let t = mfa_ticket(&key, 42, 1000);
        assert_eq!(verify_mfa_ticket(&key, &t, 1000), Some(42));
        assert_eq!(verify_mfa_ticket(&key, &t, 1301), None, "expired");
        assert_eq!(
            verify_mfa_ticket(b"other-key-other-key-other-key-00", &t, 1000),
            None
        );
        let mut tampered = t.clone();
        tampered.replace_range(0..1, if t.starts_with('a') { "b" } else { "a" });
        assert_eq!(verify_mfa_ticket(&key, &tampered, 1000), None);
    }
}
