use chrono::Utc;

use crate::game_log::host::GameLogHostActions;
use crate::game_log::runtime_state::parse_event_time_ms;
use crate::Result;
use crate::{GameLogSideEffectEvent, GameLogSideEffectSink, GameNoVrPayload};
use vrcx_0_application_core::ConfigStore;

pub const IS_GAME_NO_VR_CONFIG_KEY: &str = "isGameNoVR";

pub fn set_game_no_vr(
    config: &dyn ConfigStore,
    side_effect_sink: &GameLogSideEffectSink,
    no_vr: bool,
) -> Result<()> {
    config.set_bool(IS_GAME_NO_VR_CONFIG_KEY, no_vr)?;
    side_effect_sink.emit(GameLogSideEffectEvent::GameNoVr(GameNoVrPayload {
        is_game_no_vr: no_vr,
    }));
    Ok(())
}

pub fn handle_vrc_quit(
    config: &dyn ConfigStore,
    host_actions: &dyn GameLogHostActions,
    created_at: &str,
    is_game_running: bool,
) {
    if !is_game_running {
        return;
    }
    if !config.get_bool("vrcQuitFix", true).unwrap_or(true) {
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
        tracing::info!(killed, "closed lingering VRChat processes after quit");
    }
}
