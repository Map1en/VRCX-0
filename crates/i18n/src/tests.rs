use std::collections::BTreeMap;

use serde::Deserialize;

use super::*;

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
    let available = language_codes();

    for locale_case in cases {
        assert_eq!(
            resolve_locale(&locale_case.input, available.iter(), "en"),
            locale_case.expected,
            "{}",
            locale_case.input
        );
    }
}

fn language_codes() -> Vec<String> {
    serde_json::from_str(include_str!("../../../src/localization/languageCodes.json"))
        .expect("language codes")
}

#[test]
fn interpolation_replaces_scalar_params_and_collapses_whitespace() {
    let params = BTreeMap::from([
        ("name".to_string(), " Ada ".to_string()),
        ("location".to_string(), "Test World".to_string()),
        ("message".to_string(), String::new()),
    ]);
    let output = interpolate("{name} has invited you to {location} {message}", &params);

    assert_eq!(
        collapse_whitespace(&output),
        "Ada has invited you to Test World"
    );
}

#[test]
fn generated_overlay_constructor_keeps_typed_key_and_params() {
    let message = OverlayMessage::notifications_gps("Test World");

    assert_eq!(message.key(), OverlayMessageKey::NotificationsGps);
    assert_eq!(
        message.params().get("location").map(String::as_str),
        Some("Test World")
    );
}

#[test]
fn typed_keys_serialize_to_stable_strings() {
    assert_eq!(
        serde_json::to_value(OverlayMessageKey::NotificationsGps).expect("serialize overlay key"),
        serde_json::json!("notifications.gps")
    );
    assert_eq!(
        serde_json::to_value(DiscordPresenceKey::DiscordStatusJoinMe)
            .expect("serialize Discord key"),
        serde_json::json!("discord.status.join_me")
    );
    assert_eq!(
        serde_json::to_value(ShellKey::NativeShellTrayOpen).expect("serialize shell key"),
        serde_json::json!("nativeShell.tray.open")
    );
}
