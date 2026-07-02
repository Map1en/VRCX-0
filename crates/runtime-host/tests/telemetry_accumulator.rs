use vrcx_0_runtime_host::telemetry::{TelemetryAccumulator, TelemetryClientEvent};

#[test]
fn telemetry_accumulator_keeps_session_totals_without_resetting() {
    let mut acc = TelemetryAccumulator::default();

    acc.record(TelemetryClientEvent::PageVisit {
        route: "game_log".into(),
    });
    acc.record(TelemetryClientEvent::PageVisit {
        route: "game_log".into(),
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
    assert_eq!(routes[0].render_crash, Some(1));
    assert_eq!(
        routes[0].details.as_ref().unwrap()[0].summary.as_deref(),
        Some("failed at <id> <path>")
    );

    let routes_again = acc.route_entries();
    assert_eq!(routes_again[0].visits, 2);
    assert_eq!(routes_again[0].render_crash, Some(1));
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

    let health = acc.assistant_health_entry().unwrap();
    assert_eq!(health.turn_errors, 1);
    assert_eq!(health.tool_errors, 0);
    assert_eq!(
        health.details.unwrap()[0].code.as_deref(),
        Some("provider_error")
    );
}

#[test]
fn telemetry_accumulator_records_rust_error_versions() {
    let mut acc = TelemetryAccumulator::default();

    acc.record_rust_error(
        "rust:panic",
        "2.9.2",
        "panic in wrld_123 at /home/me/.config/VRCX-0/error-log.txt",
    );

    let errors = acc.client_error_entries();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].kind, "panic");
    assert_eq!(errors[0].app_version.as_deref(), Some("2.9.2"));
    assert_eq!(
        errors[0].summary.as_deref(),
        Some("panic in <id> at <path>")
    );
}
