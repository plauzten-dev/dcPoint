//! Image uploads sent as data URIs (avatars, banners, guild icons).

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use bytes::Bytes;
use sha2::{Digest, Sha256};

use crate::error::{ApiError, ApiResult};
use crate::snowflake::Id;
use crate::state::AppState;
use crate::storage::sniff_image;

pub const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy)]
pub enum ImageKind {
    Avatar,
    Banner,
    Icon,
}

impl ImageKind {
    pub fn dir(self) -> &'static str {
        match self {
            ImageKind::Avatar => "avatars",
            ImageKind::Banner => "banners",
            ImageKind::Icon => "icons",
        }
    }
}

/// Decodes and validates a `data:image/...;base64,` URI.
pub fn decode_data_uri(uri: &str, field: &'static str) -> ApiResult<(Bytes, &'static str)> {
    let rest = uri
        .strip_prefix("data:")
        .ok_or(ApiError::field(field, "INVALID_IMAGE"))?;
    let (_, b64) = rest
        .split_once(";base64,")
        .ok_or(ApiError::field(field, "INVALID_IMAGE"))?;
    if b64.len() > MAX_IMAGE_BYTES * 4 / 3 + 4 {
        return Err(ApiError::field(field, "IMAGE_TOO_LARGE"));
    }
    let data = STANDARD
        .decode(b64.trim())
        .map_err(|_| ApiError::field(field, "INVALID_IMAGE"))?;
    let mime = sniff_image(&data).ok_or(ApiError::field(field, "INVALID_IMAGE"))?;
    Ok((Bytes::from(data), mime))
}

/// Stores the image and returns its hash (`a_` prefix marks animated GIFs).
pub async fn store_image(
    state: &AppState,
    kind: ImageKind,
    owner: Id,
    uri: &str,
    field: &'static str,
) -> ApiResult<String> {
    let (data, mime) = decode_data_uri(uri, field)?;
    let digest = Sha256::digest(&data);
    let hex: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    let hash = if mime == "image/gif" {
        format!("a_{hex}")
    } else {
        hex
    };
    state
        .storage
        .put(&format!("{}/{}/{}", kind.dir(), owner, hash), data, mime)
        .await?;
    Ok(hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_valid_png() {
        let png = STANDARD.encode(b"\x89PNG\r\n\x1a\n0000");
        let (data, mime) =
            decode_data_uri(&format!("data:image/png;base64,{png}"), "avatar").unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(data.len(), 12);
    }

    #[test]
    fn rejects_non_images() {
        let svg = STANDARD.encode(b"<svg onload=alert(1)>");
        assert!(decode_data_uri(&format!("data:image/svg+xml;base64,{svg}"), "avatar").is_err());
        assert!(decode_data_uri("http://example.com/x.png", "avatar").is_err());
        assert!(decode_data_uri("data:image/png;base64,!!!", "avatar").is_err());
    }
}
