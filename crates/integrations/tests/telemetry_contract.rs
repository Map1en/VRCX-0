use serde_json::{json, Value};

use vrcx_0_integrations::telemetry::{
    build_error_detail, resolve_endpoint_for, sanitize_error_summary, TelemetryConfigSnapshot,
    TelemetryContext, TelemetryRuntimeMode,
};

#[test]
fn config_snapshot_matches_worker_contract_fields() {
    let snapshot = TelemetryConfigSnapshot {
        background_mode_enabled: true,
        wrist_overlay_enabled: false,
        xs_notifications: true,
        ovrt_hud_notifications: true,
        ovrt_wrist_notifications: false,
        discord_active: false,
        mcp_server_enabled: false,
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
        "mcpServerEnabled",
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
        vrchat_running: false,
        local_weekday: 4,
        local_hour: 17,
        session_ended: None,
    };

    let value = serde_json::to_value(&context).unwrap();

    assert_eq!(value.get("installId"), Some(&json!("install")));
    assert_eq!(value.get("mode"), Some(&json!("foreground")));
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
        Some("args=<text>; result=<text>"),
        None,
    );

    assert_eq!(detail.kind, "tool_error");
    assert_eq!(detail.source.as_deref(), Some("read_user_note"));
    assert_eq!(
        detail.summary.as_deref(),
        Some("args=<text>; result=<text>")
    );
    assert_eq!(detail.signature, "tool_error:e45b6a94");
    assert_eq!(detail.count, 1);
}
