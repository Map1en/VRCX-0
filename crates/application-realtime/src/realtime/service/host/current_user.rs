use std::sync::Arc;

use serde_json::Value;
use tokio::sync::watch;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::vrchat_api::VrchatScope as ApiScope;

use crate::realtime::RealtimeCurrentUserOutput;

use super::state::{ActiveRealtimeContext, CurrentUserRefreshStatus};
use super::{sleep_until, RealtimeHostRuntime};

#[derive(Clone, Copy, Debug)]
pub struct RealtimeCurrentUserRefreshExpectation {
    generation: u64,
    session_generation: u64,
    sequence: u64,
}

const AVATAR_WEAR_CHECKPOINT_INTERVAL_MS: i64 = 60_000;

impl RealtimeHostRuntime {
    pub(super) fn spawn_avatar_wear_checkpoints(self: &Arc<Self>, generation: u64) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            loop {
                sleep_until(
                    chrono::Utc::now().timestamp_millis() + AVATAR_WEAR_CHECKPOINT_INTERVAL_MS,
                )
                .await;
                if !runtime
                    .active_current_user_context()
                    .is_some_and(|active| active.generation == generation)
                {
                    return;
                }
                let Some((owner, batch)) = runtime
                    .current_user
                    .checkpoint_avatar_wear(generation, runtime.local_game_context())
                else {
                    continue;
                };
                if let Err(error) = runtime.deps.store.write_realtime_batch(&owner, &batch) {
                    tracing::warn!("Avatar wear checkpoint persistence failed: {error}");
                    for unsaved in &batch.avatar_time_spent_upserts {
                        runtime
                            .current_user
                            .restore_avatar_wear_checkpoint(generation, unsaved);
                    }
                }
            }
        });
    }

    pub(super) fn schedule_current_user_wake(self: &Arc<Self>, generation: u64, at_ms: i64) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            sleep_until(at_ms).await;
            let now = chrono::Utc::now().to_rfc3339();
            let Some(output) = runtime.current_user.wake_pending_offline(
                generation,
                now,
                runtime.local_game_context(),
            ) else {
                return;
            };
            runtime.apply_current_user_output(output);
        });
    }

    pub(super) fn refresh_current_user_snapshot_after_update(
        self: &Arc<Self>,
        generation: u64,
        overlay_patch: serde_json::Map<String, Value>,
    ) {
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            if !runtime
                .active_current_user_context()
                .is_some_and(|active| active.generation == generation)
            {
                return;
            }
            if let Err(error) = runtime
                .refresh_current_user_once(Value::Object(overlay_patch))
                .await
            {
                tracing::warn!("Realtime current user refresh failed: {error}");
            }
        });
    }

    pub fn capture_current_user_refresh_expectation(
        &self,
    ) -> Option<RealtimeCurrentUserRefreshExpectation> {
        let active = self.active_current_user_context()?;
        let sequence = self.current_user.snapshot_sequence(active.generation)?;
        Some(RealtimeCurrentUserRefreshExpectation {
            generation: active.generation,
            session_generation: active.session_generation,
            sequence,
        })
    }

    pub fn apply_current_user_refreshed_snapshot_if_sequence(
        &self,
        expectation: RealtimeCurrentUserRefreshExpectation,
        snapshot: Value,
        overlay_patch: Value,
    ) -> bool {
        if !self
            .active_current_user_context()
            .is_some_and(|active| self.current_user_context_matches(&active, &expectation))
        {
            return false;
        }
        let Some(output) = self.current_user.apply_refreshed_snapshot_if_sequence(
            expectation.generation,
            expectation.sequence,
            snapshot,
            overlay_patch,
            self.local_game_context(),
        ) else {
            return false;
        };
        self.apply_current_user_output(output);
        true
    }

    pub async fn refresh_current_user_now(self: &Arc<Self>, overlay_patch: Value) -> Result<bool> {
        enum RefreshFlight {
            Leader(watch::Sender<CurrentUserRefreshStatus>),
            Follower(watch::Receiver<CurrentUserRefreshStatus>),
        }

        let flight = {
            let mut slot = self
                .current_user_refresh_inflight
                .lock()
                .map_err(|error| Error::Custom(format!("current user refresh lock: {error}")))?;
            match slot.as_ref() {
                Some(rx) => RefreshFlight::Follower(rx.clone()),
                None => {
                    let (tx, rx) = watch::channel(None);
                    *slot = Some(rx);
                    RefreshFlight::Leader(tx)
                }
            }
        };
        match flight {
            RefreshFlight::Follower(mut rx) => loop {
                let settled = rx.borrow().clone();
                if let Some(result) = settled {
                    return result.map_err(Error::Custom);
                }
                if rx.changed().await.is_err() {
                    return Ok(false);
                }
            },
            RefreshFlight::Leader(tx) => {
                let result = self.refresh_current_user_once(overlay_patch).await;
                if let Ok(mut slot) = self.current_user_refresh_inflight.lock() {
                    *slot = None;
                }
                let _ = tx.send(Some(
                    result
                        .as_ref()
                        .map(|applied| *applied)
                        .map_err(|error| error.to_string()),
                ));
                result
            }
        }
    }

    async fn refresh_current_user_once(self: &Arc<Self>, overlay_patch: Value) -> Result<bool> {
        let Some(active) = self.active_current_user_context() else {
            return Ok(false);
        };
        let Some(sequence) = self.current_user.snapshot_sequence(active.generation) else {
            return Ok(false);
        };
        let response = self
            .deps
            .web
            .execute_api(
                self.deps
                    .remote_requests
                    .current_user(active.session.endpoint.clone())?,
                ApiScope::Vrchat,
            )
            .await?;
        if !(200..300).contains(&response.status) {
            return Err(Error::Custom(format!(
                "Current user refresh returned HTTP {}.",
                response.status
            )));
        }
        let snapshot = serde_json::from_str::<Value>(&response.data)
            .map_err(|error| Error::Custom(format!("current user refresh json: {error}")))?;
        Ok(self.apply_current_user_refreshed_snapshot_if_sequence(
            RealtimeCurrentUserRefreshExpectation {
                generation: active.generation,
                session_generation: active.session_generation,
                sequence,
            },
            snapshot,
            overlay_patch,
        ))
    }

    pub(super) fn active_current_user_context(&self) -> Option<ActiveRealtimeContext> {
        let active = {
            let state = self.state.lock().ok()?;
            state.connection.active_context.clone()?
        };
        if !self
            .deps
            .session
            .is_realtime_generation_active(active.session_generation)
        {
            return None;
        }
        Some(active)
    }

    fn current_user_context_matches(
        &self,
        active: &ActiveRealtimeContext,
        expectation: &RealtimeCurrentUserRefreshExpectation,
    ) -> bool {
        active.generation == expectation.generation
            && active.session_generation == expectation.session_generation
    }

    pub fn refresh_current_user_local_presence(&self) {
        let Some(active) = self.active_current_user_context() else {
            return;
        };
        let Some(output) = self
            .current_user
            .refresh_local_presence(active.generation, self.local_game_context())
        else {
            return;
        };
        self.apply_current_user_output(output);
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
        let game = self.local_game_context().with_game_running(is_game_running);
        self.current_user.apply_game_running_state(generation, game)
    }

    pub(super) fn current_user_transport_finalization_output(
        &self,
        generation: u64,
    ) -> Option<RealtimeCurrentUserOutput> {
        self.current_user
            .finalize_transport(generation, self.local_game_context())
    }

    pub(super) fn current_user_transport_interruption_output(
        &self,
        generation: u64,
    ) -> Option<RealtimeCurrentUserOutput> {
        self.current_user
            .interrupt_transport(generation, self.local_game_context())
    }
}
