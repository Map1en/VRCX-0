use vrcx_0_contracts::feed_live::FeedLiveEntry;

use crate::world_enrich::{self, PendingWorldNameResolution};

use super::super::message_dispatch::json_string_field;
use super::super::{
    RealtimeCurrentUserOutput, RealtimeHostRuntime, RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection, RealtimePersistenceBatch, Value,
};

impl RealtimeHostRuntime {
    pub(in super::super) fn enrich_projection_world_names(
        &self,
        entries: &mut [FeedLiveEntry],
    ) -> Vec<PendingWorldNameResolution> {
        let mut unresolved_world_ids = Vec::new();
        for entry in entries {
            if let Some(pending) = world_enrich::enrich_feed_entry(&self.world_cache, entry, true) {
                unresolved_world_ids.push(pending);
            }
        }
        unresolved_world_ids
    }

    pub(in super::super) fn enrich_notification_world_names(
        &self,
        projection: &mut RealtimeNotificationProjection,
    ) -> Vec<PendingWorldNameResolution> {
        let mut unresolved_world_ids = Vec::new();
        for upsert in &mut projection.upserts {
            if let Some(pending) = world_enrich::enrich_notification_world_name(
                &self.world_cache,
                &mut upsert.notification,
                true,
            ) {
                unresolved_world_ids.push(pending);
            }
        }
        unresolved_world_ids
    }

    pub(in super::super) fn enrich_persistence_world_names(
        &self,
        persistence: &mut RealtimePersistenceBatch,
    ) -> Vec<PendingWorldNameResolution> {
        let mut unresolved_world_ids = Vec::new();
        for entry in &mut persistence.feed_entries {
            if let Some(pending) = world_enrich::enrich_feed_entry(&self.world_cache, entry, false)
            {
                unresolved_world_ids.push(PendingWorldNameResolution::cache_only(pending.world_id));
            }
        }
        for notification in &mut persistence.notification_v1_upserts {
            if let Some(world_id) = self.enrich_world_name(notification) {
                unresolved_world_ids.push(PendingWorldNameResolution::cache_only(world_id));
            }
        }
        for notification in &mut persistence.notification_v2_upserts {
            if let Some(world_id) = self.enrich_world_name(notification) {
                unresolved_world_ids.push(PendingWorldNameResolution::cache_only(world_id));
            }
        }
        for update in &mut persistence.notification_v2_updates {
            if let Some(world_id) = self.enrich_world_name(&mut update.updates) {
                unresolved_world_ids.push(PendingWorldNameResolution::cache_only(world_id));
            }
        }
        unresolved_world_ids
    }

    pub(in super::super) fn enrich_world_name(&self, value: &mut Value) -> Option<String> {
        world_enrich::enrich_notification_world_name(&self.world_cache, value, false)
            .map(|pending| pending.world_id)
    }

    pub(in super::super) fn enrich_feed_entry_world_name(
        &self,
        entry: &mut FeedLiveEntry,
    ) -> Option<String> {
        world_enrich::enrich_feed_entry(&self.world_cache, entry, false)
            .map(|pending| pending.world_id)
    }

    pub(in super::super) fn enrich_instance_queue_projection(
        &self,
        projection: &mut RealtimeInstanceQueueProjection,
    ) {
        if world_enrich::is_meaningful_world_name(&projection.world_name) {
            return;
        }
        let world_id = projection.world_id.trim();
        if world_id.is_empty() {
            return;
        }
        if let Some(world_name) = self.world_cache.get_name(world_id) {
            projection.world_name = world_name;
        }
    }

    pub(in super::super) fn enrich_current_user_location_output(
        &self,
        output: &mut RealtimeCurrentUserOutput,
    ) {
        let Some(location_entry) = output.persistence.game_log_locations.first_mut() else {
            return;
        };
        if !location_entry.world_name.trim().is_empty()
            && location_entry.world_name.trim() != location_entry.world_id.trim()
        {
            return;
        }
        let world_name = match self
            .deps
            .stores
            .game_log
            .lookup_game_log_world_name(&location_entry.world_id)
        {
            Ok(world_name) => world_name,
            Err(error) => {
                tracing::warn!("Realtime current user world-name lookup failed: {error}");
                String::new()
            }
        };
        if world_name.is_empty() {
            return;
        }
        location_entry.world_name = world_name.clone();
        if let Some(game_state_patch) = output.projection.game_state_patch.as_mut() {
            let current_world_id = json_string_field(game_state_patch.get("currentWorldId"));
            if current_world_id == location_entry.world_id {
                game_state_patch.insert("currentWorldName".into(), Value::String(world_name));
            }
        }
    }
}
