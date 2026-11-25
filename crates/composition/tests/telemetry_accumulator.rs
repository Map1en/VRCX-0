use vrcx_0_application::telemetry::{TelemetryAccumulator, TelemetryClientEvent};

#[test]
fn telemetry_accumulator_keeps_session_totals_without_resetting() {
    let mut acc = TelemetryAccumulator::default();

    acc.record(TelemetryClientEvent::PageVisit {
        route: "game_log".into(),
        landing: false,
    });
    acc.record(TelemetryClientEvent::PageVisit {
        route: "game_log".into(),
        landing: false,
    });
    acc.record(TelemetryClientEvent::RouteError {
        error_class: "render_crash".into(),
        name: Some("TypeError".into()),
        summary: Some("failed at usr_123 C:\\Users\\me\\AppData\\x.txt".into()),
    });

    let routes = acc.route_entries();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0].route, "game_log");
    assert_eq!(routes[0].visits, 2);
    let details = routes[0].details.as_ref().unwrap();
    assert_eq!(details[0].count, 1);
    assert_eq!(details[0].summary.as_deref(), Some("failed at <id> <path>"));

    let routes_again = acc.route_entries();
    assert_eq!(routes_again[0].visits, 2);
    assert_eq!(routes_again[0].details.as_ref().unwrap()[0].count, 1);
}

#[test]
fn tool_opens_use_separate_session_counts_without_changing_error_attribution() {
    let mut acc = TelemetryAccumulator::default();

    acc.record(TelemetryClientEvent::PageVisit {
        route: "tools".into(),
        landing: false,
    });
    acc.record(TelemetryClientEvent::ToolOpen {
        tool: "profile-backup".into(),
    });
    acc.record(TelemetryClientEvent::ToolOpen {
        tool: "profile-backup".into(),
    });
    acc.record(TelemetryClientEvent::RouteError {
        error_class: "render_crash".into(),
        name: Some("TypeError".into()),
        summary: Some("failed to render tools".into()),
    });

    let tools = acc.tool_entries();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].tool, "profile-backup");
    assert_eq!(tools[0].opens, 2);

    let routes = acc.route_entries();
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0].route, "tools");
    assert_eq!(routes[0].visits, 1);
    assert_eq!(routes[0].details.as_ref().unwrap()[0].kind, "render_crash");
}

#[test]
fn telemetry_accumulator_filters_cancelled_turn_errors() {
    let mut acc = TelemetryAccumulator::default();

    acc.record(TelemetryClientEvent::AssistantTurnError {
        code: "cancelled".into(),
        summary: Some("user cancelled".into()),
    });
    acc.record(TelemetryClientEvent::AssistantTurnError {
        code: "provider_error".into(),
        summary: Some("request failed".into()),
    });

    let details = acc.assistant_error_details().unwrap();
    assert_eq!(details.len(), 1);
    assert_eq!(details[0].code.as_deref(), Some("provider_error"));
}

#[test]
fn telemetry_accumulator_keeps_external_llm_failures_out_of_details() {
    let mut acc = TelemetryAccumulator::default();

    for status in [404, 429, 500] {
        acc.record(TelemetryClientEvent::AssistantTurnError {
            code: "llm".into(),
            summary: Some(format!("LLM API error ({status})")),
        });
    }
    acc.record(TelemetryClientEvent::AssistantTurnError {
        code: "llm".into(),
        summary: Some("LLM response parse failed".into()),
    });

    let details = acc.assistant_error_details().unwrap();
    assert_eq!(details.len(), 1);
    assert_eq!(
        details[0].summary.as_deref(),
        Some("LLM response parse failed")
    );
}

#[test]
fn telemetry_accumulator_filters_expected_tool_outcomes() {
    let mut acc = TelemetryAccumulator::default();

    for summary in [
        "result=not_found",
        "bucket=month; result=precondition",
        "result=<id>",
    ] {
        acc.record(TelemetryClientEvent::AssistantToolError {
            source: Some("find_user".into()),
            summary: Some(summary.into()),
        });
    }
    acc.record(TelemetryClientEvent::AssistantToolError {
        source: Some("find_user".into()),
        summary: Some("result=invalid_args".into()),
    });

    let details = acc.assistant_error_details().unwrap();
    assert_eq!(details.len(), 1);
    assert_eq!(details[0].summary.as_deref(), Some("result=invalid_args"));
}

#[test]
fn telemetry_accumulator_records_rust_error_versions() {
    let mut acc = TelemetryAccumulator::default();
    let message = "panic in wrld_123 at /home/me/.config/VRCX-0/error-log.txt";

    acc.record_rust_error("rust:panic", "2.9.2", message, message);

    let errors = acc.client_error_entries();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].kind, "panic");
    assert_eq!(errors[0].app_version.as_deref(), Some("2.9.2"));
    assert_eq!(
        errors[0].summary.as_deref(),
        Some("panic in <id> at <path>")
    );
}

#[test]
fn telemetry_accumulator_structures_interrupted_database_upgrades() {
    let mut acc = TelemetryAccumulator::default();

    for started_at in [
        "2026-06-26T17:20:02.105560800+00:00",
        "2026-07-01T01:02:03.004000000+00:00",
    ] {
        let message = format!(
            "2026-08-10T04:07:00Z ERROR vrcx_0::commands::database: database upgrade failure [status=interrupted stage=legacySchemaMigration operation=database_maintenance_run:fixNegativeGPS sqliteCategory=none from=17 to=18 appVersion=2.17.0]: Upgrade stopped during 'legacySchemaMigration' (started {started_at}); work database C:\\Users\\example\\VRCX-0.sqlite3"
        );
        acc.record_rust_error("rust:tracing", "2.23.0", &message, &message);
    }

    let errors = acc.client_error_entries();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].source.as_deref(), Some("database_upgrade"));
    assert_eq!(errors[0].code.as_deref(), Some("interrupted"));
    assert_eq!(
        errors[0].name.as_deref(),
        Some("database_maintenance_run:fixNegativeGPS")
    );
    assert_eq!(errors[0].app_version.as_deref(), Some("2.17.0"));
    assert_eq!(errors[0].count, 2);
    let summary = errors[0].summary.as_deref().unwrap();
    assert!(summary.starts_with(
        "stage=legacySchemaMigration; operation=database_maintenance_run:fixNegativeGPS; sqliteCategory=none; fromVersion=17; toVersion=18; startedVersion=2.17.0;"
    ));
    assert!(summary.contains("work database <path>"));
    assert!(!summary.contains("C:\\Users"));
}

#[test]
fn telemetry_accumulator_keeps_sqlite_reason_and_migration_sql() {
    let mut acc = TelemetryAccumulator::default();
    let message = "database upgrade failure [status=failed stage=legacyPerformanceIndexes operation=database_maintenance_run:addLegacyPerformanceIndexes sqliteCategory=unclassified from=17 to=18 appVersion=2.23.0]: Database error: no such column: created_at in SELECT created_at FROM gamelog_location at offset 7";

    acc.record_rust_error("rust:tracing", "2.23.0", message, message);

    let error = &acc.client_error_entries()[0];
    assert_eq!(error.code.as_deref(), Some("failed.sqlite_unclassified"));
    assert_eq!(
        error.name.as_deref(),
        Some("database_maintenance_run:addLegacyPerformanceIndexes")
    );
    let summary = error.summary.as_deref().unwrap();
    assert!(summary.contains("sqliteCategory=unclassified"));
    assert!(summary.contains("no such column: created_at"));
    assert!(summary.contains("SELECT created_at FROM gamelog_location at offset 7"));
}

#[test]
fn telemetry_accumulator_uses_reporting_version_for_legacy_upgrade_status() {
    let mut acc = TelemetryAccumulator::default();
    let message = "database upgrade failure [status=interrupted stage=beforeFirstStage from=17 to=18 appVersion=unknown]: previous database upgrade did not finish";

    acc.record_rust_error("rust:tracing", "2.23.0", message, message);

    let error = &acc.client_error_entries()[0];
    assert_eq!(error.app_version.as_deref(), Some("2.23.0"));
    assert!(error
        .summary
        .as_deref()
        .is_some_and(|summary| summary.contains("startedVersion=unknown")));
}

#[test]
fn telemetry_accumulator_keeps_only_sanitized_panic_frame_locations() {
    let mut acc = TelemetryAccumulator::default();
    let fingerprint_message =
        "panicked at C:\\cargo\\tao\\runner.rs:371:7:\ncannot move state from Destroyed";
    let telemetry_message = "cannot move state from Destroyed\nframes: tao::EventLoopRunner::advance_state@runner.rs:371:7";

    acc.record_rust_error(
        "rust:panic",
        "2.15.0",
        fingerprint_message,
        telemetry_message,
    );

    let summary = acc.client_error_entries()[0].summary.clone().unwrap();
    assert!(summary.contains("frames: tao::EventLoopRunner::advance_state@runner.rs:371:7"));
    assert!(!summary.contains("C:\\"));
}
