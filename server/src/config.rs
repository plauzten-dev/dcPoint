use std::env;
use std::net::SocketAddr;

#[derive(Clone, Debug)]
pub struct S3Config {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    pub access_key: String,
    pub secret_key: String,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub database_url: String,
    pub db_max_connections: u32,
    /// Key for HMAC-signed short-lived tickets (MFA login).
    pub secret_key: Vec<u8>,
    pub cors_origins: Vec<String>,
    pub s3: Option<S3Config>,
    pub upload_dir: String,
    pub worker_id: u16,
    pub auth_rate_limit_per_min: u32,
    /// Trust X-Real-IP / X-Forwarded-For (only behind a reverse proxy).
    pub trust_proxy: bool,
    /// Maximum size of a single uploaded file (no paywall: the operator decides).
    pub max_upload_bytes: usize,
    /// Messages per user per 5 seconds (0 = unlimited).
    pub message_rate_limit: u32,
    /// Fetch link previews for URLs in messages.
    pub embeds_enabled: bool,
    /// Allow previews of private network addresses (tests only).
    pub allow_private_embeds: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let secret = env::var("SECRET_KEY").unwrap_or_default();
        if secret.len() < 32 {
            tracing::warn!(
                "SECRET_KEY missing or shorter than 32 chars - using an insecure development key"
            );
        }
        let s3 = match env::var("S3_ENDPOINT") {
            Ok(endpoint) if !endpoint.is_empty() => Some(S3Config {
                endpoint,
                bucket: var_or("S3_BUCKET", "dcpoint"),
                region: var_or("S3_REGION", "us-east-1"),
                access_key: env::var("S3_ACCESS_KEY")?,
                secret_key: env::var("S3_SECRET_KEY")?,
            }),
            _ => None,
        };
        Ok(Self {
            bind_addr: var_or("BIND_ADDR", "0.0.0.0:8080").parse()?,
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/dcpoint".into()),
            db_max_connections: var_or("DB_MAX_CONNECTIONS", "20").parse()?,
            secret_key: if secret.len() >= 32 {
                secret.into_bytes()
            } else {
                b"dev-insecure-secret-key-change-me!!".to_vec()
            },
            cors_origins: var_or(
                "CORS_ORIGINS",
                "http://localhost:5173,http://tauri.localhost,tauri://localhost",
            )
            .split(',')
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .collect(),
            s3,
            upload_dir: var_or("UPLOAD_DIR", "./data/uploads"),
            worker_id: var_or("WORKER_ID", "1").parse()?,
            auth_rate_limit_per_min: var_or("AUTH_RATE_LIMIT_PER_MIN", "30").parse()?,
            trust_proxy: var_or("TRUST_PROXY", "false").parse()?,
            max_upload_bytes: var_or("MAX_UPLOAD_MB", "50").parse::<usize>()? * 1024 * 1024,
            message_rate_limit: var_or("MESSAGE_RATE_LIMIT", "5").parse()?,
            embeds_enabled: var_or("EMBEDS_ENABLED", "true").parse()?,
            allow_private_embeds: false,
        })
    }

    /// Configuration for tests: local storage in a temp dir, no rate limiting.
    pub fn for_tests(database_url: String) -> Self {
        Self {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            database_url,
            db_max_connections: 5,
            secret_key: b"test-secret-key-test-secret-key-0000".to_vec(),
            cors_origins: vec![],
            s3: None,
            upload_dir: std::env::temp_dir()
                .join("dcpoint-test-uploads")
                .to_string_lossy()
                .into_owned(),
            worker_id: 1,
            auth_rate_limit_per_min: 0,
            trust_proxy: false,
            max_upload_bytes: 20 * 1024 * 1024,
            message_rate_limit: 0,
            embeds_enabled: true,
            allow_private_embeds: true,
        }
    }
}

fn var_or(key: &str, default: &str) -> String {
    env::var(key)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| default.to_owned())
}
