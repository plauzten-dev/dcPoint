//! In-process gateway hub: sessions, guild subscriptions, sequencing and replay buffers.

use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use rand::RngCore;
use tokio::sync::mpsc::UnboundedSender;

/// Events kept per session for RESUME.
pub const BUFFER_CAP: usize = 2048;
/// How long a disconnected session can be resumed.
pub const RESUME_WINDOW: Duration = Duration::from_secs(120);

pub type Frame = Arc<str>;

#[derive(Debug)]
pub enum Outbound {
    Frame(Frame),
    Close(u16, &'static str),
}

pub type Sender = UnboundedSender<Outbound>;

struct Session {
    user_id: i64,
    auth_session: i64,
    seq: u64,
    buffer: VecDeque<(u64, Frame)>,
    tx: Option<Sender>,
    disconnected_at: Option<Instant>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ResumeError {
    UnknownSession,
    /// Requested events are no longer buffered.
    Gap,
}

#[derive(Default)]
pub struct Hub {
    sessions: DashMap<String, Arc<Mutex<Session>>>,
    user_sessions: DashMap<i64, HashSet<String>>,
    guild_users: DashMap<i64, HashSet<i64>>,
    user_guilds: DashMap<i64, HashSet<i64>>,
}

fn lock(s: &Mutex<Session>) -> MutexGuard<'_, Session> {
    s.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn dispatch_frame(event: &str, seq: u64, data: &str) -> Frame {
    format!(r#"{{"op":0,"t":"{event}","s":{seq},"d":{data}}}"#).into()
}

impl Hub {
    fn session(&self, id: &str) -> Option<Arc<Mutex<Session>>> {
        self.sessions.get(id).map(|s| s.clone())
    }

    fn session_ids(&self, user_id: i64) -> Vec<String> {
        self.user_sessions
            .get(&user_id)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn is_online(&self, user_id: i64) -> bool {
        self.session_ids(user_id)
            .iter()
            .filter_map(|id| self.session(id))
            .any(|s| lock(&s).tx.is_some())
    }

    /// Registers a new session that buffers events until [`Hub::attach`] is called.
    pub fn create_session(&self, user_id: i64, auth_session: i64, guild_ids: &[i64]) -> String {
        let mut raw = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut raw);
        let id: String = raw.iter().map(|b| format!("{b:02x}")).collect();
        self.sessions.insert(
            id.clone(),
            Arc::new(Mutex::new(Session {
                user_id,
                auth_session,
                seq: 0,
                buffer: VecDeque::new(),
                tx: None,
                disconnected_at: None,
            })),
        );
        self.user_sessions
            .entry(user_id)
            .or_default()
            .insert(id.clone());
        for g in guild_ids {
            self.subscribe(user_id, *g);
        }
        id
    }

    /// Sends READY followed by everything buffered meanwhile, then goes live.
    /// Returns true when the user just came online.
    pub fn attach(&self, session_id: &str, tx: Sender, ready: Frame) -> bool {
        let Some(s) = self.session(session_id) else {
            return false;
        };
        let user_id = lock(&s).user_id;
        let was_online = self.is_online(user_id);
        let mut s = lock(&s);
        let _ = tx.send(Outbound::Frame(ready));
        for (_, frame) in &s.buffer {
            let _ = tx.send(Outbound::Frame(frame.clone()));
        }
        s.tx = Some(tx);
        s.disconnected_at = None;
        !was_online
    }

    /// Re-attaches a connection to an existing session and replays missed events.
    /// Returns whether the user just came online.
    pub fn resume(
        &self,
        session_id: &str,
        user_id: i64,
        last_seq: u64,
        tx: Sender,
    ) -> Result<bool, ResumeError> {
        let s = self
            .session(session_id)
            .ok_or(ResumeError::UnknownSession)?;
        if lock(&s).user_id != user_id {
            return Err(ResumeError::UnknownSession);
        }
        let was_online = self.is_online(user_id);
        let mut s = lock(&s);
        if last_seq > s.seq
            || s.buffer
                .front()
                .is_some_and(|(first, _)| *first > last_seq + 1)
        {
            return Err(ResumeError::Gap);
        }
        if let Some(old) = s.tx.take() {
            let _ = old.send(Outbound::Close(4000, "session resumed elsewhere"));
        }
        let _ = tx.send(Outbound::Frame(dispatch_frame("RESUMED", s.seq, "{}")));
        for (seq, frame) in &s.buffer {
            if *seq > last_seq {
                let _ = tx.send(Outbound::Frame(frame.clone()));
            }
        }
        s.tx = Some(tx);
        s.disconnected_at = None;
        Ok(!was_online)
    }

    /// Marks the session as disconnected (if `tx` is still its connection).
    /// Returns true when the user just went offline.
    pub fn detach(&self, session_id: &str, tx: &Sender) -> bool {
        let Some(s) = self.session(session_id) else {
            return false;
        };
        let user_id = {
            let mut s = lock(&s);
            if !s.tx.as_ref().is_some_and(|t| t.same_channel(tx)) {
                return false;
            }
            s.tx = None;
            s.disconnected_at = Some(Instant::now());
            s.user_id
        };
        !self.is_online(user_id)
    }

    /// Immediately terminates all gateway sessions of an auth session (logout).
    pub fn kill_auth_session(&self, user_id: i64, auth_session: i64) {
        for id in self.session_ids(user_id) {
            if let Some(s) = self.session(&id) {
                let mut s = lock(&s);
                if s.auth_session == auth_session {
                    if let Some(tx) = s.tx.take() {
                        let _ = tx.send(Outbound::Close(4004, "authentication failed"));
                    }
                    s.disconnected_at = Some(Instant::now() - RESUME_WINDOW);
                }
            }
        }
    }

    pub fn dispatch<I: IntoIterator<Item = i64>>(&self, users: I, event: &str, data: &str) {
        for user in users {
            for id in self.session_ids(user) {
                let Some(s) = self.session(&id) else { continue };
                let mut s = lock(&s);
                s.seq += 1;
                let frame = dispatch_frame(event, s.seq, data);
                if s.buffer.len() >= BUFFER_CAP {
                    s.buffer.pop_front();
                }
                let seq = s.seq;
                s.buffer.push_back((seq, frame.clone()));
                if let Some(tx) = &s.tx
                    && tx.send(Outbound::Frame(frame)).is_err()
                {
                    s.tx = None;
                    s.disconnected_at = Some(Instant::now());
                }
            }
        }
    }

    pub fn subscribe(&self, user_id: i64, guild_id: i64) {
        if !self.user_sessions.contains_key(&user_id) {
            return; // not connected: nothing to deliver
        }
        self.guild_users
            .entry(guild_id)
            .or_default()
            .insert(user_id);
        self.user_guilds
            .entry(user_id)
            .or_default()
            .insert(guild_id);
    }

    pub fn unsubscribe(&self, user_id: i64, guild_id: i64) {
        if let Some(mut set) = self.guild_users.get_mut(&guild_id) {
            set.remove(&user_id);
        }
        if let Some(mut set) = self.user_guilds.get_mut(&user_id) {
            set.remove(&guild_id);
        }
    }

    pub fn remove_guild(&self, guild_id: i64) {
        if let Some((_, users)) = self.guild_users.remove(&guild_id) {
            for u in users {
                if let Some(mut set) = self.user_guilds.get_mut(&u) {
                    set.remove(&guild_id);
                }
            }
        }
    }

    /// Connected users subscribed to a guild.
    pub fn guild_users(&self, guild_id: i64) -> Vec<i64> {
        self.guild_users
            .get(&guild_id)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Connected users sharing at least one guild with `user_id` (excluding the user).
    pub fn co_members(&self, user_id: i64) -> HashSet<i64> {
        let guilds: Vec<i64> = self
            .user_guilds
            .get(&user_id)
            .map(|s| s.iter().copied().collect())
            .unwrap_or_default();
        let mut out = HashSet::new();
        for g in guilds {
            if let Some(users) = self.guild_users.get(&g) {
                out.extend(users.iter().copied());
            }
        }
        out.remove(&user_id);
        out
    }

    /// Drops sessions whose resume window expired.
    pub fn reap(&self) {
        let expired: Vec<(String, i64)> = self
            .sessions
            .iter()
            .filter_map(|e| {
                let s = lock(e.value());
                s.disconnected_at
                    .filter(|d| d.elapsed() >= RESUME_WINDOW)
                    .map(|_| (e.key().clone(), s.user_id))
            })
            .collect();
        for (id, user_id) in expired {
            self.sessions.remove(&id);
            let empty = match self.user_sessions.get_mut(&user_id) {
                Some(mut set) => {
                    set.remove(&id);
                    set.is_empty()
                }
                None => true,
            };
            if empty {
                self.user_sessions.remove_if(&user_id, |_, s| s.is_empty());
                if let Some((_, guilds)) = self.user_guilds.remove(&user_id) {
                    for g in guilds {
                        if let Some(mut set) = self.guild_users.get_mut(&g) {
                            set.remove(&user_id);
                        }
                    }
                }
            }
        }
        self.guild_users.retain(|_, users| !users.is_empty());
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

    fn drain(rx: &mut UnboundedReceiver<Outbound>) -> Vec<String> {
        let mut out = vec![];
        while let Ok(Outbound::Frame(f)) = rx.try_recv() {
            out.push(f.to_string());
        }
        out
    }

    #[test]
    fn buffers_until_ready_then_flushes_in_order() {
        let hub = Hub::default();
        let sid = hub.create_session(1, 10, &[100]);
        hub.dispatch(hub.guild_users(100), "A", "1");
        let (tx, mut rx) = unbounded_channel();
        assert!(hub.attach(&sid, tx, "READY".into()));
        hub.dispatch([1], "B", "2");
        let frames = drain(&mut rx);
        assert_eq!(frames[0], "READY");
        assert!(frames[1].contains(r#""t":"A","s":1"#));
        assert!(frames[2].contains(r#""t":"B","s":2"#));
        assert!(hub.is_online(1));
    }

    #[test]
    fn resume_replays_missed_events() {
        let hub = Hub::default();
        let sid = hub.create_session(1, 10, &[]);
        let (tx, _rx) = unbounded_channel();
        hub.attach(&sid, tx.clone(), "READY".into());
        hub.dispatch([1], "E", "1");
        assert!(hub.detach(&sid, &tx), "went offline");
        assert!(!hub.is_online(1));
        hub.dispatch([1], "E", "2");
        hub.dispatch([1], "E", "3");
        let (tx2, mut rx2) = unbounded_channel();
        assert_eq!(
            hub.resume(&sid, 2, 1, tx2.clone()),
            Err(ResumeError::UnknownSession),
            "wrong user"
        );
        assert_eq!(hub.resume(&sid, 1, 1, tx2), Ok(true));
        let frames = drain(&mut rx2);
        assert_eq!(frames.len(), 3);
        assert!(frames[0].contains("RESUMED"));
        assert!(frames[1].contains(r#""s":2"#));
        assert!(frames[2].contains(r#""s":3"#));
    }

    #[test]
    fn resume_fails_when_buffer_overflowed() {
        let hub = Hub::default();
        let sid = hub.create_session(1, 10, &[]);
        for _ in 0..BUFFER_CAP + 5 {
            hub.dispatch([1], "E", "0");
        }
        let (tx, _rx) = unbounded_channel();
        assert_eq!(hub.resume(&sid, 1, 1, tx), Err(ResumeError::Gap));
    }

    #[test]
    fn subscriptions_and_co_members() {
        let hub = Hub::default();
        hub.create_session(1, 10, &[100, 200]);
        hub.create_session(2, 11, &[100]);
        hub.create_session(3, 12, &[300]);
        hub.subscribe(9, 100); // not connected: ignored
        assert_eq!(hub.co_members(1), HashSet::from([2]));
        let mut users = hub.guild_users(100);
        users.sort();
        assert_eq!(users, vec![1, 2]);
        hub.unsubscribe(2, 100);
        assert!(hub.co_members(1).is_empty());
        hub.remove_guild(200);
        assert!(hub.guild_users(200).is_empty());
    }

    #[test]
    fn reap_removes_expired_sessions() {
        let hub = Hub::default();
        let sid = hub.create_session(1, 10, &[100]);
        let (tx, _rx) = unbounded_channel();
        hub.attach(&sid, tx.clone(), "R".into());
        hub.kill_auth_session(1, 10);
        hub.reap();
        assert_eq!(hub.session_count(), 0);
        assert!(hub.guild_users(100).is_empty());
    }
}
