use super::*;

impl RealtimeHostRuntime {
    pub fn sync_current_user_snapshot(
        &self,
        user_id: String,
        endpoint: String,
        websocket: String,
        generation: Option<u64>,
        snapshot: serde_json::Value,
        overlay_patch: serde_json::Value,
    ) -> Result<bool> {
        let requested_session = RealtimeSessionContext::new(user_id, endpoint, websocket);
        let active = {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            let Some(active) = state.active_context.clone() else {
                return Ok(false);
            };
            if active.session != requested_session
                || generation
                    .map(|generation| generation != active.generation)
                    .unwrap_or(false)
                || !self
                    .deps
                    .session
                    .is_realtime_generation_active(active.session_generation)
            {
                return Ok(false);
            }
            active
        };

        let Some(output) = self.current_user.apply_refreshed_snapshot(
            active.generation,
            snapshot,
            overlay_patch,
            self.current_user_authority(),
        ) else {
            return Ok(false);
        };
        self.apply_current_user_output(output);
        Ok(true)
    }

    pub(super) fn refresh_current_user_snapshot_after_update(
        self: &Arc<Self>,
        generation: u64,
        session: RealtimeSessionContext,
        overlay_patch: serde_json::Map<String, Value>,
    ) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            let response = match runtime
                .deps
                .web
                .execute_api(
                    current_user_get_input(session.endpoint.clone()),
                    ApiScope::Vrchat,
                    &runtime.deps.db,
                )
                .await
            {
                Ok(result) => result,
                Err(error) => {
                    tracing::warn!("Realtime current user refresh failed: {error}");
                    return;
                }
            };
            if !(200..300).contains(&response.status) {
                tracing::warn!(
                    status = response.status,
                    "Realtime current user refresh returned non-success"
                );
                return;
            }
            let snapshot = match serde_json::from_str::<Value>(&response.data) {
                Ok(snapshot) => snapshot,
                Err(error) => {
                    tracing::warn!("Realtime current user refresh json failed: {error}");
                    return;
                }
            };
            let Some(output) = runtime.current_user.apply_refreshed_snapshot(
                generation,
                snapshot,
                serde_json::Value::Object(overlay_patch),
                runtime.current_user_authority(),
            ) else {
                return;
            };
            runtime.apply_current_user_output(output);
        });
    }

    pub(super) fn current_user_authority(&self) -> RealtimeCurrentUserAuthority {
        let session = self.deps.session.snapshot();
        let game_log_snapshot = self
            .deps
            .game_log_snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default();
        let game_log_disabled =
            config_store::get_bool(&self.deps.db, "gameLogDisabled", false).unwrap_or(false);
        RealtimeCurrentUserAuthority {
            is_game_running: session.is_game_running,
            game_log_enabled: !game_log_disabled,
            game_log_location: game_log_snapshot.location,
            game_log_destination: game_log_snapshot.destination,
            game_log_world_name: game_log_snapshot.world_name,
        }
    }

    pub(super) fn sync_current_user_game_running_state(
        &self,
        generation: u64,
        is_game_running: bool,
    ) {
        let Some(output) = self
            .current_user
            .apply_game_running_state(generation, is_game_running)
        else {
            return;
        };
        self.apply_current_user_output(output);
    }
}
