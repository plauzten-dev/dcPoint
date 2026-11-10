use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};

use crate::error::{ApiError, ApiPath, ApiResult};
use crate::state::AppState;
use crate::storage::sniff_image;

/// Serves stored images. Hashes are content addressed, so responses are immutable.
pub async fn get(
    State(state): State<AppState>,
    ApiPath((kind, owner, hash)): ApiPath<(String, String, String)>,
) -> ApiResult<Response> {
    if !matches!(kind.as_str(), "avatars" | "banners" | "icons") || owner.parse::<i64>().is_err() {
        return Err(ApiError::NotFound("UNKNOWN_ASSET"));
    }
    // Clients may append an extension (`.webp`); the stored key has none.
    let hash = hash.split('.').next().unwrap_or_default();
    if hash.is_empty()
        || !hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'_' || b == b'a')
    {
        return Err(ApiError::NotFound("UNKNOWN_ASSET"));
    }
    let data = state
        .storage
        .get(&format!("{kind}/{owner}/{hash}"))
        .await?
        .ok_or(ApiError::NotFound("UNKNOWN_ASSET"))?;
    let mime = sniff_image(&data).unwrap_or("application/octet-stream");
    let mut res = data.into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'"),
    );
    Ok(res)
}
