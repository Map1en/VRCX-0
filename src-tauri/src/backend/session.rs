use std::sync::Arc;

use crate::backend::context::BackendContext;
use crate::domain::process_monitor::{GameProcessEvent, GameProcessEventSink};
use crate::error::AppError;
use vrcx_0_runtime::session::GameProcessStatus;

#[derive(Clone)]
pub struct SessionBackend {
    context: Arc<BackendContext>,
}

impl SessionBackend {
    pub fn new(context: Arc<BackendContext>) -> Self {
        Self { context }
    }
}

impl GameProcessEventSink for SessionBackend {
    fn on_game_process_event(&self, event: GameProcessEvent) -> Result<(), AppError> {
        let projection = self
            .context
            .session
            .apply_game_process_status(GameProcessStatus {
                is_game_running: event.is_game_running,
                is_steamvr_running: event.is_steamvr_running,
                changed_at: chrono::Utc::now()
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string(),
            });

        if projection.game_changed || projection.steamvr_changed {
            self.context.event_bus.emit_game_process_status(projection);
        }

        Ok(())
    }
}
