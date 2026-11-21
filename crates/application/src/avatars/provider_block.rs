use std::sync::LazyLock;

use regex::Regex;

static CLOUDFLARE_ERROR_CODE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)error[\s-]*(?:code)?\W{0,4}(?:<[^>]*>\W{0,4})*(1\d{3})\b").unwrap()
});

pub fn cloudflare_block(body: &str) -> Option<String> {
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

    #[test]
    fn plain_text_cloudflare_error_code_is_classified() {
        assert_eq!(
            cloudflare_block("error code: 1020").as_deref(),
            Some("cf_1020")
        );
    }

    #[test]
    fn html_cloudflare_error_page_is_classified() {
        let body = r#"<html><head><title>Attention Required! | Cloudflare</title></head><body>
            <h1><span class="cf-error-type">Error</span> <span class="cf-error-code">1010</span></h1></body></html>"#;
        assert_eq!(cloudflare_block(body).as_deref(), Some("cf_1010"));
    }

    #[test]
    fn cloudflare_challenge_page_is_classified() {
        let body = r#"<!DOCTYPE html><html><head><title>Just a moment...</title></head>
            <body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>"#;
        assert_eq!(cloudflare_block(body).as_deref(), Some("cf_challenge"));
    }

    #[test]
    fn origin_error_without_cloudflare_marker_has_no_block() {
        assert_eq!(cloudflare_block(r#"{"message":"rate limited"}"#), None);
    }
}
