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
            let Some(active) = state.connection.active_context.clone() else {
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
        let local_game_context = self.deps.local_game_context.snapshot();
        let game_log_disabled =
            config_store::get_bool(&self.deps.db, "gameLogDisabled", false).unwrap_or(false);
        match local_game_context {
            LocalGameContextSnapshot::Unavailable => RealtimeCurrentUserAuthority {
                local_game_context_available: false,
                ..RealtimeCurrentUserAuthority::default()
            },
            LocalGameContextSnapshot::Available {
                is_game_running,
                location,
                destination,
                world_name,
                ..
            } => RealtimeCurrentUserAuthority {
                local_game_context_available: true,
                is_game_running,
                game_log_enabled: !game_log_disabled,
                game_log_location: location,
                game_log_destination: destination,
                game_log_world_name: world_name,
            },
        }
    }

    pub(super) fn sync_current_user_game_running_state(
        &self,
        generation: u64,
        is_game_running: bool,
    ) {
        let Some(output) = self.current_user_game_running_output(generation, is_game_running)
        else {
            return;
        };
        self.apply_current_user_output(output);
    }

    pub(super) fn current_user_game_running_output(
        &self,
        generation: u64,
        is_game_running: bool,
    ) -> Option<RealtimeCurrentUserOutput> {
        let mut authority = self.current_user_authority();
        authority.is_game_running = is_game_running;
        self.current_user
            .apply_game_running_state(generation, authority)
    }
}
