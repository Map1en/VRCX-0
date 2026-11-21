use vrcx_0_contracts::telemetry::TelemetryErrorDetail;

use super::privacy::build_error_detail;
use crate::avatars::cloudflare_block;

pub(super) fn avatar_search_failure_detail(
    provider_url: &str,
    status: i32,
    body: &str,
    app_version: &str,
) -> TelemetryErrorDetail {
    let provider = provider_host(provider_url);
    let block = cloudflare_block(body);
    let code = format!("http_{status}");
    let summary = match block.as_deref() {
        Some(block) => format!("provider={provider}; status={status}; block={block}"),
        None => format!("provider={provider}; status={status}"),
    };
    build_error_detail(
        "rust_error",
        Some("avatar_search"),
        Some(&code),
        block.as_deref(),
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
    fn cloudflare_block_is_reported_with_provider_host() {
        let detail = avatar_search_failure_detail(DEFAULT_URL, 403, "error code: 1020", "2.40.0");
        assert_eq!(detail.kind, "rust_error");
        assert_eq!(detail.source.as_deref(), Some("avatar_search"));
        assert_eq!(detail.code.as_deref(), Some("http_403"));
        assert_eq!(detail.name.as_deref(), Some("cf_1020"));
        assert_eq!(
            detail.summary.as_deref(),
            Some("provider=api.avtrdb.com; status=403; block=cf_1020")
        );
        assert_eq!(detail.app_version.as_deref(), Some("2.40.0"));
    }

    #[test]
    fn cloudflare_ray_id_is_not_reported() {
        let body = r#"<html><body><span class="cf-error-type">Error</span> <span class="cf-error-code">1010</span>
            <span class="cf-footer-item">Cloudflare Ray ID: <strong>8a1b2c3d4e5f6a7b</strong></span></body></html>"#;
        let detail = avatar_search_failure_detail(DEFAULT_URL, 403, body, "2.40.0");
        assert_eq!(detail.name.as_deref(), Some("cf_1010"));
        assert!(!detail
            .summary
            .unwrap_or_default()
            .contains("8a1b2c3d4e5f6a7b"));
    }

    #[test]
    fn origin_error_without_cloudflare_marker_has_no_block() {
        let detail = avatar_search_failure_detail(
            DEFAULT_URL,
            429,
            r#"{"message":"rate limited"}"#,
            "2.40.0",
        );
        assert_eq!(detail.code.as_deref(), Some("http_429"));
        assert_eq!(detail.name, None);
        assert_eq!(
            detail.summary.as_deref(),
            Some("provider=api.avtrdb.com; status=429")
        );
    }

    #[test]
    fn custom_provider_reports_only_its_domain() {
        let detail = avatar_search_failure_detail(
            "https://user:secret@Avatars.Example.org:8443/vrcx_search.php?search=miku",
            403,
            "",
            "2.40.0",
        );
        assert_eq!(
            detail.summary.as_deref(),
            Some("provider=avatars.example.org; status=403")
        );
    }
}
