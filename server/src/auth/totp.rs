//! RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s period) with RFC 4648 base32 secrets.

use hmac::{Hmac, Mac};
use rand::RngCore;
use sha1::Sha1;

pub const PERIOD: u64 = 30;
const DIGITS: u32 = 6;
const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn generate_secret() -> String {
    let mut bytes = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut bytes);
    base32_encode(&bytes)
}

pub fn base32_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(5) * 8);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for &b in data {
        buffer = (buffer << 8) | u32::from(b);
        bits += 8;
        while bits >= 5 {
            out.push(ALPHABET[((buffer >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

pub fn base32_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() * 5 / 8);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for c in s.bytes().filter(|c| *c != b'=' && *c != b' ') {
        let v = ALPHABET.iter().position(|a| *a == c.to_ascii_uppercase())? as u32;
        buffer = (buffer << 5) | v;
        bits += 5;
        if bits >= 8 {
            out.push((buffer >> (bits - 8)) as u8);
            bits -= 8;
        }
    }
    Some(out)
}

/// HOTP value for a counter (RFC 4226).
pub fn hotp(key: &[u8], counter: u64, digits: u32) -> u32 {
    let mut mac = Hmac::<Sha1>::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(&counter.to_be_bytes());
    let h = mac.finalize().into_bytes();
    let offset = (h[h.len() - 1] & 0x0f) as usize;
    let bin = u32::from_be_bytes([
        h[offset] & 0x7f,
        h[offset + 1],
        h[offset + 2],
        h[offset + 3],
    ]);
    bin % 10u32.pow(digits)
}

pub fn current_step() -> u64 {
    chrono::Utc::now().timestamp() as u64 / PERIOD
}

/// Verifies `code` against the secret with a ±1 step window.
/// Returns the matched time step so callers can reject replays.
pub fn verify(secret_b32: &str, code: &str, now_step: u64) -> Option<u64> {
    let code = code.trim().replace(' ', "");
    if code.len() != DIGITS as usize || !code.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let code: u32 = code.parse().ok()?;
    let key = base32_decode(secret_b32)?;
    [now_step.saturating_sub(1), now_step, now_step + 1]
        .into_iter()
        .find(|step| hotp(&key, *step, DIGITS) == code)
}

pub fn otpauth_uri(secret: &str, account: &str) -> String {
    let enc = |s: &str| {
        s.bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() {
                    (b as char).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect::<String>()
    };
    format!(
        "otpauth://totp/dcPoint:{}?secret={secret}&issuer=dcPoint&algorithm=SHA1&digits=6&period=30",
        enc(account)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc6238_sha1_vectors() {
        let key = b"12345678901234567890";
        // (unix time, expected 8-digit code)
        for (t, expected) in [
            (59u64, 94287082u32),
            (1111111109, 7081804),
            (1111111111, 14050471),
            (1234567890, 89005924),
            (2000000000, 69279037),
        ] {
            assert_eq!(hotp(key, t / PERIOD, 8), expected, "t={t}");
        }
    }

    #[test]
    fn base32_roundtrip() {
        assert_eq!(base32_encode(b"foobar"), "MZXW6YTBOI");
        assert_eq!(base32_decode("MZXW6YTBOI").unwrap(), b"foobar");
        let s = generate_secret();
        assert_eq!(s.len(), 32);
        assert_eq!(base32_decode(&s).unwrap().len(), 20);
        assert!(base32_decode("not base32!").is_none());
    }

    #[test]
    fn verify_window() {
        let secret = generate_secret();
        let key = base32_decode(&secret).unwrap();
        let step = 1_000_000;
        let code = format!("{:06}", hotp(&key, step, 6));
        assert_eq!(verify(&secret, &code, step), Some(step));
        assert_eq!(verify(&secret, &code, step + 1), Some(step));
        assert_eq!(verify(&secret, &code, step - 1), Some(step));
        assert_eq!(verify(&secret, &code, step + 2), None);
        assert_eq!(verify(&secret, "12345", step), None);
        assert_eq!(verify(&secret, "abcdef", step), None);
    }
}
