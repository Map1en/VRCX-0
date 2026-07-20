use serde_json::{json, Value};

use vrcx_0_integrations::telemetry::{
    build_error_detail, resolve_endpoint_for, sanitize_error_summary, TelemetryConfigSnapshot,
    TelemetryContext, TelemetryRuntimeMode,
};

const SYNTHETIC_PROVIDER_ORG_ID: &str = "org_TESTPROVIDER123456789";
const SYNTHETIC_PROVIDER_REQUEST_ID: &str = "req_TESTREQUEST123";
const SYNTHETIC_PROVIDER_KEY_ID: &str = "key_TESTKEYabcdef";
const SYNTHETIC_PROVIDER_SK_ID: &str = "sk-TESTKEYabcdef";
const SYNTHETIC_PROVIDER_LONG_TOKEN: &str = "fakeToken0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";

#[test]
fn config_snapshot_matches_worker_contract_fields() {
    let snapshot = TelemetryConfigSnapshot {
        background_mode_enabled: true,
        wrist_overlay_enabled: false,
        xs_notifications: true,
        ovrt_hud_notifications: true,
        ovrt_wrist_notifications: false,
        hmd_notifications_enabled: true,
        discord_active: false,
        webhook_enabled: false,
        auto_state_change_enabled: false,
        auto_accept_invite_requests: "off".into(),
        avatar_auto_cleanup: "off".into(),
        theme_mode: "dark".into(),
    };

    let value = serde_json::to_value(&snapshot).unwrap();
    let keys = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();

    let expected = [
        "autoAcceptInviteRequests",
        "autoStateChangeEnabled",
        "avatarAutoCleanup",
        "backgroundModeEnabled",
        "discordActive",
        "hmdNotificationsEnabled",
        "ovrtHudNotifications",
        "ovrtWristNotifications",
        "themeMode",
        "webhookEnabled",
        "wristOverlayEnabled",
        "xsNotifications",
    ];
    let mut sorted = keys.clone();
    sorted.sort_unstable();
    assert_eq!(sorted, expected);
}

#[test]
fn telemetry_endpoint_matches_build_policy() {
    assert_eq!(
        resolve_endpoint_for(
            true,
            Some(" http://127.0.0.1:8097/ "),
            Some("https://compile")
        ),
        "http://127.0.0.1:8097"
    );
    assert_eq!(
        resolve_endpoint_for(true, None, Some("https://compile")),
        ""
    );
    assert_eq!(
        resolve_endpoint_for(false, None, None),
        "https://stats.vrcx-0.dev"
    );
    assert_eq!(
        resolve_endpoint_for(false, None, Some("https://compile.example/")),
        "https://compile.example"
    );
}

#[test]
fn context_omits_session_ended_unless_true() {
    let context = TelemetryContext {
        install_id: "install".into(),
        session_id: "session".into(),
        app_version: "2.9.0".into(),
        platform: "windows".into(),
        arch: "x86_64".into(),
        locale: "en-US".into(),
        timezone: "Asia/Tokyo".into(),
        mode: TelemetryRuntimeMode::Foreground,
        local_weekday: 4,
        local_hour: 17,
        session_ended: None,
    };

    let value = serde_json::to_value(&context).unwrap();

    assert_eq!(value.get("installId"), Some(&json!("install")));
    assert_eq!(value.get("mode"), Some(&json!("foreground")));
    assert!(value.get("vrchatRunning").is_none());
    assert!(value.get("sessionEnded").is_none());

    let ended = TelemetryContext {
        session_ended: Some(true),
        ..context
    };
    let ended_value = serde_json::to_value(&ended).unwrap();
    assert_eq!(ended_value.get("sessionEnded"), Some(&Value::Bool(true)));
}

#[test]
fn error_summary_and_signature_match_existing_contract() {
    let summary = sanitize_error_summary(
        r#"failed usr_123 at C:\Users\me\AppData\file.txt https://example.test/a wrld_abc 0123456789abcdef0123456789abcdef"#,
    );

    assert_eq!(summary, "failed <id> at <path> <url> <id> <hash>");

    let detail = build_error_detail(
        "tool_error",
        Some("read_user_note"),
        None,
        None,
        Some("args=<text>; result=timeout"),
        None,
    );

    assert_eq!(detail.kind, "tool_error");
    assert_eq!(detail.source.as_deref(), Some("read_user_note"));
    assert_eq!(
        detail.summary.as_deref(),
        Some("args=<text>; result=timeout")
    );
    assert_eq!(detail.signature, "tool_error:00d540ca");
    assert_eq!(detail.count, 1);
}

#[test]
fn error_summary_redacts_provider_ids_tokens_and_line_timestamps() {
    let summary = sanitize_error_summary(format!(
        "2026-07-07T12:34:56.789Z LLM failed for {SYNTHETIC_PROVIDER_ORG_ID} {SYNTHETIC_PROVIDER_REQUEST_ID} {SYNTHETIC_PROVIDER_SK_ID} {SYNTHETIC_PROVIDER_LONG_TOKEN}"
    ));

    assert_eq!(summary, "LLM failed for <id> <id> <id> <token>");
}

#[test]
fn error_summary_redacts_provider_id_variants() {
    for raw in [
        SYNTHETIC_PROVIDER_ORG_ID,
        "req-TESTREQUEST123",
        SYNTHETIC_PROVIDER_KEY_ID,
        SYNTHETIC_PROVIDER_SK_ID,
        "sk_TESTKEYabcdef",
    ] {
        assert_eq!(
            sanitize_error_summary(format!("provider rejected {raw}")),
            "provider rejected <id>"
        );
    }
}

#[test]
fn error_summary_preserves_not_found_without_leaking_notification_ids() {
    assert_eq!(
        sanitize_error_summary("result=not_found notification=not_123"),
        "result=not_found notification=<id>"
    );
}
