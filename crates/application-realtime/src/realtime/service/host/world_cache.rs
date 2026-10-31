use std::sync::Arc;

use crate::realtime::{RealtimeEntryCorrection, RealtimeEntryCorrectionFields};
use crate::world_enrich::is_meaningful_world_name;
use crate::world_enrich::{
    resolved_display_location, PendingEntryCorrection, PendingWorldNameResolution,
};

use super::RealtimeHostRuntime;

impl RealtimeHostRuntime {
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
                if let Some(entry) = pending.entry {
                    state
                        .world_enrichment
                        .pending_corrections
                        .entry(pending.world_id.clone())
                        .or_default()
                        .push(entry);
                }
                if state
                    .world_enrichment
                    .inflight
                    .insert(pending.world_id.clone())
                {
                    fetch_ids.push(pending.world_id);
                }
            }
            fetch_ids
        };
        for world_id in fetch_ids {
            let runtime = Arc::clone(self);
            let endpoint = endpoint.clone();
            self.deps.tasks.spawn(async move {
                let world_name = runtime
                    .world_cache
                    .resolve_name(&runtime.deps.web, &endpoint, &world_id)
                    .await
                    .filter(|name| is_meaningful_world_name(name));
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
            state.world_enrichment.inflight.remove(world_id);
            state
                .world_enrichment
                .pending_corrections
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
        let fields = RealtimeEntryCorrectionFields {
            display_name: None,
            world_name: Some(world_name.to_string()),
            display_location: (!display_location.is_empty()).then_some(display_location),
        };
        if entry.stream == crate::realtime::RealtimeEntryCorrectionStream::Feed {
            self.emit_feed_patch(entry.id, fields);
            return;
        }
        self.deps.event_bus.emit(RealtimeEntryCorrection {
            stream: entry.stream,
            id: entry.id,
            fields,
        });
    }
}
