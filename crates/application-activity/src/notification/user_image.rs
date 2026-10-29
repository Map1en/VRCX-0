use std::time::Duration;

use serde_json::Value;
use vrcx_0_core::json::JsonExt;

use super::lookup_cache::{LookupCache, LookupCacheLimits};
use super::NotificationRemote;

const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

pub struct UserImageCache {
    lookups: LookupCache,
}

impl Default for UserImageCache {
    fn default() -> Self {
        Self::new()
    }
}

impl UserImageCache {
    pub fn new() -> Self {
        Self {
            lookups: LookupCache::new(LookupCacheLimits {
                success_capacity: 128,
                success_ttl: Duration::from_secs(15 * 60),
                failure_capacity: 32,
                failure_ttl: Duration::from_secs(60),
            }),
        }
    }

    pub async fn resolve(
        &self,
        remote: &dyn NotificationRemote,
        endpoint: &str,
        user_id: &str,
    ) -> Option<String> {
        let user_id = user_id.trim();
        if !user_id.starts_with("usr_") {
            return None;
        }
        let endpoint = endpoint.trim();
        if endpoint.is_empty() {
            return None;
        }
        self.lookups
            .resolve(user_id, fetch_user_image(remote, endpoint, user_id))
            .await
    }

    pub fn cached_url(&self, user_id: &str) -> Option<String> {
        let user_id = user_id.trim();
        if !user_id.starts_with("usr_") {
            return None;
        }
        self.lookups.cached(user_id)
    }
}

async fn fetch_user_image(
    remote: &dyn NotificationRemote,
    endpoint: &str,
    user_id: &str,
) -> Option<String> {
    let user = tokio::time::timeout(FETCH_TIMEOUT, remote.user(endpoint, user_id))
        .await
        .ok()??;
    image_url_from_user(&user, endpoint)
}

pub fn normalize_avatar_image_url_128(url: &str, endpoint: &str) -> String {
    let url = url.trim();
    if url.is_empty() {
        return String::new();
    }
    file_url_to_image_url_128(url, endpoint).unwrap_or_else(|| url.to_string())
}

fn image_url_from_user(user: &Value, endpoint: &str) -> Option<String> {
    user.trimmed_field("iconUrl")
        .map(|url| normalize_avatar_image_url_128(url, endpoint))
}

fn file_url_to_image_url_128(url: &str, endpoint: &str) -> Option<String> {
    let normalized = url.trim().trim_end_matches('/');
    let path = normalized.split('?').next().unwrap_or(normalized);
    let segments = path.split('/').collect::<Vec<_>>();
    let file_index = segments
        .windows(2)
        .position(|pair| matches!(pair[0], "file" | "image") && pair[1].starts_with("file_"))?;
    let kind = segments[file_index];
    let file_id = segments.get(file_index + 1)?;
    let version = segments.get(file_index + 2)?;
    if !is_vrchat_file_id(file_id) || !is_digits(version) {
        return None;
    }
    let trailing = segments.get(file_index + 3);
    let is_last = file_index + 4 == segments.len();
    match (kind, trailing) {
        ("file", None) => {}
        ("file", Some(&"file")) if is_last => {}
        ("image", Some(resolution)) if is_last && is_digits(resolution) => {}
        _ => return None,
    }
    let endpoint = endpoint.trim().trim_end_matches('/');
    if endpoint.is_empty() {
        return None;
    }
    Some(format!("{endpoint}/image/{file_id}/{version}/128"))
}

fn is_digits(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|value| value.is_ascii_digit())
}

fn is_vrchat_file_id(value: &str) -> bool {
    let Some(suffix) = value.strip_prefix("file_") else {
        return false;
    };
    !suffix.is_empty()
        && suffix
            .chars()
            .all(|value| value.is_ascii_hexdigit() || value == '-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn downscales_icon_url_to_128() {
        let user = json!({
            "iconUrl": "https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/2/256",
        });
        assert_eq!(
            image_url_from_user(&user, "https://api.vrchat.cloud/api/1").as_deref(),
            Some("https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/2/128")
        );
    }

    #[test]
    fn converts_icon_file_url_to_128() {
        let user = json!({
            "iconUrl": "https://api.vrchat.cloud/api/1/file/file_abcdefab-0000-1111-2222-abcdefabcdef/7/file",
        });
        assert_eq!(
            image_url_from_user(&user, "https://api.vrchat.cloud/api/1").as_deref(),
            Some("https://api.vrchat.cloud/api/1/image/file_abcdefab-0000-1111-2222-abcdefabcdef/7/128")
        );
    }

    #[test]
    fn keeps_unrecognized_icon_url() {
        let user = json!({
            "iconUrl": "https://img.example/avatar.png",
        });
        assert_eq!(
            image_url_from_user(&user, "https://api.vrchat.cloud/api/1").as_deref(),
            Some("https://img.example/avatar.png")
        );
    }

    #[test]
    fn returns_none_without_icon_url() {
        let user = json!({ "displayName": "Nobody", "iconUrl": " " });
        assert!(image_url_from_user(&user, "https://api.vrchat.cloud/api/1").is_none());
    }
}
