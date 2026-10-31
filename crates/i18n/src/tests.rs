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

#[test]
fn app_locale_resolves_against_every_ui_language() {
    for code in language_codes() {
        assert_eq!(resolve_app_locale(&code), code);
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

#[test]
fn localized_catalog_reuses_one_resolved_locale_for_multiple_keys() {
    let catalog = LocalizedCatalog::new("zh_Hant");

    for key in [
        OverlayMessageKey::OverlayAccessPublic,
        OverlayMessageKey::OverlayAccessFriends,
    ] {
        assert_eq!(catalog.text(key), text("zh_Hant", key));
    }
}

#[test]
fn activity_window_labels_are_localized() {
    assert_eq!(
        text("zh-CN", DesktopWidgetKey::DesktopWidgetMenuPin),
        "窗口置顶"
    );
    assert_eq!(
        text("ja", DesktopWidgetKey::DesktopWidgetMenuClickThrough),
        "クリックを透過"
    );
}
