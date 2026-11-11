mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{TestApp, channel_by_name};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

struct Ctx {
    app: TestApp,
    owner: String,
    member: String,
    member_id: String,
    gid: String,
    general: String,
}

async fn setup(pool: PgPool) -> Ctx {
    let app = TestApp::new(pool).await;
    let (owner, _) = app.register("owner").await;
    let (member, member_id) = app.register("member").await;
    let guild = app.create_guild(&owner, "Chat").await;
    let gid = guild["id"].as_str().unwrap().to_owned();
    let general = channel_by_name(&guild, "allgemein")["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let code = app.invite(&owner, &general).await;
    app.post(&format!("/invites/{code}"), &member, json!({}))
        .await;
    Ctx {
        app,
        owner,
        member,
        member_id,
        gid,
        general,
    }
}

async fn send(app: &TestApp, token: &str, channel: &str, body: Value) -> (StatusCode, Value) {
    app.post(&format!("/channels/{channel}/messages"), token, body)
        .await
}

fn multipart(payload: Value, files: &[(&str, &str, Vec<u8>)]) -> (String, Vec<u8>) {
    let boundary = "dcpointboundary7MA4YWxkTrZu0gW";
    let mut body = Vec::new();
    body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"payload_json\"\r\n\r\n{payload}\r\n").as_bytes());
    for (i, (name, ct, data)) in files.iter().enumerate() {
        body.extend(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"files[{i}]\"; filename=\"{name}\"\r\nContent-Type: {ct}\r\n\r\n").as_bytes(),
        );
        body.extend(data);
        body.extend(b"\r\n");
    }
    body.extend(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

async fn upload(
    app: &TestApp,
    token: &str,
    channel: &str,
    payload: Value,
    files: &[(&str, &str, Vec<u8>)],
) -> (StatusCode, Value) {
    let (ct, body) = multipart(payload, files);
    let req = Request::post(format!("/api/v1/channels/{channel}/messages"))
        .header("authorization", token)
        .header("content-type", ct)
        .body(Body::from(body))
        .unwrap();
    let res = app.app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn raw_get(app: &TestApp, path: &str) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let res = app
        .app
        .clone()
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    (
        status,
        headers,
        res.into_body().collect().await.unwrap().to_bytes().to_vec(),
    )
}

#[sqlx::test(migrations = "./migrations")]
async fn send_list_edit_delete(pool: PgPool) {
    let c = setup(pool).await;
    let app = &c.app;

    let (s, m1) = send(
        app,
        &c.owner,
        &c.general,
        json!({ "content": "Hallo **Welt**", "nonce": "n-1" }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m1}");
    assert_eq!(m1["nonce"], "n-1");
    assert_eq!(m1["author"]["username"], "owner");
    assert_eq!(m1["guild_id"], c.gid.as_str());
    assert!(m1["timestamp"].is_string());
    for i in 0..5 {
        send(
            app,
            &c.member,
            &c.general,
            json!({ "content": format!("msg {i}") }),
        )
        .await;
    }

    // ascending order, pagination
    let (_, all) = app
        .get(&format!("/channels/{}/messages", c.general), &c.member)
        .await;
    let all = all.as_array().unwrap();
    assert_eq!(all.len(), 6);
    assert_eq!(all[0]["content"], "Hallo **Welt**");
    assert_eq!(all[0]["reactions"], json!([]));
    let last = all[5]["id"].as_str().unwrap();
    let (_, page) = app
        .get(
            &format!("/channels/{}/messages?before={last}&limit=2", c.general),
            &c.member,
        )
        .await;
    assert_eq!(
        page.as_array()
            .unwrap()
            .iter()
            .map(|m| m["content"].clone())
            .collect::<Vec<_>>(),
        vec![json!("msg 2"), json!("msg 3")]
    );
    let first = all[0]["id"].as_str().unwrap();
    let (_, after) = app
        .get(
            &format!("/channels/{}/messages?after={first}&limit=2", c.general),
            &c.member,
        )
        .await;
    assert_eq!(after[0]["content"], "msg 0");
    let mid = all[3]["id"].as_str().unwrap();
    let (_, around) = app
        .get(
            &format!("/channels/{}/messages?around={mid}&limit=4", c.general),
            &c.member,
        )
        .await;
    assert_eq!(around.as_array().unwrap().len(), 4);
    assert_eq!(around[2]["id"], mid);

    // validation
    let (s, body) = send(app, &c.owner, &c.general, json!({ "content": "   " })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["errors"]["content"], "EMPTY_MESSAGE");
    let (s, _) = send(
        app,
        &c.owner,
        &c.general,
        json!({ "content": "x".repeat(4001) }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = send(
        app,
        &c.owner,
        &c.general,
        json!({ "content": "x".repeat(4000) }),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CREATED,
        "4000 chars are allowed for everyone"
    );

    // edit: only the author
    let id = m1["id"].as_str().unwrap();
    let (s, _) = app
        .patch(
            &format!("/channels/{}/messages/{id}", c.general),
            &c.member,
            json!({ "content": "hacked" }),
        )
        .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, edited) = app
        .patch(
            &format!("/channels/{}/messages/{id}", c.general),
            &c.owner,
            json!({ "content": "Hallo Welt!" }),
        )
        .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(edited["content"], "Hallo Welt!");
    assert!(edited["edited_at"].is_string());

    // delete: members can't delete others' messages, the owner (MANAGE_MESSAGES) can
    let member_msg = all[1]["id"].as_str().unwrap();
    let (s, _) = app
        .delete(&format!("/channels/{}/messages/{id}", c.general), &c.member)
        .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = app
        .delete(
            &format!("/channels/{}/messages/{member_msg}", c.general),
            &c.owner,
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = app
        .delete(
            &format!("/channels/{}/messages/{member_msg}", c.general),
            &c.owner,
        )
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // outsiders see nothing
    let (outsider, _) = app.register("outsider").await;
    let (s, _) = app
        .get(&format!("/channels/{}/messages", c.general), &outsider)
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = send(app, &outsider, &c.general, json!({ "content": "hi" })).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn replies_mentions_and_read_states(pool: PgPool) {
    let c = setup(pool).await;
    let app = &c.app;
    let (_, q) = send(app, &c.member, &c.general, json!({ "content": "Frage?" })).await;
    let qid = q["id"].as_str().unwrap();

    let (s, reply) = send(
        app,
        &c.owner,
        &c.general,
        json!({ "content": "Antwort", "reply_to_id": qid }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(reply["type"], 19);
    assert_eq!(reply["referenced_message"]["content"], "Frage?");
    assert_eq!(
        reply["mentions"],
        json!([c.member_id]),
        "replies ping the author"
    );

    let (_, quiet) = send(
        app,
        &c.owner,
        &c.general,
        json!({ "content": "leise", "reply_to_id": qid, "reply_mention": false }),
    )
    .await;
    assert_eq!(quiet["mentions"], json!([]));

    let (s, _) = send(
        app,
        &c.owner,
        &c.general,
        json!({ "content": "x", "reply_to_id": "123" }),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // explicit mention + @everyone (owner may) + code spans are ignored
    let (_, m) = send(
        app,
        &c.owner,
        &c.general,
        json!({ "content": format!("<@{}> @everyone `<@1>`", c.member_id) }),
    )
    .await;
    assert_eq!(m["mention_everyone"], true);
    assert_eq!(m["mentions"], json!([c.member_id]));
    // members lack MENTION_EVERYONE by default
    let (_, m2) = send(
        app,
        &c.member,
        &c.general,
        json!({ "content": "@everyone hallo" }),
    )
    .await;
    assert_eq!(m2["mention_everyone"], false);

    let count: i32 = sqlx::query_scalar(
        "SELECT mention_count FROM read_states WHERE user_id = $1 AND channel_id = $2",
    )
    .bind(c.member_id.parse::<i64>().unwrap())
    .bind(c.general.parse::<i64>().unwrap())
    .fetch_one(&app.state.db)
    .await
    .unwrap_or(-1);
    // the member's own message reset their read state afterwards
    assert_eq!(count, 0);

    let (_, ping) = send(
        app,
        &c.owner,
        &c.general,
        json!({ "content": format!("hey <@{}>", c.member_id) }),
    )
    .await;
    let count: i32 = sqlx::query_scalar(
        "SELECT mention_count FROM read_states WHERE user_id = $1 AND channel_id = $2",
    )
    .bind(c.member_id.parse::<i64>().unwrap())
    .bind(c.general.parse::<i64>().unwrap())
    .fetch_one(&app.state.db)
    .await
    .unwrap();
    assert_eq!(count, 1);
    let (s, _) = app
        .post(
            &format!(
                "/channels/{}/messages/{}/ack",
                c.general,
                ping["id"].as_str().unwrap()
            ),
            &c.member,
            json!({}),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (count, last): (i32, i64) = sqlx::query_as("SELECT mention_count, last_message_id FROM read_states WHERE user_id = $1 AND channel_id = $2")
        .bind(c.member_id.parse::<i64>().unwrap())
        .bind(c.general.parse::<i64>().unwrap())
        .fetch_one(&app.state.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
    assert_eq!(last.to_string(), ping["id"].as_str().unwrap());

    // channel last_message_id is tracked for unread markers
    let (_, ch) = app
        .get(&format!("/channels/{}", c.general), &c.member)
        .await;
    assert_eq!(ch["last_message_id"], ping["id"]);
}

#[sqlx::test(migrations = "./migrations")]
async fn reactions_and_pins(pool: PgPool) {
    let c = setup(pool).await;
    let app = &c.app;
    let (_, m) = send(
        app,
        &c.member,
        &c.general,
        json!({ "content": "Reagier mal" }),
    )
    .await;
    let base = format!(
        "/channels/{}/messages/{}",
        c.general,
        m["id"].as_str().unwrap()
    );

    for (token, emoji) in [(&c.owner, "👍"), (&c.member, "👍"), (&c.member, "🎉")] {
        let (s, _) = app
            .req(
                axum::http::Method::PUT,
                &format!("{base}/reactions/{}/@me", urlencode(emoji)),
                Some(token),
                None,
            )
            .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
    }
    let (s, _) = app
        .req(
            axum::http::Method::PUT,
            &format!("{base}/reactions/abc/@me"),
            Some(&c.owner),
            None,
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (_, list) = app
        .get(&format!("/channels/{}/messages", c.general), &c.owner)
        .await;
    assert_eq!(
        list[0]["reactions"],
        json!([{ "emoji": "👍", "count": 2, "me": true }, { "emoji": "🎉", "count": 1, "me": false }])
    );

    let (s, _) = app
        .delete(
            &format!("{base}/reactions/{}/@me", urlencode("👍")),
            &c.owner,
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    // removing someone else's reaction requires MANAGE_MESSAGES
    let owner_id = list[0]["author"]["id"].as_str().unwrap().to_owned();
    let _ = owner_id;
    let (s, _) = app
        .delete(
            &format!("{base}/reactions/{}/{}", urlencode("🎉"), c.member_id),
            &c.owner,
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, list) = app
        .get(&format!("/channels/{}/messages", c.general), &c.member)
        .await;
    assert_eq!(
        list[0]["reactions"],
        json!([{ "emoji": "👍", "count": 1, "me": true }])
    );

    // pins need MANAGE_MESSAGES
    let pin = format!("/channels/{}/pins/{}", c.general, m["id"].as_str().unwrap());
    let (s, _) = app
        .req(axum::http::Method::PUT, &pin, Some(&c.member), None)
        .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = app
        .req(axum::http::Method::PUT, &pin, Some(&c.owner), None)
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, pins) = app
        .get(&format!("/channels/{}/pins", c.general), &c.member)
        .await;
    assert_eq!(pins.as_array().unwrap().len(), 1);
    assert_eq!(pins[0]["pinned"], true);
    let (s, _) = app.delete(&pin, &c.owner).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, pins) = app
        .get(&format!("/channels/{}/pins", c.general), &c.member)
        .await;
    assert!(pins.as_array().unwrap().is_empty());
}

fn urlencode(s: &str) -> String {
    s.bytes().map(|b| format!("%{b:02X}")).collect()
}

#[sqlx::test(migrations = "./migrations")]
async fn attachments_upload_and_serve(pool: PgPool) {
    let c = setup(pool).await;
    let app = &c.app;
    let png = vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0,
        0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0,
    ];
    let (s, m) = upload(
        app,
        &c.member,
        &c.general,
        json!({ "content": "Bilder", "nonce": "up" }),
        &[
            ("bild.png", "image/png", png.clone()),
            (
                "SPOILER_x.html",
                "text/html",
                b"<script>alert(1)</script>".to_vec(),
            ),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m}");
    let atts = m["attachments"].as_array().unwrap();
    assert_eq!(atts.len(), 2);
    assert_eq!(atts[0]["filename"], "bild.png");
    assert_eq!(atts[0]["width"], 3);
    assert_eq!(atts[0]["height"], 2);
    assert_eq!(atts[1]["spoiler"], true);

    let (s, headers, body) = raw_get(app, atts[0]["url"].as_str().unwrap()).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(headers["content-type"], "image/png");
    assert_eq!(body, png);
    // HTML is never rendered from our origin
    let (s, headers, _) = raw_get(app, atts[1]["url"].as_str().unwrap()).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(headers["content-type"], "application/octet-stream");
    assert!(
        headers["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("attachment")
    );
    // wrong token -> 404
    let bad = atts[0]["url"].as_str().unwrap().replace(
        &atts[0]["url"]
            .as_str()
            .unwrap()
            .split('/')
            .nth(5)
            .unwrap()
            .to_owned(),
        "deadbeef",
    );
    let (s, _, _) = raw_get(app, &bad).await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // file-only messages are fine; files above the global 12 MiB JSON limit are accepted
    let big = vec![7u8; 13 * 1024 * 1024];
    let (s, m) = upload(
        app,
        &c.member,
        &c.general,
        json!({}),
        &[("gross.bin", "application/octet-stream", big)],
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{m}");
    let too_big = vec![7u8; 21 * 1024 * 1024];
    let (s, _) = upload(
        app,
        &c.member,
        &c.general,
        json!({}),
        &[("riesig.bin", "application/octet-stream", too_big)],
    )
    .await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE);

    // deleting the message removes the file
    let url = atts[0]["url"].as_str().unwrap().to_owned();
    let (s, _) = app
        .delete(
            &format!(
                "/channels/{}/messages/{}",
                c.general,
                m["id"].as_str().unwrap()
            ),
            &c.member,
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, list) = app
        .get(&format!("/channels/{}/messages", c.general), &c.member)
        .await;
    let first = list[0]["id"].as_str().unwrap().to_owned();
    app.delete(
        &format!("/channels/{}/messages/{first}", c.general),
        &c.member,
    )
    .await;
    let (s, _, _) = raw_get(app, &url).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn custom_emojis(pool: PgPool) {
    let c = setup(pool).await;
    let app = &c.app;
    let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let path = format!("/guilds/{}/emojis", c.gid);

    let (s, _) = app
        .post(&path, &c.member, json!({ "name": "blob", "image": png }))
        .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "MANAGE_EMOJIS required");
    let (s, body) = app
        .post(&path, &c.owner, json!({ "name": "nicht ok", "image": png }))
        .await;
    assert_eq!(body["errors"]["name"], "EMOJI_NAME_INVALID", "{s}");
    let (s, emoji) = app
        .post(
            &path,
            &c.owner,
            json!({ "name": "party_blob", "image": png }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{emoji}");
    let (s, body) = app
        .post(
            &path,
            &c.owner,
            json!({ "name": "PARTY_BLOB", "image": png }),
        )
        .await;
    assert_eq!(body["errors"]["name"], "EMOJI_NAME_TAKEN", "{s}");
    let id = emoji["id"].as_str().unwrap();

    let (s, _, bytes) = raw_get(app, &format!("/cdn/emojis/{id}.png")).await;
    assert_eq!(s, StatusCode::OK);
    assert!(bytes.starts_with(b"\x89PNG"));

    // part of the guild payload, usable in reactions
    let (_, g) = app.get(&format!("/guilds/{}", c.gid), &c.member).await;
    assert_eq!(g["emojis"][0]["name"], "party_blob");
    let (_, m) = send(
        app,
        &c.member,
        &c.general,
        json!({ "content": format!("<:party_blob:{id}>") }),
    )
    .await;
    let base = format!(
        "/channels/{}/messages/{}",
        c.general,
        m["id"].as_str().unwrap()
    );
    let (s, _) = app
        .req(
            axum::http::Method::PUT,
            &format!("{base}/reactions/party_blob:{id}/@me"),
            Some(&c.member),
            None,
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = app
        .req(
            axum::http::Method::PUT,
            &format!("{base}/reactions/fake:123/@me"),
            Some(&c.member),
            None,
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (s, renamed) = app
        .patch(&format!("{path}/{id}"), &c.owner, json!({ "name": "blob" }))
        .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(renamed["name"], "blob");
    let (s, _) = app.delete(&format!("{path}/{id}"), &c.owner).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _, _) = raw_get(app, &format!("/cdn/emojis/{id}")).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
