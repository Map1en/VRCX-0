use chrono::Utc;

use crate::domain::game_launch;
use crate::error::AppError;
use vrcx_0_persistence::config as backend_config;

use super::runtime_state::parse_event_time_ms;
use super::BackendDeps;

pub fn set_game_no_vr(deps: BackendDeps, no_vr: bool) -> Result<(), AppError> {
    backend_config::set_bool(&deps.db, "isGameNoVR", no_vr)?;
    deps.emit_side_effect(
        "gameNoVR",
        serde_json::json!({
            "isGameNoVR": no_vr,
        }),
    );
    Ok(())
}

pub fn handle_vrc_quit(deps: BackendDeps, created_at: &str, is_game_running: bool) {
    if !is_game_running {
        return;
    }
    if !backend_config::get_bool(&deps.db, "vrcQuitFix", true).unwrap_or(true) {
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
        deps.emit_side_effect(
            "notification",
            serde_json::json!({
                "level": "info",
                "title": "VRChat quit cleanup",
                "message": format!("Closed {killed} lingering VRChat process(es)."),
            }),
        );
    }
}

pub fn emit_video_sync(deps: BackendDeps, timestamp: &str, created_at: &str) {
    let position = timestamp
        .replace(',', "")
        .parse::<i64>()
        .ok()
        .filter(|value| *value >= 0)
        .unwrap_or(0);

    deps.emit_side_effect(
        "nowPlaying",
        serde_json::json!({
            "position": position,
            "startedAt": created_at,
            "updatedAt": Utc::now().to_rfc3339(),
        }),
    );
}
