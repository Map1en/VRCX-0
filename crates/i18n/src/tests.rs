use serde::Deserialize;
use serde_json::json;

use super::*;

const LANGUAGE_CODES: &[&str] = &[
    "cs", "en", "es", "fr", "hu", "ja", "ko", "pl", "pt", "ru", "th", "vi", "zh-CN", "zh-TW",
];

#[derive(Deserialize)]
struct LocaleCase {
    input: String,
    expected: String,
}

#[test]
fn normalization_matches_shared_locale_cases() {
    let cases = serde_json::from_str::<Vec<LocaleCase>>(include_str!(
        "../../../src/localization/locale-cases.json"
    ))
    .expect("locale cases");
    let available = LANGUAGE_CODES
        .iter()
        .map(|code| (*code).to_string())
        .collect::<Vec<_>>();

    for locale_case in cases {
        assert_eq!(
            resolve_locale(&locale_case.input, available.iter(), "en"),
            locale_case.expected,
            "{}",
            locale_case.input
        );
    }
}

#[test]
fn catalog_text_uses_locale_then_fallback_then_call_site_fallback() {
    let catalog = parse_catalog(
        r#"{
                "version": 1,
                "fallbackLocale": "en",
                "locales": {
                    "en": { "hello": "Hello", "missingInJa": "Fallback" },
                    "ja": { "hello": "こんにちは" }
                }
            }"#,
        "test catalog",
    );

    assert_eq!(catalog.text("ja", "hello", "Hi"), "こんにちは");
    assert_eq!(catalog.text("ja", "missingInJa", "Hi"), "Fallback");
    assert_eq!(catalog.text("ja", "absent", "Hi"), "Hi");
}

#[test]
fn interpolation_replaces_scalar_params_and_collapses_whitespace() {
    let output = interpolate(
        "{name} has invited you to {location} {message}",
        &json!({ "name": " Ada ", "location": "Test World", "message": "" }),
    );

    assert_eq!(
        collapse_whitespace(&output),
        "Ada has invited you to Test World"
    );
}
