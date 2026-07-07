use super::*;
use crate::world_enrich::{
    resolved_display_location, PendingEntryCorrection, PendingWorldNameResolution,
};
use vrcx_0_vrchat_client::worlds::world_get_input;

const WORLD_NAME_FETCH_THROTTLE_MS: i64 = 600_000;

pub(super) enum WorldNameFetchOutcome {
    Found(String),
    RetryableFailure,
    PermanentFailure,
}

impl RealtimeHostRuntime {
    pub(super) async fn fetch_and_cache_world(
        &self,
        endpoint: String,
        world_id: String,
    ) -> Option<String> {
        let world_id = world_id.trim().to_string();
        if world_id.is_empty() {
            return None;
        }
        if let Some(name) = self.world_cache.get_name(&world_id) {
            return Some(name);
        }
        match self.fetch_and_cache_world_once(endpoint, world_id).await {
            WorldNameFetchOutcome::Found(name) => Some(name),
            WorldNameFetchOutcome::RetryableFailure | WorldNameFetchOutcome::PermanentFailure => {
                None
            }
        }
    }

    pub(super) async fn fetch_and_cache_world_once(
        &self,
        endpoint: String,
        world_id: String,
    ) -> WorldNameFetchOutcome {
        let world_id = world_id.trim().to_string();
        if world_id.is_empty() {
            return WorldNameFetchOutcome::PermanentFailure;
        }
        let Ok((_, request)) = world_get_input(endpoint, world_id.clone()) else {
            return WorldNameFetchOutcome::PermanentFailure;
        };
        let response = match self
            .deps
            .web
            .execute_api(request, ApiScope::Vrchat, self.deps.db.as_ref())
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(world_id = %world_id, "Realtime world lookup failed: {error}");
                return WorldNameFetchOutcome::RetryableFailure;
            }
        };
        if !(200..=299).contains(&response.status) {
            tracing::warn!(
                world_id = %world_id,
                status = response.status,
                "Realtime world lookup returned non-success"
            );
            if (500..600).contains(&response.status) {
                return WorldNameFetchOutcome::RetryableFailure;
            }
            return WorldNameFetchOutcome::PermanentFailure;
        }
        let world = match serde_json::from_str::<Value>(&response.data) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(world_id = %world_id, "Realtime world lookup json failed: {error}");
                return WorldNameFetchOutcome::PermanentFailure;
            }
        };
        let name = string_value(&world, "name");
        if !is_meaningful_world_name(&name) {
            return WorldNameFetchOutcome::PermanentFailure;
        }
        let _ = self.world_cache.hydrate_from_payload(&world);
        WorldNameFetchOutcome::Found(name)
    }

    pub(super) fn schedule_world_name_warm(
        self: &Arc<Self>,
        pending_worlds: Vec<PendingWorldNameResolution>,
    ) {
        if pending_worlds.is_empty() {
            return;
        }
        let endpoint = self.active_endpoint();
        if endpoint.is_empty() {
            return;
        }
        let mut candidates = Vec::new();
        for pending in pending_worlds {
            let world_id = pending.world_id.trim().to_string();
            if world_id.is_empty() {
                continue;
            }
            if let Some(world_name) = self.world_cache.get_name(&world_id) {
                if let Some(entry) = pending.entry {
                    self.emit_world_name_correction(entry, &world_name);
                }
                self.resolve_pending_world_corrections(&world_id, Some(&world_name));
                continue;
            }
            candidates.push(PendingWorldNameResolution {
                world_id,
                entry: pending.entry,
            });
        }
        if candidates.is_empty() {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        let fetch_ids = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            let mut fetch_ids = Vec::new();
            for pending in candidates {
                let recent = state
                    .world_name_fetches
                    .get(&pending.world_id)
                    .map(|last_ms| now_ms.saturating_sub(*last_ms) < WORLD_NAME_FETCH_THROTTLE_MS)
                    .unwrap_or(false);
                let in_flight = state.world_name_fetch_inflight.contains(&pending.world_id);
                if let Some(entry) = pending.entry {
                    if !recent || in_flight {
                        state
                            .pending_world_name_corrections
                            .entry(pending.world_id.clone())
                            .or_default()
                            .push(entry);
                    }
                }
                if recent {
                    continue;
                }
                state
                    .world_name_fetches
                    .insert(pending.world_id.clone(), now_ms);
                state
                    .world_name_fetch_inflight
                    .insert(pending.world_id.clone());
                fetch_ids.push(pending.world_id);
            }
            fetch_ids
        };
        for world_id in fetch_ids {
            let runtime = Arc::clone(self);
            let endpoint = endpoint.clone();
            self.deps.tasks.spawn(async move {
                let world_name = runtime
                    .fetch_and_cache_world(endpoint, world_id.clone())
                    .await;
                runtime.resolve_pending_world_corrections(&world_id, world_name.as_deref());
            });
        }
    }

    pub(super) fn resolve_pending_world_corrections(
        &self,
        world_id: &str,
        world_name: Option<&str>,
    ) {
        let pending = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            state.world_name_fetch_inflight.remove(world_id);
            state
                .pending_world_name_corrections
                .remove(world_id)
                .unwrap_or_default()
        };
        let Some(world_name) = world_name else {
            return;
        };
        for entry in pending {
            self.emit_world_name_correction(entry, world_name);
        }
    }

    fn emit_world_name_correction(&self, entry: PendingEntryCorrection, world_name: &str) {
        let display_location =
            resolved_display_location(&entry.location, world_name, &entry.group_name);
        self.deps
            .event_bus
            .emit_realtime_entry_correction(RealtimeEntryCorrection {
                stream: entry.stream,
                id: entry.id,
                fields: RealtimeEntryCorrectionFields {
                    display_name: None,
                    world_name: Some(world_name.to_string()),
                    display_location: (!display_location.is_empty()).then_some(display_location),
                },
            });
    }
}

fn string_value(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}
