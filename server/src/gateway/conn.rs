//! A single gateway WebSocket connection.

use std::time::Duration;

use axum::extract::State;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio::time::timeout;

use super::events;
use super::hub::{Frame, Outbound, ResumeError, Sender};
use crate::models::UserRow;
use crate::snowflake::Id;
use crate::state::AppState;

pub const HEARTBEAT_INTERVAL_MS: u64 = 41_250;
const IDENTIFY_TIMEOUT: Duration = Duration::from_secs(15);
/// Missing heartbeats for this long closes the connection.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_millis(HEARTBEAT_INTERVAL_MS * 3 / 2 + 5_000);

pub mod op {
    pub const DISPATCH: u8 = 0;
    pub const HEARTBEAT: u8 = 1;
    pub const IDENTIFY: u8 = 2;
    pub const PRESENCE_UPDATE: u8 = 3;
    pub const RESUME: u8 = 6;
    pub const RECONNECT: u8 = 7;
    pub const INVALID_SESSION: u8 = 9;
    pub const HELLO: u8 = 10;
    pub const HEARTBEAT_ACK: u8 = 11;
}

pub mod close {
    pub const UNKNOWN_ERROR: u16 = 4000;
    pub const DECODE_ERROR: u16 = 4002;
    pub const NOT_AUTHENTICATED: u16 = 4003;
    pub const AUTHENTICATION_FAILED: u16 = 4004;
    pub const SESSION_TIMED_OUT: u16 = 4009;
}

#[derive(Deserialize)]
struct Payload {
    op: u8,
    #[serde(default)]
    d: Value,
}

#[derive(Deserialize)]
struct Identify {
    token: String,
}

#[derive(Deserialize)]
struct Resume {
    token: String,
    session_id: String,
    seq: u64,
}

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.max_message_size(64 * 1024)
        .on_upgrade(move |socket| run(socket, state))
}

fn frame(v: Value) -> Outbound {
    Outbound::Frame(Frame::from(v.to_string()))
}

async fn run(socket: WebSocket, state: AppState) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Outbound>();

    let writer = tokio::spawn(async move {
        while let Some(out) = rx.recv().await {
            match out {
                Outbound::Frame(f) => {
                    if sink.send(Message::Text(f.as_ref().into())).await.is_err() {
                        break;
                    }
                }
                Outbound::Close(code, reason) => {
                    let _ = sink
                        .send(Message::Close(Some(CloseFrame {
                            code,
                            reason: reason.into(),
                        })))
                        .await;
                    break;
                }
            }
        }
        let _ = sink.close().await;
    });

    let _ = tx.send(frame(
        json!({ "op": op::HELLO, "d": { "heartbeat_interval": HEARTBEAT_INTERVAL_MS } }),
    ));

    if let Some((session_id, user_id)) = handshake(&state, &mut stream, &tx).await {
        read_loop(&mut stream, &tx).await;
        if state.hub.detach(&session_id, &tx)
            && let Err(e) = state.broadcast_presence(user_id).await
        {
            tracing::warn!(error = ?e, "presence broadcast failed");
        }
    }
    drop(tx);
    let _ = writer.await;
}

async fn next_payload(
    stream: &mut futures_util::stream::SplitStream<WebSocket>,
    wait: Duration,
) -> Result<Option<Payload>, u16> {
    loop {
        match timeout(wait, stream.next()).await {
            Err(_) => return Err(close::SESSION_TIMED_OUT),
            Ok(None) | Ok(Some(Err(_))) => return Ok(None),
            Ok(Some(Ok(Message::Text(text)))) => {
                return serde_json::from_str::<Payload>(&text)
                    .map(Some)
                    .map_err(|_| close::DECODE_ERROR);
            }
            Ok(Some(Ok(Message::Close(_)))) => return Ok(None),
            Ok(Some(Ok(_))) => continue, // ping/pong/binary
        }
    }
}

/// Waits for IDENTIFY or RESUME. Returns the session id and user on success.
async fn handshake(
    state: &AppState,
    stream: &mut futures_util::stream::SplitStream<WebSocket>,
    tx: &Sender,
) -> Option<(String, Id)> {
    for _ in 0..3 {
        let payload = match next_payload(stream, IDENTIFY_TIMEOUT).await {
            Ok(Some(p)) => p,
            Ok(None) => return None,
            Err(code) => {
                let _ = tx.send(Outbound::Close(code, "identify timeout or decode error"));
                return None;
            }
        };
        match payload.op {
            op::HEARTBEAT => {
                let _ = tx.send(frame(json!({ "op": op::HEARTBEAT_ACK })));
            }
            op::IDENTIFY => {
                let Ok(identify) = serde_json::from_value::<Identify>(payload.d) else {
                    let _ = tx.send(Outbound::Close(close::DECODE_ERROR, "invalid identify"));
                    return None;
                };
                let Ok(auth) = state.authenticate(&identify.token).await else {
                    let _ = tx.send(Outbound::Close(
                        close::AUTHENTICATION_FAILED,
                        "authentication failed",
                    ));
                    return None;
                };
                return match identify_session(state, auth.user_id, auth.session_id, tx).await {
                    Ok(session_id) => Some((session_id, auth.user_id)),
                    Err(e) => {
                        tracing::error!(error = ?e, "identify failed");
                        let _ = tx.send(Outbound::Close(close::UNKNOWN_ERROR, "internal error"));
                        None
                    }
                };
            }
            op::RESUME => {
                let Ok(resume) = serde_json::from_value::<Resume>(payload.d) else {
                    let _ = tx.send(Outbound::Close(close::DECODE_ERROR, "invalid resume"));
                    return None;
                };
                let Ok(auth) = state.authenticate(&resume.token).await else {
                    let _ = tx.send(Outbound::Close(
                        close::AUTHENTICATION_FAILED,
                        "authentication failed",
                    ));
                    return None;
                };
                match state
                    .hub
                    .resume(&resume.session_id, auth.user_id.0, resume.seq, tx.clone())
                {
                    Ok(came_online) => {
                        if came_online {
                            let _ = state.broadcast_presence(auth.user_id).await;
                        }
                        return Some((resume.session_id, auth.user_id));
                    }
                    Err(ResumeError::UnknownSession | ResumeError::Gap) => {
                        let _ = tx.send(frame(json!({ "op": op::INVALID_SESSION, "d": false })));
                    }
                }
            }
            _ => {
                let _ = tx.send(Outbound::Close(
                    close::NOT_AUTHENTICATED,
                    "not authenticated",
                ));
                return None;
            }
        }
    }
    None
}

async fn identify_session(
    state: &AppState,
    user_id: Id,
    auth_session: i64,
    tx: &Sender,
) -> anyhow::Result<String> {
    let guild_ids: Vec<i64> = sqlx::query_scalar("SELECT guild_id FROM members WHERE user_id = $1")
        .bind(user_id)
        .fetch_all(&state.db)
        .await?;
    // Register first so no event between snapshot and attach is lost.
    let session_id = state
        .hub
        .create_session(user_id.0, auth_session, &guild_ids);
    let built = async {
        let user: UserRow = sqlx::query_as("SELECT * FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&state.db)
            .await?;
        let guilds = state.guild_payloads(user_id, None).await?;
        let presences = state.guild_presences(&guild_ids).await?;
        let read_states: Vec<crate::models::ReadState> = sqlx::query_as(
            "SELECT channel_id, last_message_id, mention_count FROM read_states WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&state.db)
        .await?;
        Ok::<_, crate::error::ApiError>((user, guilds, presences, read_states))
    }
    .await;
    let (user, guilds, mut presences, read_states) = match built {
        Ok(v) => v,
        Err(e) => {
            state.hub.kill_auth_session(user_id.0, auth_session);
            return Err(anyhow::anyhow!("{e}"));
        }
    };
    presences.retain(|p| p.user_id != user_id);
    let ready = json!({
        "op": op::DISPATCH,
        "t": events::READY,
        "s": null,
        "d": {
            "v": 1,
            "session_id": session_id,
            "user": user.private(),
            "guilds": guilds,
            "presences": presences,
            "read_states": read_states,
        }
    });
    if state
        .hub
        .attach(&session_id, tx.clone(), ready.to_string().into())
    {
        state.broadcast_presence(user_id).await?;
    }
    Ok(session_id)
}

async fn read_loop(stream: &mut futures_util::stream::SplitStream<WebSocket>, tx: &Sender) {
    loop {
        match next_payload(stream, HEARTBEAT_TIMEOUT).await {
            Ok(Some(p)) if p.op == op::HEARTBEAT => {
                if tx.send(frame(json!({ "op": op::HEARTBEAT_ACK }))).is_err() {
                    return;
                }
            }
            Ok(Some(p)) if p.op == op::PRESENCE_UPDATE => {} // status changes go through REST
            Ok(Some(_)) => {}
            Ok(None) => return,
            Err(code) => {
                let _ = tx.send(Outbound::Close(code, "heartbeat timeout or decode error"));
                return;
            }
        }
    }
}
