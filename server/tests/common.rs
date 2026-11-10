#![allow(dead_code)]

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use dcpoint::config::Config;
use dcpoint::storage::Storage;
use dcpoint::{AppState, router};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

pub struct TestApp {
    pub app: Router,
    pub state: AppState,
}

impl TestApp {
    pub async fn new(pool: PgPool) -> Self {
        let cfg = Config::for_tests(String::new());
        let storage = Storage::from_config(&cfg).await.unwrap();
        let state = AppState::new(cfg, pool, storage);
        Self {
            app: router(state.clone()),
            state,
        }
    }

    pub async fn req(
        &self,
        method: Method,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut b = Request::builder()
            .method(method)
            .uri(format!("/api/v1{path}"));
        if let Some(t) = token {
            b = b.header("authorization", t);
        }
        let req = match body {
            Some(v) => b
                .header("content-type", "application/json")
                .body(Body::from(v.to_string()))
                .unwrap(),
            None => b.body(Body::empty()).unwrap(),
        };
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let v = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::Null)
        };
        (status, v)
    }

    pub async fn get(&self, path: &str, token: &str) -> (StatusCode, Value) {
        self.req(Method::GET, path, Some(token), None).await
    }

    pub async fn post(&self, path: &str, token: &str, body: Value) -> (StatusCode, Value) {
        self.req(Method::POST, path, Some(token), Some(body)).await
    }

    pub async fn patch(&self, path: &str, token: &str, body: Value) -> (StatusCode, Value) {
        self.req(Method::PATCH, path, Some(token), Some(body)).await
    }

    pub async fn delete(&self, path: &str, token: &str) -> (StatusCode, Value) {
        self.req(Method::DELETE, path, Some(token), None).await
    }

    /// Registers a user and returns (token, user id).
    pub async fn register(&self, name: &str) -> (String, String) {
        let (status, body) = self
            .req(
                Method::POST,
                "/auth/register",
                None,
                Some(json!({ "email": format!("{name}@example.com"), "username": name, "password": "hunter2hunter2" })),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        (
            body["token"].as_str().unwrap().to_owned(),
            body["user"]["id"].as_str().unwrap().to_owned(),
        )
    }

    /// Creates a guild and returns its payload.
    pub async fn create_guild(&self, token: &str, name: &str) -> Value {
        let (status, body) = self.post("/guilds", token, json!({ "name": name })).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        body
    }

    pub async fn invite(&self, token: &str, channel_id: &str) -> String {
        let (status, body) = self
            .post(&format!("/channels/{channel_id}/invites"), token, json!({}))
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        body["code"].as_str().unwrap().to_owned()
    }
}

pub fn channel_by_name<'a>(guild: &'a Value, name: &str) -> &'a Value {
    guild["channels"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("no channel {name}"))
}
