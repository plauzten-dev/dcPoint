mod common;

use std::time::Duration;

use common::{TestApp, channel_by_name};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn serve(app: &TestApp) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = dcpoint::router(app.state.clone());
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("ws://{addr}/gateway")
}

async fn recv(ws: &mut Ws) -> Value {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("timed out waiting for frame")
            .unwrap()
            .unwrap();
        if let Message::Text(t) = msg {
            return serde_json::from_str(&t).unwrap();
        }
    }
}

/// Waits for a dispatch of type `t`, skipping others.
async fn wait_for(ws: &mut Ws, t: &str) -> Value {
    loop {
        let v = recv(ws).await;
        if v["t"] == t {
            return v;
        }
    }
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}

async fn identify(url: &str, token: &str) -> (Ws, Value) {
    let (mut ws, _) = connect_async(url).await.unwrap();
    let hello = recv(&mut ws).await;
    assert_eq!(hello["op"], 10);
    assert!(hello["d"]["heartbeat_interval"].as_u64().unwrap() > 1000);
    send(&mut ws, json!({ "op": 2, "d": { "token": token } })).await;
    let ready = wait_for(&mut ws, "READY").await;
    (ws, ready)
}

#[sqlx::test(migrations = "./migrations")]
async fn ready_dispatch_presence_and_resume(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let url = serve(&app).await;
    let (owner, owner_id) = app.register("owner").await;
    let (member, member_id) = app.register("member").await;
    let guild = app.create_guild(&owner, "Gateway").await;
    let gid = guild["id"].as_str().unwrap().to_owned();
    let general = channel_by_name(&guild, "allgemein")["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let code = app.invite(&owner, &general).await;
    app.post(&format!("/invites/{code}"), &member, json!({}))
        .await;

    // invalid token closes with 4004
    let (mut bad, _) = connect_async(&url).await.unwrap();
    recv(&mut bad).await;
    send(&mut bad, json!({ "op": 2, "d": { "token": "nope" } })).await;
    match tokio::time::timeout(Duration::from_secs(5), bad.next())
        .await
        .unwrap()
    {
        Some(Ok(Message::Close(Some(frame)))) => assert_eq!(u16::from(frame.code), 4004),
        other => panic!("expected close frame, got {other:?}"),
    }

    let (mut ows, ready) = identify(&url, &owner).await;
    assert_eq!(ready["d"]["user"]["id"], owner_id.as_str());
    assert_eq!(ready["d"]["guilds"][0]["id"], gid.as_str());
    assert!(ready["s"].is_null());

    // heartbeat
    send(&mut ows, json!({ "op": 1, "d": null })).await;
    assert_eq!(recv(&mut ows).await["op"], 11);

    // member comes online -> owner gets presence
    let (mut mws, mready) = identify(&url, &member).await;
    let session_id = mready["d"]["session_id"].as_str().unwrap().to_owned();
    assert_eq!(mready["d"]["presences"][0]["user_id"], owner_id.as_str());
    let p = wait_for(&mut ows, "PRESENCE_UPDATE").await;
    assert_eq!(p["d"]["user_id"], member_id.as_str());
    assert_eq!(p["d"]["status"], "online");

    // public channel reaches the member, private channel does not
    app.post(
        &format!("/guilds/{gid}/channels"),
        &owner,
        json!({ "name": "geheim", "private": true }),
    )
    .await;
    app.post(
        &format!("/guilds/{gid}/channels"),
        &owner,
        json!({ "name": "public" }),
    )
    .await;
    let created = wait_for(&mut mws, "CHANNEL_CREATE").await;
    assert_eq!(
        created["d"]["name"], "public",
        "private channel must not be dispatched"
    );
    let last_seq = created["s"].as_u64().unwrap();
    assert_eq!(
        wait_for(&mut ows, "CHANNEL_CREATE").await["d"]["name"],
        "geheim"
    );

    // member drops; events while offline are replayed on RESUME
    mws.close(None).await.unwrap();
    drop(mws);
    let p = wait_for(&mut ows, "PRESENCE_UPDATE").await;
    assert_eq!(p["d"]["status"], "offline");
    app.patch(
        &format!("/guilds/{gid}"),
        &owner,
        json!({ "name": "Renamed" }),
    )
    .await;

    let (mut mws, _) = connect_async(&url).await.unwrap();
    recv(&mut mws).await;
    send(
        &mut mws,
        json!({ "op": 6, "d": { "token": member, "session_id": session_id, "seq": last_seq } }),
    )
    .await;
    assert_eq!(recv(&mut mws).await["t"], "RESUMED");
    let replayed = recv(&mut mws).await;
    assert_eq!(replayed["t"], "GUILD_UPDATE");
    assert_eq!(replayed["d"]["name"], "Renamed");
    assert_eq!(replayed["s"].as_u64().unwrap(), last_seq + 1);
    assert_eq!(
        wait_for(&mut ows, "PRESENCE_UPDATE").await["d"]["status"],
        "online"
    );

    // resuming an unknown session yields INVALID_SESSION
    let (mut x, _) = connect_async(&url).await.unwrap();
    recv(&mut x).await;
    send(
        &mut x,
        json!({ "op": 6, "d": { "token": member, "session_id": "unknown", "seq": 0 } }),
    )
    .await;
    let inv = recv(&mut x).await;
    assert_eq!(inv["op"], 9);

    // leaving the guild: member gets GUILD_DELETE, owner gets GUILD_MEMBER_REMOVE
    app.delete(&format!("/users/@me/guilds/{gid}"), &member)
        .await;
    assert_eq!(
        wait_for(&mut mws, "GUILD_DELETE").await["d"]["id"],
        gid.as_str()
    );
    assert_eq!(
        wait_for(&mut ows, "GUILD_MEMBER_REMOVE").await["d"]["user_id"],
        member_id.as_str()
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn message_events_reach_viewers_only(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let url = serve(&app).await;
    let (owner, owner_id) = app.register("owner").await;
    let (member, _) = app.register("member").await;
    let guild = app.create_guild(&owner, "Live").await;
    let gid = guild["id"].as_str().unwrap().to_owned();
    let general = channel_by_name(&guild, "allgemein")["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let code = app.invite(&owner, &general).await;
    app.post(&format!("/invites/{code}"), &member, json!({}))
        .await;
    let (_, secret) = app
        .post(
            &format!("/guilds/{gid}/channels"),
            &owner,
            json!({ "name": "geheim", "private": true }),
        )
        .await;
    let secret = secret["id"].as_str().unwrap().to_owned();

    let (mut ows, _) = identify(&url, &owner).await;
    let (mut mws, _) = identify(&url, &member).await;

    // typing is not echoed to the typer
    app.post(&format!("/channels/{general}/typing"), &owner, json!({}))
        .await;
    let t = wait_for(&mut mws, "TYPING_START").await;
    assert_eq!(t["d"]["user_id"], owner_id.as_str());

    app.post(
        &format!("/channels/{secret}/messages"),
        &owner,
        json!({ "content": "geheim" }),
    )
    .await;
    let (_, sent) = app
        .post(
            &format!("/channels/{general}/messages"),
            &owner,
            json!({ "content": "hallo", "nonce": "abc" }),
        )
        .await;
    let created = wait_for(&mut mws, "MESSAGE_CREATE").await;
    assert_eq!(
        created["d"]["content"], "hallo",
        "private channel message must not reach the member"
    );
    assert_eq!(created["d"]["nonce"], "abc");
    // the author's own sessions get it too (for multi-device + optimistic reconciliation)
    let own = wait_for(&mut ows, "MESSAGE_CREATE").await;
    assert_eq!(own["d"]["content"], "geheim");
    assert_eq!(
        wait_for(&mut ows, "MESSAGE_CREATE").await["d"]["nonce"],
        "abc"
    );

    let mid = sent["id"].as_str().unwrap();
    app.req(
        axum::http::Method::PUT,
        &format!("/channels/{general}/messages/{mid}/reactions/%F0%9F%91%8D/@me"),
        Some(&member),
        None,
    )
    .await;
    let r = wait_for(&mut ows, "MESSAGE_REACTION_ADD").await;
    assert_eq!(r["d"]["emoji"], "👍");
    app.patch(
        &format!("/channels/{general}/messages/{mid}"),
        &owner,
        json!({ "content": "hallo!" }),
    )
    .await;
    let u = wait_for(&mut mws, "MESSAGE_UPDATE").await;
    assert_eq!(u["d"]["content"], "hallo!");
    assert!(
        u["d"].get("reactions").is_none(),
        "updates never carry per-viewer reaction state"
    );
    app.delete(&format!("/channels/{general}/messages/{mid}"), &owner)
        .await;
    assert_eq!(wait_for(&mut mws, "MESSAGE_DELETE").await["d"]["id"], mid);

    // read states are part of READY
    app.post(
        &format!("/channels/{general}/messages"),
        &owner,
        json!({ "content": format!("<@{}>", "0") }),
    )
    .await;
    let (_, me) = app.get("/users/@me", &member).await;
    let (_, ping) = app
        .post(
            &format!("/channels/{general}/messages"),
            &owner,
            json!({ "content": format!("<@{}> ping", me["id"].as_str().unwrap()) }),
        )
        .await;
    let (_, ready) = identify(&url, &member).await;
    let rs = ready["d"]["read_states"].as_array().unwrap();
    let state = rs
        .iter()
        .find(|r| r["id"] == general.as_str())
        .expect("read state for general");
    assert_eq!(state["mention_count"], 1);
    let ch = ready["d"]["guilds"][0]["channels"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == general.as_str())
        .unwrap()
        .clone();
    assert_eq!(ch["last_message_id"], ping["id"]);
}
