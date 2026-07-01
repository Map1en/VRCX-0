use vrcx_0_persistence::storage::StorageService;

use crate::Error;

pub const PROXY_STORAGE_KEY: &str = "VRCX_ProxyServer";

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

pub fn load_proxy_url(storage: &StorageService) -> Option<String> {
    let raw_proxy_url = storage.get(PROXY_STORAGE_KEY)?;
    match normalize_proxy_url(&raw_proxy_url) {
        Ok(proxy_url) => proxy_url,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "invalid proxy setting; clearing VRCX_ProxyServer"
            );
            storage.remove(PROXY_STORAGE_KEY);
            if let Err(error) = storage.save() {
                tracing::warn!(?error, "failed to persist cleared proxy setting");
            }
            None
        }
    }
}
