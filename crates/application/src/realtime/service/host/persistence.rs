use super::*;

impl RealtimeHostRuntime {
    pub fn apply_game_process_event(
        &self,
        game_changed: bool,
        is_game_running: bool,
    ) -> Result<()> {
        if !game_changed {
            return Ok(());
        }
        let active = {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            state.active_context.clone()
        };
        let Some(active) = active else {
            return Ok(());
        };
        self.sync_current_user_game_running_state(active.generation, is_game_running);
        Ok(())
    }
}

impl GameProcessEventSink for RealtimeHostRuntime {
    fn on_game_process_event(&self, event: GameProcessEvent) -> Result<()> {
        self.apply_game_process_event(event.game_changed, event.is_game_running)
    }
}
