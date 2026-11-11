//! Link previews (OpenGraph) and a signed image proxy.
//!
//! Privacy: external images are always loaded through our server, so third-party
//! sites never see the IP addresses of users. Security: the fetcher refuses
//! private, loopback and link-local addresses (SSRF), limits redirects, response
//! size and time.

use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use hmac::{Hmac, Mac};
use regex::Regex;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::{Client, Url, redirect};
use serde::Serialize;
use sha2::Sha256;

use crate::gateway::events;
use crate::models::MessageRow;
use crate::snowflake::Id;
use crate::state::AppState;

const MAX_HTML: usize = 512 * 1024;
pub const MAX_IMAGE: usize = 8 * 1024 * 1024;
const MAX_EMBEDS: usize = 3;
const CACHE_TTL: Duration = Duration::from_secs(3600);

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct EmbedImage {
    /// Proxied URL (relative to the API origin).
    pub url: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Embed {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<EmbedImage>,
    /// Show the image large (summary_large_image) instead of as a thumbnail.
    pub large: bool,
}

/// Whether an address may be contacted by the server on behalf of users.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                || o[0] == 0
                || (o[0] == 100 && (64..128).contains(&o[1])) // CGNAT
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)
                || (o[0] == 198 && (18..20).contains(&o[1]))
                || o[0] >= 224)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(v4));
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80) // link local
        }
    }
}

/// DNS resolver that drops non-public addresses (unless explicitly allowed for tests).
struct SafeResolver {
    allow_private: bool,
}

impl Resolve for SafeResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        let allow_private = self.allow_private;
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .filter(|a| allow_private || is_public_ip(a.ip()))
                .collect();
            if addrs.is_empty() {
                return Err("host resolves to no public address".into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

pub struct Embedder {
    client: Client,
    allow_private: bool,
    key: Vec<u8>,
    cache: DashMap<String, (Instant, Option<Embed>)>,
}

impl Embedder {
    pub fn new(key: Vec<u8>, allow_private: bool) -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (compatible; dcPointBot/0.1; +link-preview)")
            .timeout(Duration::from_secs(6))
            .connect_timeout(Duration::from_secs(3))
            .redirect(redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() >= 3 {
                    attempt.error("too many redirects")
                } else if url_allowed(attempt.url(), allow_private) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .dns_resolver(Arc::new(SafeResolver { allow_private }))
            .build()
            .expect("http client");
        Self {
            client,
            allow_private,
            key,
            cache: DashMap::new(),
        }
    }

    fn sign(&self, url: &str) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key).expect("hmac key");
        mac.update(url.as_bytes());
        mac.finalize().into_bytes()[..16]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    pub fn verify(&self, url: &str, sig: &str) -> bool {
        crate::auth::token::constant_time_eq(self.sign(url).as_bytes(), sig.as_bytes())
    }

    /// Signed proxy path for an external image.
    pub fn proxied(&self, url: &str) -> String {
        format!("/cdn/proxy?url={}&sig={}", urlencode(url), self.sign(url))
    }

    /// Fetches a URL with size limit; returns (content type, body).
    pub async fn fetch(&self, url: &str, limit: usize) -> Option<(String, Vec<u8>)> {
        let parsed = Url::parse(url).ok()?;
        if !url_allowed(&parsed, self.allow_private) {
            return None;
        }
        let mut res = self.client.get(parsed).send().await.ok()?;
        if !res.status().is_success()
            || res
                .content_length()
                .is_some_and(|l| l as usize > limit && limit == MAX_IMAGE)
        {
            return None;
        }
        let ct = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let mut body = Vec::new();
        while let Ok(Some(chunk)) = res.chunk().await {
            body.extend_from_slice(&chunk);
            if body.len() >= limit {
                if limit == MAX_IMAGE {
                    return None; // never serve truncated images
                }
                body.truncate(limit);
                break;
            }
        }
        Some((ct, body))
    }

    async fn embed_for(&self, url: &str) -> Option<Embed> {
        if let Some(hit) = self.cache.get(url)
            && hit.0.elapsed() < CACHE_TTL
        {
            return hit.1.clone();
        }
        let result = self.build(url).await;
        if self.cache.len() > 5_000 {
            self.cache.retain(|_, (t, _)| t.elapsed() < CACHE_TTL);
        }
        self.cache
            .insert(url.to_owned(), (Instant::now(), result.clone()));
        result
    }

    async fn build(&self, url: &str) -> Option<Embed> {
        let (ct, body) = self.fetch(url, MAX_HTML).await?;
        if ct.starts_with("image/") {
            return Some(Embed {
                kind: "image",
                url: url.to_owned(),
                title: None,
                description: None,
                site_name: None,
                color: None,
                image: Some(EmbedImage {
                    url: self.proxied(url),
                }),
                large: true,
            });
        }
        if !ct.contains("html") {
            return None;
        }
        let html = String::from_utf8_lossy(&body);
        let meta = parse_meta(&html);
        let base = Url::parse(url).ok()?;
        let title = meta
            .get("og:title")
            .or(meta.get("twitter:title"))
            .cloned()
            .or_else(|| parse_title(&html));
        let description = meta
            .get("og:description")
            .or(meta.get("twitter:description"))
            .or(meta.get("description"))
            .cloned();
        if title.is_none() && description.is_none() {
            return None;
        }
        let image = meta
            .get("og:image")
            .or(meta.get("og:image:url"))
            .or(meta.get("twitter:image"))
            .and_then(|i| base.join(i).ok())
            .filter(|u| matches!(u.scheme(), "http" | "https"))
            .map(|u| EmbedImage {
                url: self.proxied(u.as_str()),
            });
        Some(Embed {
            kind: "link",
            url: url.to_owned(),
            title: title.map(|t| truncate(&t, 256)),
            description: description.map(|d| truncate(&d, 350)),
            site_name: meta
                .get("og:site_name")
                .map(|s| truncate(s, 100))
                .or_else(|| base.host_str().map(str::to_owned)),
            color: meta
                .get("theme-color")
                .filter(|c| c.starts_with('#') && c.len() <= 9)
                .cloned(),
            large: meta
                .get("twitter:card")
                .is_some_and(|c| c == "summary_large_image"),
            image,
        })
    }
}

fn url_allowed(url: &Url, allow_private: bool) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    match url.host() {
        Some(url::Host::Ipv4(ip)) => allow_private || is_public_ip(IpAddr::V4(ip)),
        Some(url::Host::Ipv6(ip)) => allow_private || is_public_ip(IpAddr::V6(ip)),
        Some(url::Host::Domain(d)) => {
            allow_private
                || !(d == "localhost"
                    || d.ends_with(".localhost")
                    || d.ends_with(".local")
                    || d.ends_with(".internal"))
        }
        None => false,
    }
}

fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        s.to_owned()
    } else {
        format!(
            "{}…",
            s.chars().take(max - 1).collect::<String>().trim_end()
        )
    }
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

static META_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<meta\s[^>]*>").unwrap());
static ATTR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?is)([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
static TITLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap());
static URL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(<)?(https?://[^\s<>"]+[^\s<>"'.,:;)\]!?])(>)?"#).unwrap());
static CODE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)```.*?```|`[^`]*`").unwrap());

pub fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest.find(';').filter(|e| *e <= 10);
        let decoded = end.and_then(|e| {
            let ent = &rest[1..e];
            let c = match ent {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" | "#39" => Some('\''),
                "nbsp" => Some(' '),
                _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                    u32::from_str_radix(&ent[2..], 16)
                        .ok()
                        .and_then(char::from_u32)
                }
                _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
                _ => None,
            };
            c.map(|c| (c, e))
        });
        match decoded {
            Some((c, e)) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// `<meta property|name=... content=...>` pairs (lowercased keys, first wins).
pub fn parse_meta(html: &str) -> std::collections::HashMap<String, String> {
    let head = &html[..html.len().min(MAX_HTML)];
    let mut out = std::collections::HashMap::new();
    for tag in META_RE.find_iter(head) {
        let mut key = None;
        let mut content = None;
        for a in ATTR_RE.captures_iter(tag.as_str()) {
            let value = a.get(2).or(a.get(3)).map_or("", |m| m.as_str());
            match a[1].to_ascii_lowercase().as_str() {
                "property" | "name" => key = Some(value.to_ascii_lowercase()),
                "content" => content = Some(decode_entities(value).trim().to_owned()),
                _ => {}
            }
        }
        if let (Some(k), Some(c)) = (key, content)
            && !c.is_empty()
        {
            out.entry(k).or_insert(c);
        }
    }
    out
}

fn parse_title(html: &str) -> Option<String> {
    TITLE_RE
        .captures(html)
        .map(|c| decode_entities(c[1].trim()))
        .filter(|t| !t.is_empty())
}

/// Embeddable URLs in a message: not inside code, not wrapped in `<...>` (suppressed).
pub fn extract_urls(content: &str) -> Vec<String> {
    let without_code = CODE_RE.replace_all(content, " ");
    let mut out: Vec<String> = Vec::new();
    for c in URL_RE.captures_iter(&without_code) {
        if c.get(1).is_some() && c.get(3).is_some() {
            continue;
        }
        let url = c[2].to_owned();
        if !out.contains(&url) {
            out.push(url);
        }
        if out.len() >= MAX_EMBEDS {
            break;
        }
    }
    out
}

/// Fetches previews in the background and updates the message when done.
pub fn spawn_embed_job(state: &AppState, message_id: Id, content: &str) {
    let urls = extract_urls(content);
    if urls.is_empty() || !state.cfg.embeds_enabled {
        return;
    }
    let state = state.clone();
    tokio::spawn(async move {
        let fetched =
            futures_util::future::join_all(urls.iter().map(|u| state.embedder.embed_for(u))).await;
        let embeds: Vec<Embed> = fetched.into_iter().flatten().collect();
        if embeds.is_empty() {
            return;
        }
        let row: Option<MessageRow> =
            match sqlx::query_as("UPDATE messages SET embeds = $2 WHERE id = $1 RETURNING *")
                .bind(message_id)
                .bind(sqlx::types::Json(&embeds))
                .fetch_optional(&state.db)
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    tracing::warn!(error = %e, "storing embeds failed");
                    return;
                }
            };
        let Some(row) = row else { return };
        let Ok(channel) = crate::access::fetch_channel(&state.db, row.channel_id).await else {
            return;
        };
        let author = row.author_id.unwrap_or(Id(0));
        if let Ok(mut list) =
            crate::routes::messages::hydrate(&state, vec![row], channel.guild_id, author, false)
                .await
            && let Some(m) = list.pop()
        {
            let _ = state
                .dispatch_to_viewers(&channel, events::MESSAGE_UPDATE, &m, None)
                .await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_addresses_are_rejected() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "192.168.0.1",
            "172.16.5.4",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"] {
            assert!(is_public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(!url_allowed(
            &Url::parse("http://localhost:8080").unwrap(),
            false
        ));
        assert!(!url_allowed(&Url::parse("http://[::1]/").unwrap(), false));
        assert!(!url_allowed(
            &Url::parse("file:///etc/passwd").unwrap(),
            false
        ));
        assert!(url_allowed(
            &Url::parse("https://example.com/x").unwrap(),
            false
        ));
    }

    #[test]
    fn meta_parsing() {
        let html = r##"<html><head><title>Fallback &amp; Titel</title>
            <meta property="og:title" content="Hallo &quot;Welt&quot;">
            <meta content='Eine Beschreibung' name='description'>
            <META PROPERTY="og:image" CONTENT="/bild.png">
            <meta name="theme-color" content="#6c5cf6"></head>"##;
        let m = parse_meta(html);
        assert_eq!(m["og:title"], "Hallo \"Welt\"");
        assert_eq!(m["description"], "Eine Beschreibung");
        assert_eq!(m["og:image"], "/bild.png");
        assert_eq!(parse_title(html).unwrap(), "Fallback & Titel");
        assert_eq!(decode_entities("&#x41;&#66;&unknown; &"), "AB&unknown; &");
    }

    #[test]
    fn url_extraction() {
        assert_eq!(
            extract_urls("schau https://a.de/x. und <https://b.de> `https://c.de` https://a.de/x"),
            vec!["https://a.de/x"]
        );
        assert_eq!(
            extract_urls("```\nhttps://code.de\n``` (https://d.de/p?q=1)"),
            vec!["https://d.de/p?q=1"]
        );
        assert_eq!(
            extract_urls("1 https://1.de 2 https://2.de 3 https://3.de 4 https://4.de").len(),
            3
        );
    }
}
