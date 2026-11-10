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
