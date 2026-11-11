mod common;

use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use axum::routing::get;
use common::{TestApp, channel_by_name};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0, 0,
    1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
];

async fn site() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let html = String::from(
        r##"<html><head><title>Ignoriert</title>
        <meta property="og:title" content="dcPoint &amp; Freunde">
        <meta property="og:description" content="Eine Vorschau">
        <meta property="og:image" content="/bild.png">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="theme-color" content="#6c5cf6"></head></html>"##
    );
    let app = Router::new()
        .route(
            "/artikel",
            get(
                move || async move { ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html) },
            ),
        )
        .route(
            "/bild.png",
            get(|| async { ([(header::CONTENT_TYPE, "image/png")], PNG) }),
        )
        .route(
            "/fake.png",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "image/png")],
                    "<svg onload=alert(1)>",
                )
            }),
        );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

async fn raw_get(app: &TestApp, path: &str) -> (StatusCode, Vec<u8>) {
    let res = app
        .app
        .clone()
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status();
    (
        status,
        res.into_body().collect().await.unwrap().to_bytes().to_vec(),
    )
}

#[sqlx::test(migrations = "./migrations")]
async fn link_previews_and_image_proxy(pool: PgPool) {
    let app = TestApp::new(pool).await;
    let base = site().await;
    let (token, _) = app.register("owner").await;
    let guild = app.create_guild(&token, "Embeds").await;
    let ch = channel_by_name(&guild, "allgemein")["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let (s, _) = app
        .post(
            &format!("/channels/{ch}/messages"),
            &token,
            json!({ "content": format!("Lies das: {base}/artikel und <{base}/bild.png>") }),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED);

    let mut embeds = Value::Null;
    for _ in 0..50 {
        let (_, list) = app.get(&format!("/channels/{ch}/messages"), &token).await;
        embeds = list[0]["embeds"].clone();
        if embeds.as_array().is_some_and(|a| !a.is_empty()) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let e = &embeds[0];
    assert_eq!(
        embeds.as_array().unwrap().len(),
        1,
        "suppressed <url> must not be embedded: {embeds}"
    );
    assert_eq!(e["type"], "link");
    assert_eq!(e["title"], "dcPoint & Freunde");
    assert_eq!(e["description"], "Eine Vorschau");
    assert_eq!(e["color"], "#6c5cf6");
    assert_eq!(e["large"], true);
    let img = e["image"]["url"].as_str().unwrap();
    assert!(img.starts_with("/cdn/proxy?url="), "{img}");
    assert!(
        !img.contains("127.0.0.1:"),
        "external URL must be encoded: {img}"
    );

    let (s, body) = raw_get(&app, img).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(body, PNG);

    // forged signature or non-image content -> 404
    let (s, _) = raw_get(&app, &format!("{}0", img)).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let fake = app.state.embedder.proxied(&format!("{base}/fake.png"));
    let (s, _) = raw_get(&app, &fake).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
