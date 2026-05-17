use chrono::Utc;
use vrcx_0_host::game_launch;
use vrcx_0_store::config as backend_config;
use vrcx_0_store::database::DatabaseService;

use crate::event_bus::BackendEventBus;
use crate::game_log::runtime_state::parse_event_time_ms;
use crate::Result;

pub fn set_game_no_vr(
    db: &DatabaseService,
    event_bus: &BackendEventBus,
    no_vr: bool,
) -> Result<()> {
    backend_config::set_bool(db, "isGameNoVR", no_vr)?;
    event_bus.emit_game_log_side_effect(
        "gameNoVR",
        serde_json::json!({
            "isGameNoVR": no_vr,
        }),
    );
    Ok(())
}

pub fn handle_vrc_quit(
    db: &DatabaseService,
    event_bus: &BackendEventBus,
    created_at: &str,
    is_game_running: bool,
) {
    if !is_game_running {
        return;
    }
    if !backend_config::get_bool(db, "vrcQuitFix", true).unwrap_or(true) {
        return;
    }

    let Some(created_at_ms) = parse_event_time_ms(created_at) else {
        return;
    };
    if created_at_ms + 3000 < Utc::now().timestamp_millis() {
        return;
    }

    let killed = game_launch::quit_game();
    if killed > 0 {
        event_bus.emit_game_log_side_effect(
            "notification",
            serde_json::json!({
                "level": "info",
                "title": "VRChat quit cleanup",
                "message": format!("Closed {killed} lingering VRChat process(es)."),
            }),
        );
    }
}

pub fn emit_video_sync(event_bus: &BackendEventBus, timestamp: &str, created_at: &str) {
    let position = timestamp
        .replace(',', "")
        .parse::<i64>()
        .ok()
        .filter(|value| *value >= 0)
        .unwrap_or(0);

    event_bus.emit_game_log_side_effect(
        "nowPlaying",
        serde_json::json!({
            "position": position,
            "startedAt": created_at,
            "updatedAt": Utc::now().to_rfc3339(),
        }),
    );
}
