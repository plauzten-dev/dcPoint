//! 64-bit snowflake IDs: 42 bits milliseconds since `EPOCH`, 10 bits worker, 12 bits sequence.
//! IDs are serialized as strings in JSON so JavaScript clients never lose precision.

use std::fmt;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// 2025-01-01T00:00:00Z in Unix milliseconds.
pub const EPOCH: u64 = 1_735_689_600_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, sqlx::Type)]
#[sqlx(transparent)]
pub struct Id(pub i64);

impl Id {
    /// Unix timestamp (ms) encoded in the ID.
    pub fn timestamp_ms(self) -> u64 {
        ((self.0 as u64) >> 22) + EPOCH
    }
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl From<i64> for Id {
    fn from(v: i64) -> Self {
        Id(v)
    }
}

impl Serialize for Id {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl Visitor<'_> for V {
            type Value = Id;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a snowflake id as string or integer")
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Id, E> {
                v.parse::<i64>()
                    .map(Id)
                    .map_err(|_| E::custom("invalid snowflake"))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Id, E> {
                Ok(Id(v))
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Id, E> {
                i64::try_from(v)
                    .map(Id)
                    .map_err(|_| E::custom("snowflake out of range"))
            }
        }
        d.deserialize_any(V)
    }
}

pub struct SnowflakeGen {
    worker: u64,
    state: Mutex<(u64, u64)>, // (last_ms, sequence)
}

impl SnowflakeGen {
    pub fn new(worker: u16) -> Self {
        Self {
            worker: u64::from(worker & 0x3ff),
            state: Mutex::new((0, 0)),
        }
    }

    pub fn next(&self) -> Id {
        let mut st = self.state.lock().expect("snowflake mutex poisoned");
        let mut now = now_ms();
        if now < st.0 {
            now = st.0; // clock went backwards: keep monotonic
        }
        if now == st.0 {
            st.1 = (st.1 + 1) & 0xfff;
            if st.1 == 0 {
                // sequence exhausted in this millisecond: borrow the next one
                now += 1;
            }
        } else {
            st.1 = 0;
        }
        st.0 = now;
        Id((((now - EPOCH) << 22) | (self.worker << 12) | st.1) as i64)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(EPOCH)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn ids_are_unique_and_monotonic() {
        let g = SnowflakeGen::new(3);
        let mut last = Id(0);
        let mut seen = HashSet::new();
        for _ in 0..50_000 {
            let id = g.next();
            assert!(id > last);
            assert!(seen.insert(id));
            last = id;
        }
        assert!(last.timestamp_ms() >= EPOCH);
    }

    #[test]
    fn serde_roundtrip_as_string() {
        let id = Id(1234567890123456789);
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "\"1234567890123456789\"");
        assert_eq!(serde_json::from_str::<Id>(&json).unwrap(), id);
        assert_eq!(serde_json::from_str::<Id>("42").unwrap(), Id(42));
        assert!(serde_json::from_str::<Id>("\"abc\"").is_err());
    }
}
