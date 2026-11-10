//! Input validation and normalization.

use crate::error::FieldErrors;

pub fn username(errors: &mut FieldErrors, v: &str) {
    let ok_chars = v
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'.');
    if !(2..=32).contains(&v.len()) {
        errors.insert("username", "USERNAME_LENGTH");
    } else if !ok_chars {
        errors.insert("username", "USERNAME_INVALID_CHARS");
    } else if v.contains("..") {
        errors.insert("username", "USERNAME_CONSECUTIVE_DOTS");
    }
}

pub fn email(errors: &mut FieldErrors, v: &str) {
    let valid = v.len() <= 254
        && v.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        })
        && !v.contains(char::is_whitespace);
    if !valid {
        errors.insert("email", "EMAIL_INVALID");
    }
}

pub fn password(errors: &mut FieldErrors, v: &str) {
    if v.chars().count() < 8 {
        errors.insert("password", "PASSWORD_TOO_SHORT");
    } else if v.len() > 128 {
        errors.insert("password", "PASSWORD_TOO_LONG");
    }
}

/// Trims and checks a free-text field; returns `None` for empty input.
pub fn text(
    errors: &mut FieldErrors,
    field: &'static str,
    v: &str,
    max_chars: usize,
) -> Option<String> {
    let t = v.trim();
    if t.chars().count() > max_chars {
        errors.insert(field, "TOO_LONG");
    }
    (!t.is_empty()).then(|| t.to_owned())
}

pub fn guild_name(errors: &mut FieldErrors, v: &str) -> String {
    let t = v.trim();
    if !(2..=100).contains(&t.chars().count()) {
        errors.insert("name", "GUILD_NAME_LENGTH");
    }
    t.to_owned()
}

/// Text channel names are lowercase with dashes; other channel types keep their casing.
pub fn channel_name(errors: &mut FieldErrors, v: &str, text_channel: bool) -> String {
    let name: String = if text_channel {
        let mut out = String::new();
        for c in v.trim().chars().flat_map(char::to_lowercase) {
            if c.is_whitespace() || c == '-' {
                if !out.ends_with('-') && !out.is_empty() {
                    out.push('-');
                }
            } else if c.is_alphanumeric() || c == '_' || (!c.is_ascii() && !c.is_control()) {
                out.push(c);
            }
        }
        out.trim_end_matches('-').to_owned()
    } else {
        v.trim().to_owned()
    };
    if !(1..=100).contains(&name.chars().count()) {
        errors.insert("name", "CHANNEL_NAME_LENGTH");
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usernames() {
        let check = |v: &str| {
            let mut e = FieldErrors::new();
            username(&mut e, v);
            e.get("username").copied()
        };
        assert_eq!(check("alice_01"), None);
        assert_eq!(check("a"), Some("USERNAME_LENGTH"));
        assert_eq!(check("Alice"), Some("USERNAME_INVALID_CHARS"));
        assert_eq!(check("a..b"), Some("USERNAME_CONSECUTIVE_DOTS"));
    }

    #[test]
    fn emails() {
        let check = |v: &str| {
            let mut e = FieldErrors::new();
            email(&mut e, v);
            e.is_empty()
        };
        assert!(check("a@b.de"));
        assert!(!check("a@b"));
        assert!(!check("@b.de"));
        assert!(!check("a b@c.de"));
    }

    #[test]
    fn channel_names() {
        let mut e = FieldErrors::new();
        assert_eq!(
            channel_name(&mut e, "  Hello  World--Chat ", true),
            "hello-world-chat"
        );
        assert_eq!(channel_name(&mut e, "Größe & Spaß!", true), "größe-spaß");
        assert_eq!(channel_name(&mut e, " Lobby 1 ", false), "Lobby 1");
        assert!(e.is_empty());
        channel_name(&mut e, "!!!", true);
        assert_eq!(e.get("name"), Some(&"CHANNEL_NAME_LENGTH"));
    }
}
