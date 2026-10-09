use std::collections::VecDeque;
use std::sync::atomic::Ordering;

use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::feed::{
    FeedLatestQueryInput, FeedLiveEntryInput, FeedLiveQueryMatcher, FeedReadModelOutput,
    FeedRowOutput, FeedSearchQueryInput,
};
use vrcx_0_contracts::feed_live::FeedLiveEntry;

use crate::realtime::{
    RealtimeEntryCorrectionFields, RealtimeFeedPatch, RealtimeFeedProjection, RealtimeFeedUpsert,
};

use super::RealtimeHostRuntime;
use vrcx_0_core::OwnerId;

const FEED_LIVE_CACHE_MAX_ENTRIES: usize = 10_000;

#[derive(Clone, Debug)]
struct CachedFeedEntry {
    sequence: i64,
    entry: FeedLiveEntry,
}

#[derive(Default)]
pub(super) struct FeedLiveCache {
    owner_user_id: OwnerId,
    sequence: i64,
    entries: VecDeque<CachedFeedEntry>,
}

impl FeedLiveCache {
    fn reset(&mut self) {
        self.owner_user_id = OwnerId::default();
        self.sequence = 0;
        self.entries.clear();
    }

    fn prepare_owner(&mut self, owner_user_id: &OwnerId) {
        if &self.owner_user_id != owner_user_id {
            self.reset();
            self.owner_user_id = owner_user_id.clone();
        }
    }

    fn push_entries(
        &mut self,
        owner_user_id: &OwnerId,
        entries: Vec<FeedLiveEntry>,
    ) -> Vec<RealtimeFeedUpsert> {
        self.prepare_owner(owner_user_id);
        let mut upserts = Vec::new();
        for mut entry in entries {
            entry.set_owner_user_id(owner_user_id.to_string());
            self.sequence = self.sequence.saturating_add(1);
            let sequence = self.sequence;
            self.entries.push_back(CachedFeedEntry {
                sequence,
                entry: entry.clone(),
            });
            upserts.push(RealtimeFeedUpsert { sequence, entry });
        }
        while self.entries.len() > FEED_LIVE_CACHE_MAX_ENTRIES {
            self.entries.pop_front();
        }
        upserts
    }

    fn patch_entry(
        &mut self,
        owner_user_id: &OwnerId,
        id: &str,
        fields: &RealtimeEntryCorrectionFields,
    ) -> Option<i64> {
        if &self.owner_user_id != owner_user_id {
            return None;
        }
        let mut changed_indices = Vec::new();
        for (index, cached) in self.entries.iter_mut().enumerate() {
            if cached.entry.correction_id() != id {
                continue;
            }
            let mut changed = false;
            if let Some(display_name) = fields.display_name.as_ref() {
                if cached.entry.display_name() != display_name {
                    cached.entry.set_display_name(display_name.clone());
                    changed = true;
                }
            }
            if let Some(world_name) = fields.world_name.as_ref() {
                if cached.entry.world_name() != world_name {
                    cached.entry.set_world_name(world_name.clone());
                    changed = true;
                }
            }
            if let Some(display_location) = fields.display_location.as_ref() {
                if cached.entry.display_location() != Some(display_location.as_str()) {
                    cached.entry.set_display_location(display_location.clone());
                    changed = true;
                }
            }
            if changed {
                changed_indices.push(index);
            }
        }
        if changed_indices.is_empty() {
            return None;
        }
        self.sequence = self.sequence.saturating_add(1);
        for index in changed_indices {
            if let Some(entry) = self.entries.get_mut(index) {
                entry.sequence = self.sequence;
            }
        }
        Some(self.sequence)
    }

    fn snapshot_matching(
        &self,
        owner_user_id: &OwnerId,
        matcher: &FeedLiveQueryMatcher,
    ) -> (Vec<FeedLiveEntryInput>, i64) {
        if &self.owner_user_id != owner_user_id {
            return (Vec::new(), 0);
        }
        let mut entries = self
            .entries
            .iter()
            .rev()
            .filter(|entry| matcher.matches(&entry.entry))
            .take(matcher.max_rows().unwrap_or(usize::MAX))
            .map(|entry| FeedLiveEntryInput {
                sequence: entry.sequence,
                entry: entry.entry.clone(),
            })
            .collect::<Vec<_>>();
        entries.reverse();
        (entries, self.sequence)
    }
}

impl RealtimeHostRuntime {
    pub(super) fn emit_feed_entries(
        &self,
        generation: u64,
        owner_user_id: &OwnerId,
        entries: Vec<FeedLiveEntry>,
    ) {
        if entries.is_empty() || !self.deps.store.records_realtime_history() {
            return;
        }
        let _owner = self
            .feed_owner_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if self
            .active_feed_scope()
            .is_none_or(|scope| scope != (generation, owner_user_id.clone()))
        {
            return;
        }
        let upserts = self
            .feed_live_cache
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push_entries(owner_user_id, entries);
        if upserts.is_empty() {
            return;
        }
        self.deps.event_bus.emit(RealtimeFeedProjection {
            generation,
            owner_user_id: owner_user_id.clone(),
            upserts,
            patches: Vec::new(),
        });
    }

    pub(super) fn emit_feed_patch(&self, id: String, fields: RealtimeEntryCorrectionFields) {
        let _owner = self
            .feed_owner_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some((generation, owner_user_id)) = self.active_feed_scope() else {
            return;
        };
        let sequence = self
            .feed_live_cache
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .patch_entry(&owner_user_id, &id, &fields);
        let Some(sequence) = sequence else {
            return;
        };
        self.deps.event_bus.emit(RealtimeFeedProjection {
            generation,
            owner_user_id,
            upserts: Vec::new(),
            patches: vec![RealtimeFeedPatch {
                sequence,
                id,
                fields,
            }],
        });
    }

    pub fn query_feed_latest(&self, query: FeedLatestQueryInput) -> Result<FeedReadModelOutput> {
        let matcher = FeedLiveQueryMatcher::for_latest(&query);
        let (live_entries, watermark) =
            self.feed_live_snapshot(&OwnerId::new(query.user_id.clone()), &matcher)?;
        self.deps.store.feed_latest(
            query,
            live_entries,
            watermark,
            !self.feed_persistence_disabled.load(Ordering::Relaxed),
        )
    }

    pub fn query_feed_search(&self, query: FeedSearchQueryInput) -> Result<Vec<FeedRowOutput>> {
        let matcher = FeedLiveQueryMatcher::for_search(&query);
        let (live_entries, watermark) =
            self.feed_live_snapshot(&OwnerId::new(query.user_id.clone()), &matcher)?;
        self.deps
            .store
            .feed_search(
                query,
                live_entries,
                watermark,
                !self.feed_persistence_disabled.load(Ordering::Relaxed),
            )
            .map(|output| output.rows)
    }

    pub(super) fn reset_feed_live_cache(&self) {
        let _owner = self
            .feed_owner_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.feed_live_cache
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .reset();
    }

    fn feed_live_snapshot(
        &self,
        owner_user_id: &OwnerId,
        matcher: &FeedLiveQueryMatcher,
    ) -> Result<(Vec<FeedLiveEntryInput>, i64)> {
        self.feed_live_cache
            .lock()
            .map(|cache| cache.snapshot_matching(owner_user_id, matcher))
            .map_err(|error| Error::Custom(format!("feed live cache lock: {error}")))
    }

    fn active_feed_scope(&self) -> Option<(u64, OwnerId)> {
        self.state.lock().ok().and_then(|state| {
            state.connection.active_context.as_ref().map(|active| {
                (
                    active.generation,
                    OwnerId::new(active.session.user_id.trim()),
                )
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use vrcx_0_contracts::feed::{FeedFilter, FeedLatestQueryInput, FeedLiveQueryMatcher};
    use vrcx_0_contracts::feed_live::FeedLiveEntry;
    use vrcx_0_core::OwnerId;

    use super::FeedLiveCache;
    use crate::realtime::RealtimeEntryCorrectionFields;

    fn gps_entry(created_at: &str) -> FeedLiveEntry {
        FeedLiveEntry::Gps {
            created_at: created_at.to_string(),
            user_id: "usr_friend".into(),
            display_name: "Friend".into(),
            location: "wrld_1:1".into(),
            world_name: String::new(),
            previous_location: String::new(),
            time: 0,
            group_name: String::new(),
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        }
    }

    fn online_entry(created_at: &str) -> FeedLiveEntry {
        FeedLiveEntry::Online {
            created_at: created_at.to_string(),
            user_id: "usr_friend".into(),
            display_name: "Friend".into(),
            location: "wrld_2:1".into(),
            world_name: String::new(),
            group_name: String::new(),
            time: None,
            world_id: None,
            display_location: None,
            owner_user_id: String::new(),
        }
    }

    fn status_entry(created_at: &str) -> FeedLiveEntry {
        FeedLiveEntry::Status {
            created_at: created_at.to_string(),
            user_id: "usr_friend".into(),
            display_name: "Friend".into(),
            status: "active".into(),
            status_description: String::new(),
            previous_status: "join me".into(),
            previous_status_description: String::new(),
            owner_user_id: String::new(),
        }
    }

    fn latest_matcher(
        user_id: &str,
        filters: Vec<FeedFilter>,
        max_rows: i64,
    ) -> FeedLiveQueryMatcher {
        FeedLiveQueryMatcher::for_latest(&FeedLatestQueryInput {
            user_id: user_id.into(),
            filters,
            favorite_user_ids: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            location_hidden_user_ids: Vec::new(),
            favorites_only: false,
            max_rows,
        })
    }

    #[test]
    fn cache_owns_sequences_entries_and_corrections() {
        let mut cache = FeedLiveCache::default();
        let first = gps_entry("2026-05-14T00:00:01Z");
        let upserts = cache.push_entries(
            &OwnerId::new("usr_self"),
            vec![first.clone(), online_entry("2026-05-14T00:00:02Z")],
        );

        assert_eq!(upserts[0].sequence, 1);
        assert_eq!(upserts[1].sequence, 2);
        assert_eq!(upserts[0].entry.owner_user_id(), "usr_self");

        let correction_sequence = cache.patch_entry(
            &OwnerId::new("usr_self"),
            &first.correction_id(),
            &RealtimeEntryCorrectionFields {
                display_name: None,
                world_name: Some("Resolved World".into()),
                display_location: Some("Resolved World".into()),
            },
        );
        assert_eq!(correction_sequence, Some(3));

        let matcher = latest_matcher("usr_self", Vec::new(), 10);
        let (entries, watermark) = cache.snapshot_matching(&OwnerId::new("usr_self"), &matcher);
        assert_eq!(watermark, 3);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].sequence, 3);
        assert_eq!(entries[0].entry.world_name(), "Resolved World");
        assert_eq!(entries[1].sequence, 2);
    }

    #[test]
    fn changing_owner_resets_the_cache_and_sequence() {
        let mut cache = FeedLiveCache::default();
        cache.push_entries(
            &OwnerId::new("usr_first"),
            vec![gps_entry("2026-05-14T00:00:01Z")],
        );

        let upserts = cache.push_entries(
            &OwnerId::new("usr_second"),
            vec![gps_entry("2026-05-14T00:00:02Z")],
        );
        let matcher = latest_matcher("usr_second", Vec::new(), 10);
        let (entries, watermark) = cache.snapshot_matching(&OwnerId::new("usr_second"), &matcher);

        assert_eq!(upserts[0].sequence, 1);
        assert_eq!(watermark, 1);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].entry.created_at(), "2026-05-14T00:00:02Z");
        assert!(cache
            .snapshot_matching(&OwnerId::new("usr_first"), &matcher)
            .0
            .is_empty());
    }

    #[test]
    fn snapshot_clones_only_the_newest_matching_rows() {
        let mut cache = FeedLiveCache::default();
        cache.push_entries(
            &OwnerId::new("usr_self"),
            vec![
                gps_entry("2026-05-14T00:00:01Z"),
                status_entry("2026-05-14T00:00:02Z"),
                gps_entry("2026-05-14T00:00:03Z"),
                gps_entry("2026-05-14T00:00:04Z"),
            ],
        );
        let matcher = latest_matcher("usr_self", vec![FeedFilter::Gps], 2);

        let (entries, watermark) = cache.snapshot_matching(&OwnerId::new("usr_self"), &matcher);

        assert_eq!(watermark, 4);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].entry.created_at(), "2026-05-14T00:00:03Z");
        assert_eq!(entries[1].entry.created_at(), "2026-05-14T00:00:04Z");
    }
}
