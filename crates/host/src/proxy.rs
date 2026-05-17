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

pub fn normalize_proxy_url(value: &str) -> Result<Option<String>, Error> {
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

#[cfg(test)]
mod tests {
    use super::normalize_proxy_url;

    #[test]
    fn normalizes_host_port_without_scheme() {
        assert_eq!(
            normalize_proxy_url("127.0.0.1:8080").unwrap().as_deref(),
            Some("http://127.0.0.1:8080")
        );
    }

    #[test]
    fn accepts_socks5_proxy_with_explicit_port() {
        assert_eq!(
            normalize_proxy_url("socks5://localhost:1080")
                .unwrap()
                .as_deref(),
            Some("socks5://localhost:1080")
        );
    }

    #[test]
    fn rejects_credentials_and_paths() {
        assert!(normalize_proxy_url("http://user:pass@localhost:8080").is_err());
        assert!(normalize_proxy_url("http://localhost:8080/path").is_err());
    }

    #[test]
    fn treats_empty_proxy_as_disabled() {
        assert_eq!(normalize_proxy_url("  ").unwrap(), None);
    }
}
