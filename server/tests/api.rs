mod common;

use axum::http::{Method, StatusCode};
use common::{TestApp, channel_by_name};
use dcpoint::auth::totp;
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn register_login_and_profile(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, id) = app.register("alice").await;

    let (s, me) = app.get("/users/@me", &token).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(me["id"], id.as_str());
    assert_eq!(me["email"], "alice@example.com");
    assert_eq!(me["mfa_enabled"], false);

    // duplicate email/username, validation errors
    let (s, body) = app
        .req(Method::POST, "/auth/register", None, Some(json!({ "email": "ALICE@example.com", "username": "alice2", "password": "hunter2hunter2" })))
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["errors"]["email"], "EMAIL_ALREADY_REGISTERED");
    let (s, body) = app
        .req(
            Method::POST,
            "/auth/register",
            None,
            Some(json!({ "email": "x", "username": "Bad Name", "password": "123" })),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["errors"]["email"], "EMAIL_INVALID");
    assert_eq!(body["errors"]["username"], "USERNAME_INVALID_CHARS");
    assert_eq!(body["errors"]["password"], "PASSWORD_TOO_SHORT");

    // login by username and email, wrong password
    for login in ["alice", "Alice@Example.com"] {
        let (s, body) = app
            .req(
                Method::POST,
                "/auth/login",
                None,
                Some(json!({ "login": login, "password": "hunter2hunter2" })),
            )
            .await;
        assert_eq!(s, StatusCode::OK, "{body}");
        assert!(body["token"].is_string());
    }
    let (s, body) = app
        .req(
            Method::POST,
            "/auth/login",
            None,
            Some(json!({ "login": "alice", "password": "nope" })),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["errors"]["login"], "INVALID_LOGIN");

    // profile update
    let (s, me) = app
        .patch(
            "/users/@me",
            &token,
            json!({ "display_name": "Alice A.", "bio": "Hallo!", "accent_color": 16711680 }),
        )
        .await;
    assert_eq!(s, StatusCode::OK, "{me}");
    assert_eq!(me["display_name"], "Alice A.");
    assert_eq!(me["bio"], "Hallo!");
    let (s, body) = app
        .patch("/users/@me", &token, json!({ "username": "alice_new" }))
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["errors"]["password"], "PASSWORD_INCORRECT");
    let (s, me) = app
        .patch(
            "/users/@me",
            &token,
            json!({ "username": "alice_new", "password": "hunter2hunter2" }),
        )
        .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(me["username"], "alice_new");

    // avatar upload (tiny PNG header is enough for the magic-byte check)
    let png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let (s, me) = app
        .patch("/users/@me", &token, json!({ "avatar": png }))
        .await;
    assert_eq!(s, StatusCode::OK, "{me}");
    let hash = me["avatar"].as_str().unwrap().to_owned();
    let res = tower::ServiceExt::oneshot(
        app.app.clone(),
        axum::http::Request::get(format!("/cdn/avatars/{id}/{hash}.png"))
            .body(axum::body::Body::empty())
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()["content-type"], "image/png");
    let (s, body) = app
        .patch(
            "/users/@me",
            &token,
            json!({ "avatar": "data:image/svg+xml;base64,PHN2Zz4=" }),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["errors"]["avatar"], "INVALID_IMAGE");

    // status + custom status
    let (s, me) = app
        .patch(
            "/users/@me/settings",
            &token,
            json!({ "status": "dnd", "custom_status": { "text": "Fokus" } }),
        )
        .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(me["status"], "dnd");
    assert_eq!(me["custom_status"]["text"], "Fokus");
    let (s, _) = app
        .patch("/users/@me/settings", &token, json!({ "status": "away" }))
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // logout invalidates the token
    let (s, _) = app.post("/auth/logout", &token, json!({})).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = app.get("/users/@me", &token).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _) = app.get("/users/@me", "garbage").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn totp_two_factor_flow(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (token, _) = app.register("bob").await;

    let (s, _) = app
        .post(
            "/users/@me/mfa/totp/enable",
            &token,
            json!({ "password": "wrong" }),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, body) = app
        .post(
            "/users/@me/mfa/totp/enable",
            &token,
            json!({ "password": "hunter2hunter2" }),
        )
        .await;
    assert_eq!(s, StatusCode::OK);
    let secret = body["secret"].as_str().unwrap().to_owned();
    assert!(
        body["uri"]
            .as_str()
            .unwrap()
            .starts_with("otpauth://totp/dcPoint:bob?secret=")
    );

    let key = totp::base32_decode(&secret).unwrap();
    let code_at = |step: u64| format!("{:06}", totp::hotp(&key, step, 6));
    let step = totp::current_step();

    let (s, body) = app
        .post(
            "/users/@me/mfa/totp/confirm",
            &token,
            json!({ "secret": secret, "code": "000000" }),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{body}");
    let (s, me) = app
        .post(
            "/users/@me/mfa/totp/confirm",
            &token,
            json!({ "secret": secret, "code": code_at(step) }),
        )
        .await;
    assert_eq!(s, StatusCode::OK, "{me}");
    assert_eq!(me["mfa_enabled"], true);

    let (s, body) = app
        .req(
            Method::POST,
            "/auth/login",
            None,
            Some(json!({ "login": "bob", "password": "hunter2hunter2" })),
        )
        .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(body["mfa"], true);
    assert!(body.get("token").is_none());
    let ticket = body["ticket"].as_str().unwrap().to_owned();

    // replay of the already used step is rejected
    let (s, body) = app
        .req(
            Method::POST,
            "/auth/mfa/totp",
            None,
            Some(json!({ "ticket": ticket, "code": code_at(step) })),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["errors"]["code"], "INVALID_TOTP_CODE");
    let (s, body) = app
        .req(
            Method::POST,
            "/auth/mfa/totp",
            None,
            Some(json!({ "ticket": "forged.ticket", "code": code_at(step + 1) })),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "INVALID_MFA_TICKET");
    let (s, body) = app
        .req(
            Method::POST,
            "/auth/mfa/totp",
            None,
            Some(json!({ "ticket": ticket, "code": code_at(step + 1) })),
        )
        .await;
    assert_eq!(s, StatusCode::OK, "{body}");
    let token2 = body["token"].as_str().unwrap().to_owned();

    let (s, _) = app
        .post(
            "/users/@me/mfa/totp/disable",
            &token2,
            json!({ "code": code_at(step + 1) }),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "same step again is a replay");
}

#[sqlx::test(migrations = "./migrations")]
async fn guilds_channels_invites_and_permissions(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (owner, _) = app.register("owner").await;
    let (member, member_id) = app.register("member").await;

    let guild = app.create_guild(&owner, "Testserver").await;
    let gid = guild["id"].as_str().unwrap().to_owned();
    assert_eq!(
        guild["roles"][0]["id"],
        gid.as_str(),
        "@everyone role id equals guild id"
    );
    assert_eq!(guild["channels"].as_array().unwrap().len(), 4);
    let general = channel_by_name(&guild, "allgemein").clone();
    let voice_cat = channel_by_name(&guild, "Sprachkanäle").clone();

    // non-members see nothing
    let (s, body) = app.get(&format!("/guilds/{gid}"), &member).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "UNKNOWN_GUILD");

    // invite preview works without membership, join via code
    let code = app.invite(&owner, general["id"].as_str().unwrap()).await;
    let (s, preview) = app.get(&format!("/invites/{code}"), &member).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(preview["guild"]["name"], "Testserver");
    assert_eq!(preview["approximate_member_count"], 1);
    let (s, joined) = app
        .post(&format!("/invites/{code}"), &member, json!({}))
        .await;
    assert_eq!(s, StatusCode::OK, "{joined}");
    assert_eq!(joined["member_count"], 2);
    let (s, _) = app
        .post(&format!("/invites/{code}"), &member, json!({}))
        .await;
    assert_eq!(s, StatusCode::OK, "joining twice is idempotent");
    let (_, preview) = app.get(&format!("/invites/{code}"), &member).await;
    assert_eq!(preview["uses"], 1);

    let (s, members) = app.get(&format!("/guilds/{gid}/members"), &member).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(members.as_array().unwrap().len(), 2);

    // members without MANAGE_CHANNELS / MANAGE_GUILD are rejected
    let (s, body) = app
        .post(
            &format!("/guilds/{gid}/channels"),
            &member,
            json!({ "name": "nope" }),
        )
        .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert_eq!(body["code"], "MISSING_PERMISSIONS");
    let (s, _) = app
        .patch(
            &format!("/guilds/{gid}"),
            &member,
            json!({ "name": "Hacked" }),
        )
        .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = app.delete(&format!("/guilds/{gid}"), &member).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // owner creates channels; names are normalized; private channels are hidden
    let (s, ch) = app
        .post(
            &format!("/guilds/{gid}/channels"),
            &owner,
            json!({ "name": "Off Topic!", "type": 0, "parent_id": general["parent_id"] }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{ch}");
    assert_eq!(ch["name"], "off-topic");
    assert_eq!(ch["position"], 1);
    let (s, secret) = app
        .post(
            &format!("/guilds/{gid}/channels"),
            &owner,
            json!({ "name": "geheim", "private": true }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED);
    let secret_id = secret["id"].as_str().unwrap();
    let (s, _) = app.get(&format!("/channels/{secret_id}"), &member).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (_, g) = app.get(&format!("/guilds/{gid}"), &member).await;
    assert!(
        g["channels"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["id"] != secret_id)
    );
    let (_, g) = app.get(&format!("/guilds/{gid}"), &owner).await;
    assert!(
        g["channels"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["id"] == secret_id)
    );
    let (s, _) = app
        .post(
            &format!("/channels/{secret_id}/invites"),
            &member,
            json!({}),
        )
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // invalid parent (text channel as parent)
    let (s, body) = app
        .post(
            &format!("/guilds/{gid}/channels"),
            &owner,
            json!({ "name": "x", "parent_id": general["id"] }),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["errors"]["parent_id"], "INVALID_PARENT");

    // drag & drop: move "off-topic" into the voice category at position 0
    let ch_id = ch["id"].as_str().unwrap();
    let (s, _) = app
        .patch(
            &format!("/guilds/{gid}/channels"),
            &owner,
            json!([{ "id": ch_id, "position": 0, "parent_id": voice_cat["id"] }]),
        )
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, moved) = app.get(&format!("/channels/{ch_id}"), &owner).await;
    assert_eq!(moved["parent_id"], voice_cat["id"]);
    assert_eq!(moved["position"], 0);
    let (s, _) = app
        .patch(
            &format!("/guilds/{gid}/channels"),
            &member,
            json!([{ "id": ch_id, "position": 3 }]),
        )
        .await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // channel update + delete of a category moves children to top level
    let (s, upd) = app
        .patch(
            &format!("/channels/{ch_id}"),
            &owner,
            json!({ "topic": "Alles außer Arbeit" }),
        )
        .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(upd["topic"], "Alles außer Arbeit");
    let (s, _) = app
        .delete(
            &format!("/channels/{}", voice_cat["id"].as_str().unwrap()),
            &owner,
        )
        .await;
    assert_eq!(s, StatusCode::OK);
    let (_, orphan) = app.get(&format!("/channels/{ch_id}"), &owner).await;
    assert!(orphan["parent_id"].is_null());

    // guild update by owner
    let (s, g) = app
        .patch(
            &format!("/guilds/{gid}"),
            &owner,
            json!({ "name": "Umbenannt" }),
        )
        .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(g["name"], "Umbenannt");

    // owner cannot leave, member can
    let (s, body) = app
        .delete(&format!("/users/@me/guilds/{gid}"), &owner)
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "OWNER_CANNOT_LEAVE");
    let (s, _) = app
        .delete(&format!("/users/@me/guilds/{gid}"), &member)
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, members) = app.get(&format!("/guilds/{gid}/members"), &owner).await;
    assert!(
        members
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["user"]["id"] != member_id.as_str())
    );

    // delete guild
    let (s, _) = app.delete(&format!("/guilds/{gid}"), &owner).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = app.get(&format!("/invites/{code}"), &owner).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn invite_limits(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let (owner, _) = app.register("owner").await;
    let (a, _) = app.register("usera").await;
    let (b, _) = app.register("userb").await;
    let guild = app.create_guild(&owner, "Limits").await;
    let general = channel_by_name(&guild, "allgemein")["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let (s, _) = app
        .post(
            &format!("/channels/{general}/invites"),
            &owner,
            json!({ "max_uses": 3 }),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "only preset values allowed");
    let (s, inv) = app
        .post(
            &format!("/channels/{general}/invites"),
            &owner,
            json!({ "max_uses": 1, "max_age": 1800 }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED);
    assert!(inv["expires_at"].is_string());
    let code = inv["code"].as_str().unwrap();
    let (s, _) = app.post(&format!("/invites/{code}"), &a, json!({})).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = app.post(&format!("/invites/{code}"), &b, json!({})).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "max_uses reached");

    let (s, list) = app
        .get(
            &format!("/guilds/{}/invites", guild["id"].as_str().unwrap()),
            &owner,
        )
        .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        list.as_array().unwrap().is_empty(),
        "exhausted invites are not listed"
    );
}
