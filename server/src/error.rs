use std::collections::BTreeMap;

use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;

pub type ApiResult<T> = Result<T, ApiError>;

/// Field name -> machine readable error code (translated by the client).
pub type FieldErrors = BTreeMap<&'static str, &'static str>;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("invalid form body")]
    Validation(FieldErrors),
    #[error("bad request: {0}")]
    BadRequest(&'static str),
    #[error("unauthorized")]
    Unauthorized,
    #[error("missing permissions")]
    MissingPermissions,
    #[error("forbidden: {0}")]
    Forbidden(&'static str),
    #[error("not found: {0}")]
    NotFound(&'static str),
    #[error("too many requests")]
    RateLimited { retry_after_secs: u64 },
    #[error("payload too large")]
    PayloadTooLarge,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl ApiError {
    pub fn field(field: &'static str, code: &'static str) -> Self {
        ApiError::Validation(BTreeMap::from([(field, code)]))
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::Internal(e.into())
    }
}

impl From<JsonRejection> for ApiError {
    fn from(_: JsonRejection) -> Self {
        ApiError::BadRequest("INVALID_JSON")
    }
}

impl From<PathRejection> for ApiError {
    fn from(_: PathRejection) -> Self {
        ApiError::NotFound("UNKNOWN_RESOURCE")
    }
}

impl From<QueryRejection> for ApiError {
    fn from(_: QueryRejection) -> Self {
        ApiError::BadRequest("INVALID_QUERY")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, errors) = match &self {
            ApiError::Validation(f) => (StatusCode::BAD_REQUEST, "INVALID_FORM_BODY", Some(f)),
            ApiError::BadRequest(c) => (StatusCode::BAD_REQUEST, *c, None),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", None),
            ApiError::MissingPermissions => (StatusCode::FORBIDDEN, "MISSING_PERMISSIONS", None),
            ApiError::Forbidden(c) => (StatusCode::FORBIDDEN, *c, None),
            ApiError::NotFound(c) => (StatusCode::NOT_FOUND, *c, None),
            ApiError::RateLimited { .. } => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", None),
            ApiError::PayloadTooLarge => (StatusCode::PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", None),
            ApiError::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", None)
            }
        };
        let mut body = json!({ "code": code, "message": self.to_string() });
        if let Some(errors) = errors {
            body["errors"] = json!(errors);
        }
        let mut res = (status, axum::Json(body)).into_response();
        if let ApiError::RateLimited { retry_after_secs } = self {
            res.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(retry_after_secs));
        }
        res
    }
}

/// `Json` extractor that reports malformed bodies in our error format.
#[derive(axum::extract::FromRequest)]
#[from_request(via(axum::Json), rejection(ApiError))]
pub struct ApiJson<T>(pub T);

/// `Path` extractor that reports malformed ids as 404 in our error format.
#[derive(axum::extract::FromRequestParts)]
#[from_request(via(axum::extract::Path), rejection(ApiError))]
pub struct ApiPath<T>(pub T);

/// `Query` extractor in our error format.
#[derive(axum::extract::FromRequestParts)]
#[from_request(via(axum::extract::Query), rejection(ApiError))]
pub struct ApiQuery<T>(pub T);

/// Returns true for PostgreSQL unique violations on the given constraint/index.
pub fn is_unique_violation(err: &sqlx::Error, constraint: &str) -> bool {
    match err {
        sqlx::Error::Database(db) => {
            db.code().as_deref() == Some("23505") && db.constraint() == Some(constraint)
        }
        _ => false,
    }
}
