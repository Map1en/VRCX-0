use chrono::Utc;
use vrcx_0_persistence::config as config_store;
use vrcx_0_persistence::DatabaseService;

use crate::game_log::host::GameLogHostActions;
use crate::game_log::runtime_state::parse_event_time_ms;
use crate::Result;
use crate::RuntimeEventBus;
use crate::RuntimeGameEventBusExt;
use crate::{
    GameLogSideEffectEvent, GameNoVrPayload, NowPlayingPayload, RuntimeNotificationPayload,
};

pub fn set_game_no_vr(
    db: &DatabaseService,
    event_bus: &RuntimeEventBus,
    no_vr: bool,
) -> Result<()> {
    config_store::set_bool(db, "isGameNoVR", no_vr)?;
    event_bus.emit_game_log_side_effect(GameLogSideEffectEvent::GameNoVr(GameNoVrPayload {
        is_game_no_vr: no_vr,
    }));
    Ok(())
}

pub fn handle_vrc_quit(
    db: &DatabaseService,
    host_actions: &dyn GameLogHostActions,
    event_bus: &RuntimeEventBus,
    created_at: &str,
    is_game_running: bool,
) {
    if !is_game_running {
        return;
    }
    if !config_store::get_bool(db, "vrcQuitFix", true).unwrap_or(true) {
        return;
    }

    let Some(created_at_ms) = parse_event_time_ms(created_at) else {
        return;
    };
    if created_at_ms + 3000 < Utc::now().timestamp_millis() {
        return;
    }

    let killed = host_actions.quit_game();
    if killed > 0 {
        event_bus.emit_game_log_side_effect(GameLogSideEffectEvent::Notification(
            RuntimeNotificationPayload {
                level: "info".into(),
                title: "VRChat quit cleanup".into(),
                message: format!("Closed {killed} lingering VRChat process(es)."),
            },
        ));
    }
}

pub fn emit_video_sync(event_bus: &RuntimeEventBus, timestamp: &str, created_at: &str) {
    let position = timestamp
        .replace(',', "")
        .parse::<i64>()
        .ok()
        .filter(|value| *value >= 0)
        .unwrap_or(0);

    event_bus.emit_game_log_side_effect(GameLogSideEffectEvent::NowPlaying(Box::new(
        NowPlayingPayload {
            position,
            started_at: created_at.into(),
            updated_at: Utc::now().to_rfc3339(),
            ..Default::default()
        },
    )));
}
