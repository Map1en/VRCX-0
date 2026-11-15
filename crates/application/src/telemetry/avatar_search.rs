use std::sync::LazyLock;

use regex::Regex;
use vrcx_0_contracts::telemetry::TelemetryErrorDetail;

use super::privacy::build_error_detail;

const DEFAULT_PROVIDER_HOST: &str = "api.avtrdb.com";

static CLOUDFLARE_ERROR_CODE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)error[\s-]*(?:code)?\W{0,4}(?:<[^>]*>\W{0,4})*(1\d{3})\b").unwrap()
});

pub(super) fn avatar_search_failure_detail(
    provider_url: &str,
    status: i32,
    body: &str,
    app_version: &str,
) -> TelemetryErrorDetail {
    let provider = provider_label(provider_url);
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

fn provider_label(url: &str) -> &'static str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let host = rest.split(['/', '?', '#', ':']).next().unwrap_or_default();
    if host.eq_ignore_ascii_case(DEFAULT_PROVIDER_HOST) {
        "avtrdb"
    } else {
        "custom"
    }
}

fn cloudflare_block(body: &str) -> Option<String> {
    if body.contains("cf-chl") || body.contains("challenge-platform") {
        return Some("cf_challenge".into());
    }
    CLOUDFLARE_ERROR_CODE_PATTERN
        .captures(body)
        .map(|captures| format!("cf_{}", &captures[1]))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT_URL: &str = "https://api.avtrdb.com/v3/avatar/search/vrcx?search=miku&n=5000";

    #[test]
    fn plain_text_cloudflare_error_code_is_classified() {
        let detail = avatar_search_failure_detail(DEFAULT_URL, 403, "error code: 1020", "2.40.0");
        assert_eq!(detail.kind, "rust_error");
        assert_eq!(detail.source.as_deref(), Some("avatar_search"));
        assert_eq!(detail.code.as_deref(), Some("http_403"));
        assert_eq!(detail.name.as_deref(), Some("cf_1020"));
        assert_eq!(
            detail.summary.as_deref(),
            Some("provider=avtrdb; status=403; block=cf_1020")
        );
        assert_eq!(detail.app_version.as_deref(), Some("2.40.0"));
    }

    #[test]
    fn html_cloudflare_error_page_is_classified() {
        let body = r#"<html><head><title>Attention Required! | Cloudflare</title></head><body>
            <h1><span class="cf-error-type">Error</span> <span class="cf-error-code">1010</span></h1>
            <span class="cf-footer-item">Cloudflare Ray ID: <strong>8a1b2c3d4e5f6a7b</strong></span></body></html>"#;
        let detail = avatar_search_failure_detail(DEFAULT_URL, 403, body, "2.40.0");
        assert_eq!(detail.name.as_deref(), Some("cf_1010"));
        assert!(!detail
            .summary
            .unwrap_or_default()
            .contains("8a1b2c3d4e5f6a7b"));
    }

    #[test]
    fn cloudflare_challenge_page_is_classified() {
        let body = r#"<!DOCTYPE html><html><head><title>Just a moment...</title></head>
            <body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>"#;
        let detail = avatar_search_failure_detail(DEFAULT_URL, 403, body, "2.40.0");
        assert_eq!(detail.name.as_deref(), Some("cf_challenge"));
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
            Some("provider=avtrdb; status=429")
        );
    }

    #[test]
    fn custom_provider_url_is_not_reported() {
        let detail = avatar_search_failure_detail(
            "https://avatars.private.example:8443/vrcx_search.php?search=miku",
            403,
            "",
            "2.40.0",
        );
        let summary = detail.summary.unwrap_or_default();
        assert_eq!(summary, "provider=custom; status=403");
    }
}
