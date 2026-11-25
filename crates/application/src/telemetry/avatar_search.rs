use vrcx_0_contracts::telemetry::TelemetryErrorDetail;

use super::privacy::build_error_detail;

pub(super) fn avatar_search_failure_detail(
    provider_url: &str,
    status: i32,
    app_version: &str,
) -> TelemetryErrorDetail {
    let provider = provider_host(provider_url);
    let code = format!("http_{status}");
    let summary = format!("provider={provider}; status={status}");
    build_error_detail(
        "rust_error",
        Some("avatar_search"),
        Some(&code),
        None,
        Some(&summary),
        Some(app_version),
    )
}

fn provider_host(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let host = match host_port.strip_prefix('[') {
        Some(ipv6) => ipv6.split(']').next().unwrap_or_default(),
        None => host_port.split(':').next().unwrap_or_default(),
    };
    if host.is_empty() {
        "unknown".into()
    } else {
        host.to_ascii_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT_URL: &str = "https://api.avtrdb.com/v3/avatar/search/vrcx?search=miku&n=5000";

    #[test]
    fn origin_error_is_reported_with_provider_host() {
        let detail = avatar_search_failure_detail(DEFAULT_URL, 429, "2.40.0");
        assert_eq!(detail.kind, "rust_error");
        assert_eq!(detail.source.as_deref(), Some("avatar_search"));
        assert_eq!(detail.code.as_deref(), Some("http_429"));
        assert_eq!(detail.name, None);
        assert_eq!(
            detail.summary.as_deref(),
            Some("provider=api.avtrdb.com; status=429")
        );
        assert_eq!(detail.app_version.as_deref(), Some("2.40.0"));
    }

    #[test]
    fn custom_provider_reports_only_its_domain() {
        let detail = avatar_search_failure_detail(
            "https://user:secret@Avatars.Example.org:8443/vrcx_search.php?search=miku",
            403,
            "2.40.0",
        );
        assert_eq!(
            detail.summary.as_deref(),
            Some("provider=avatars.example.org; status=403")
        );
    }
}
