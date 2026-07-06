use std::time::Duration;

use vrcx_0_persistence::storage::StorageService;
use vrcx_0_vrchat_client::web_client::{WebClient as TransportWebClient, WebExecuteRequest};

use crate::Error;

pub const PROXY_STORAGE_KEY: &str = "VRCX_ProxyServer";
pub const PROXY_ENABLED_STORAGE_KEY: &str = "VRCX_ProxyEnabled";
const PROXY_TEST_TIMEOUT: Duration = Duration::from_secs(10);
const VRC_STATUS_TEST_URL: &str = "https://status.vrchat.com/api/v2/status.json";

fn proxy_authority(candidate: &str) -> &str {
    let value = candidate
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(candidate);
    value
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(value)
        .rsplit_once('@')
        .map(|(_, authority)| authority)
        .unwrap_or(value)
}

fn explicit_proxy_port(authority: &str) -> Option<&str> {
    if let Some(rest) = authority.strip_prefix('[') {
        let (_, after_host) = rest.split_once(']')?;
        let port = after_host.strip_prefix(':')?;
        return (!port.is_empty() && port.chars().all(|ch| ch.is_ascii_digit())).then_some(port);
    }

    let (_, port) = authority.rsplit_once(':')?;
    (!port.is_empty() && port.chars().all(|ch| ch.is_ascii_digit())).then_some(port)
}

fn normalize_proxy_url(value: &str) -> Result<Option<String>, Error> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let explicit_port = explicit_proxy_port(proxy_authority(&candidate));
    let url = url::Url::parse(&candidate)
        .map_err(|error| Error::Custom(format!("Invalid proxy URL: {error}")))?;

    let scheme = url.scheme();
    if scheme != "http" && scheme != "socks5" {
        return Err(Error::Custom(format!("Unsupported proxy scheme: {scheme}")));
    }

    url.host()
        .ok_or_else(|| Error::Custom("Proxy URL is missing a host".into()))?;
    if url.port().is_none() {
        if explicit_port.is_some() {
            return Err(Error::Custom(format!(
                "{scheme} proxy URLs using the default port are not supported by the WebView proxy"
            )));
        }
        return Err(Error::Custom("Proxy URL is missing a port".into()));
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(Error::Custom(
            "Proxy URL credentials are not supported".into(),
        ));
    }
    if (!url.path().is_empty() && url.path() != "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::Custom(
            "Proxy URL must only contain scheme, host, and port".into(),
        ));
    }

    let normalized = url.to_string();
    Ok(Some(normalized.trim_end_matches('/').to_string()))
}

fn parse_enabled_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "yes" | "on"
    )
}

fn resolve_proxy_enabled(raw_enabled: Option<&str>, raw_proxy_url: &str) -> bool {
    raw_enabled
        .map(parse_enabled_value)
        .unwrap_or_else(|| !raw_proxy_url.trim().is_empty())
}

fn resolve_proxy_url(
    raw_enabled: Option<&str>,
    raw_proxy_url: &str,
) -> Result<Option<String>, Error> {
    if !resolve_proxy_enabled(raw_enabled, raw_proxy_url) {
        return Ok(None);
    }
    normalize_proxy_url(raw_proxy_url)
}

pub fn load_proxy_url(storage: &StorageService) -> Option<String> {
    let raw_enabled = storage.get(PROXY_ENABLED_STORAGE_KEY);
    let raw_proxy_url = storage.get(PROXY_STORAGE_KEY).unwrap_or_default();
    match resolve_proxy_url(raw_enabled.as_deref(), &raw_proxy_url) {
        Ok(proxy_url) => proxy_url,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "invalid proxy setting; using direct connection"
            );
            None
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProxySettingsTestResult {
    pub normalized_proxy: Option<String>,
    pub status: i32,
}

pub async fn test_proxy_connectivity(
    proxy_url: &str,
    app_version: &str,
) -> Result<ProxySettingsTestResult, Error> {
    let normalized_proxy = normalize_proxy_url(proxy_url)?;
    let client = TransportWebClient::new(normalized_proxy.clone(), None, app_version)?;
    let mut request = WebExecuteRequest::new(VRC_STATUS_TEST_URL.into(), "GET".into());
    request
        .headers
        .push(("Referer".into(), "https://vrcx.app".into()));
    let (status, data) = tokio::time::timeout(PROXY_TEST_TIMEOUT, client.execute(request))
        .await
        .map_err(|_| Error::Custom("Proxy test timed out.".into()))??;
    if status == -1 {
        return Err(Error::Custom(data));
    }
    if !(200..400).contains(&status) {
        return Err(Error::Custom(format!("Proxy test returned HTTP {status}.")));
    }
    Ok(ProxySettingsTestResult {
        normalized_proxy,
        status,
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn storage(name: &str) -> (TestDir, StorageService) {
        let dir = TestDir::new(name);
        let path = dir.path.join("storage.json");
        let storage = StorageService::new(&path).unwrap();
        (dir, storage)
    }

    #[test]
    fn load_proxy_url_uses_legacy_non_empty_address_when_enabled_key_is_missing() {
        let (_dir, storage) = storage("legacy-proxy-enabled");
        storage.set(PROXY_STORAGE_KEY.into(), "127.0.0.1:7890".into());

        assert_eq!(
            load_proxy_url(&storage).as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn load_proxy_url_uses_direct_when_enabled_key_is_missing_and_address_is_empty() {
        let (_dir, storage) = storage("legacy-proxy-empty");
        storage.set(PROXY_STORAGE_KEY.into(), "".into());

        assert_eq!(load_proxy_url(&storage), None);
    }

    #[test]
    fn load_proxy_url_uses_direct_when_proxy_is_disabled_even_with_address() {
        let (_dir, storage) = storage("proxy-disabled");
        storage.set(PROXY_ENABLED_STORAGE_KEY.into(), "false".into());
        storage.set(PROXY_STORAGE_KEY.into(), "127.0.0.1:7890".into());

        assert_eq!(load_proxy_url(&storage), None);
        assert_eq!(
            storage.get(PROXY_STORAGE_KEY).as_deref(),
            Some("127.0.0.1:7890")
        );
    }

    #[test]
    fn load_proxy_url_uses_direct_when_proxy_enabled_but_address_empty() {
        let (_dir, storage) = storage("proxy-enabled-empty");
        storage.set(PROXY_ENABLED_STORAGE_KEY.into(), "true".into());
        storage.set(PROXY_STORAGE_KEY.into(), "".into());

        assert_eq!(load_proxy_url(&storage), None);
        assert_eq!(
            storage.get(PROXY_ENABLED_STORAGE_KEY).as_deref(),
            Some("true")
        );
    }

    #[test]
    fn load_proxy_url_keeps_invalid_address_configured() {
        let (_dir, storage) = storage("proxy-invalid");
        storage.set(PROXY_ENABLED_STORAGE_KEY.into(), "true".into());
        storage.set(PROXY_STORAGE_KEY.into(), "https://127.0.0.1:7890".into());

        assert_eq!(load_proxy_url(&storage), None);
        assert_eq!(
            storage.get(PROXY_STORAGE_KEY).as_deref(),
            Some("https://127.0.0.1:7890")
        );
        assert_eq!(
            storage.get(PROXY_ENABLED_STORAGE_KEY).as_deref(),
            Some("true")
        );
    }
}
