use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use vrcx_0_contracts::InstanceRosterSnapshot;
use vrcx_0_core::location::parse_location;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLocationTime {
    pub user_id: String,
    pub location: String,
    pub since_ms: Option<i64>,
    pub source: FriendLocationTimeSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FriendLocationTimeSource {
    GameLog,
    Realtime,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FriendPlace {
    Present { location: String, since_ms: i64 },
    Traveling { destination: String, since_ms: i64 },
    Elsewhere { location: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FriendLocationPhase {
    Inactive,
    Present,
    Traveling,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FriendLocationEntry {
    location: String,
    since_ms: Option<i64>,
    phase: FriendLocationPhase,
    local_conflict: bool,
}

#[derive(Debug, Default)]
struct LocalInstanceRoster {
    location: String,
    entered_at_ms: Option<i64>,
    arrival_starts: HashMap<String, i64>,
    joins: HashMap<String, LocalInstanceJoin>,
}

#[derive(Debug)]
struct LocalInstanceJoin {
    joined_at_ms: i64,
    since_ms: i64,
}

#[derive(Debug, Default)]
struct InstanceDwellState {
    friends: HashMap<String, FriendLocationEntry>,
    local_roster: LocalInstanceRoster,
    game_running: Option<bool>,
}

type RosterChangeCallback = Arc<dyn Fn() + Send + Sync>;

#[derive(Default)]
pub struct InstanceDwellRegistry {
    state: Mutex<InstanceDwellState>,
    roster_change_callback: Mutex<Option<RosterChangeCallback>>,
}

impl fmt::Debug for InstanceDwellRegistry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("InstanceDwellRegistry")
            .finish_non_exhaustive()
    }
}

fn normalized(value: &str) -> &str {
    value.trim()
}

fn observed_entry(place: &FriendPlace) -> FriendLocationEntry {
    let (location, since_ms, phase) = match place {
        FriendPlace::Present { location, since_ms } => (
            location.as_str(),
            Some(*since_ms),
            FriendLocationPhase::Present,
        ),
        FriendPlace::Traveling {
            destination,
            since_ms,
        } => (
            destination.as_str(),
            (!destination.trim().is_empty()).then_some(*since_ms),
            FriendLocationPhase::Traveling,
        ),
        FriendPlace::Elsewhere { location } => {
            (location.as_str(), None, FriendLocationPhase::Inactive)
        }
    };
    FriendLocationEntry {
        location: normalized(location).to_string(),
        since_ms,
        phase,
        local_conflict: false,
    }
}

fn update_friend_entry(state: &mut InstanceDwellState, user_id: &str, place: &FriendPlace) {
    let mut next = observed_entry(place);
    next.local_conflict = state.local_roster.joins.contains_key(user_id)
        && state.local_roster.location != next.location;
    if let Some(previous) = state.friends.get(user_id) {
        if previous.location == next.location && previous.phase == next.phase {
            next.since_ms = previous.since_ms;
            next.local_conflict |= previous.local_conflict;
        }
    }
    if state.friends.get(user_id) != Some(&next) {
        state.local_roster.arrival_starts.remove(user_id);
    }
    state.friends.insert(user_id.to_string(), next);
}

fn update_local_roster(state: &mut InstanceDwellState, snapshot: &InstanceRosterSnapshot) {
    if state.game_running == Some(false) {
        state.local_roster = LocalInstanceRoster::default();
        return;
    }
    let mut previous = std::mem::take(&mut state.local_roster);
    let mut next = LocalInstanceRoster::default();
    if parse_location(&snapshot.location).is_real_instance {
        next.location = normalized(&snapshot.location).to_string();
        next.entered_at_ms = chrono::DateTime::parse_from_rfc3339(&snapshot.entered_at)
            .ok()
            .map(|time| time.timestamp_millis());
    }
    let same_visit =
        previous.location == next.location && previous.entered_at_ms == next.entered_at_ms;
    if same_visit {
        next.arrival_starts = std::mem::take(&mut previous.arrival_starts);
    } else if let Some(entered_at_ms) = next.entered_at_ms {
        next.arrival_starts = state
            .friends
            .iter()
            .filter_map(|(user_id, entry)| {
                let since_ms = entry.since_ms?;
                (entry.phase == FriendLocationPhase::Present
                    && !entry.local_conflict
                    && entry.location == next.location
                    && since_ms > 0
                    && since_ms <= entered_at_ms)
                    .then(|| (user_id.clone(), since_ms))
            })
            .collect();
    }
    if !snapshot.departed_user_ids.is_empty() {
        let observed_ms = chrono::Utc::now().timestamp_millis();
        for user_id in &snapshot.departed_user_ids {
            let user_id = normalized(user_id);
            if let Some(entry) = state.friends.get_mut(user_id) {
                entry.since_ms = entry.since_ms.map(|_| observed_ms);
            }
            next.arrival_starts.remove(user_id);
            previous.joins.remove(user_id);
        }
    }
    for user_id in &snapshot.replayed_departed_user_ids {
        next.arrival_starts.remove(normalized(user_id));
    }
    if !next.location.is_empty() {
        for member in &snapshot.members {
            let user_id = normalized(&member.user_id);
            let Some(joined_at_ms) = member.joined_at_ms.filter(|value| *value > 0) else {
                continue;
            };
            if user_id.is_empty() {
                continue;
            }
            if let Some(entry) = state.friends.get_mut(user_id) {
                entry.local_conflict |= entry.location != next.location;
            }
            let arrival_start = next
                .arrival_starts
                .remove(user_id)
                .filter(|since_ms| *since_ms <= joined_at_ms);
            let previous_join = previous.joins.get(user_id).filter(|_| same_visit);
            let since_ms = match previous_join {
                Some(join) if join.joined_at_ms == joined_at_ms => join.since_ms,
                Some(_) => joined_at_ms,
                None => arrival_start.unwrap_or(joined_at_ms),
            };
            next.joins.insert(
                user_id.to_string(),
                LocalInstanceJoin {
                    joined_at_ms,
                    since_ms,
                },
            );
        }
    }
    state.local_roster = next;
}

fn projected_friend(
    state: &InstanceDwellState,
    user_id: &str,
    entry: &FriendLocationEntry,
) -> FriendLocationTime {
    if let Some(join) = state.local_roster.joins.get(user_id) {
        return FriendLocationTime {
            user_id: user_id.to_string(),
            location: state.local_roster.location.clone(),
            since_ms: Some(join.since_ms),
            source: FriendLocationTimeSource::GameLog,
        };
    }

    FriendLocationTime {
        user_id: user_id.to_string(),
        location: entry.location.clone(),
        since_ms: entry.since_ms,
        source: FriendLocationTimeSource::Realtime,
    }
}

fn snapshot_locked(state: &InstanceDwellState) -> Vec<FriendLocationTime> {
    let mut snapshot = state
        .friends
        .iter()
        .map(|(user_id, entry)| projected_friend(state, user_id, entry))
        .collect::<Vec<_>>();
    snapshot.sort_by(|left, right| left.user_id.cmp(&right.user_id));
    snapshot
}

impl InstanceDwellRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_roster_change_callback(&self, callback: RosterChangeCallback) {
        let mut current = self
            .roster_change_callback
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *current = Some(callback);
    }

    pub fn sync_friends(
        &self,
        friends_by_id: &HashMap<String, FriendPlace>,
    ) -> Option<Vec<FriendLocationTime>> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let previous = snapshot_locked(&state);
        state
            .friends
            .retain(|user_id, _entry| friends_by_id.contains_key(user_id));
        state
            .local_roster
            .arrival_starts
            .retain(|user_id, _| friends_by_id.contains_key(user_id));
        for (user_id, place) in friends_by_id {
            update_friend_entry(&mut state, user_id, place);
        }
        let next = snapshot_locked(&state);
        (next != previous).then_some(next)
    }

    pub fn observe_friend(
        &self,
        user_id: &str,
        place: &FriendPlace,
    ) -> Option<Vec<FriendLocationTime>> {
        let user_id = normalized(user_id);
        if user_id.is_empty() {
            return None;
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let previous = snapshot_locked(&state);
        update_friend_entry(&mut state, user_id, place);
        let next = snapshot_locked(&state);
        (next != previous).then_some(next)
    }

    pub fn observe_roster(&self, snapshot: &InstanceRosterSnapshot) {
        let changed = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            let previous = snapshot_locked(&state);
            update_local_roster(&mut state, snapshot);
            snapshot_locked(&state) != previous
        };
        if !changed {
            return;
        }
        let callback = self
            .roster_change_callback
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        if let Some(callback) = callback {
            callback();
        }
    }

    pub fn snapshot(&self) -> Vec<FriendLocationTime> {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        snapshot_locked(&state)
    }

    pub fn forget_friend(&self, user_id: &str) -> Option<Vec<FriendLocationTime>> {
        let user_id = normalized(user_id);
        if user_id.is_empty() {
            return None;
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let previous = snapshot_locked(&state);
        state.friends.remove(user_id);
        state.local_roster.arrival_starts.remove(user_id);
        let next = snapshot_locked(&state);
        (next != previous).then_some(next)
    }

    #[cfg(test)]
    pub fn tracked_count(&self) -> (usize, usize) {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        (state.friends.len(), state.local_roster.joins.len())
    }

    pub fn clear(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.friends.clear();
        state.local_roster = LocalInstanceRoster::default();
    }
}

impl vrcx_0_contracts::InstanceRosterObserver for InstanceDwellRegistry {
    fn on_instance_roster(&self, snapshot: InstanceRosterSnapshot) {
        self.observe_roster(&snapshot);
    }

    fn on_game_running(&self, running: bool) {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .game_running = Some(running);
        if !running {
            self.observe_roster(&InstanceRosterSnapshot::default());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vrcx_0_contracts::InstanceRosterMember;
    use vrcx_0_core::friends::{
        FriendBaselineEntry, FriendBaselinePresence, FriendRecord, StateBucket,
    };

    fn roster(location: &str, members: &[(&str, i64)]) -> InstanceRosterSnapshot {
        InstanceRosterSnapshot {
            location: location.to_string(),
            world_name: String::new(),
            destination: String::new(),
            entered_at: String::new(),
            departed_user_ids: Vec::new(),
            replayed_departed_user_ids: Vec::new(),
            members: members
                .iter()
                .map(|(user_id, joined_at_ms)| InstanceRosterMember {
                    user_id: (*user_id).to_string(),
                    display_name: String::new(),
                    joined_at_ms: Some(*joined_at_ms),
                })
                .collect(),
        }
    }

    fn place_from_record(entry: &FriendBaselineEntry, observed_ms: i64) -> FriendPlace {
        let record = &entry.presence;
        let parsed = parse_location(&record.location);
        if StateBucket::normalize(&record.state) != Some(StateBucket::Online)
            || !(parsed.is_traveling || parsed.is_real_instance)
        {
            return FriendPlace::Elsewhere {
                location: record.location.clone(),
            };
        }
        if parsed.is_traveling {
            return FriendPlace::Traveling {
                destination: record.traveling_to_location.clone(),
                since_ms: observed_ms,
            };
        }
        FriendPlace::Present {
            location: record.location.clone(),
            since_ms: observed_ms,
        }
    }

    fn places_from_records(
        records: &HashMap<String, FriendBaselineEntry>,
        observed_ms: i64,
    ) -> HashMap<String, FriendPlace> {
        records
            .iter()
            .map(|(user_id, record)| (user_id.clone(), place_from_record(record, observed_ms)))
            .collect()
    }

    fn friend(user_id: &str, state: &str, location: &str) -> FriendBaselineEntry {
        FriendBaselineEntry {
            record: FriendRecord {
                id: user_id.to_string(),
                ..FriendRecord::default()
            },
            presence: FriendBaselinePresence {
                state: state.into(),
                location: location.to_string(),
                ..FriendBaselinePresence::default()
            },
        }
    }

    fn entered_roster(
        location: &str,
        entered_at_ms: i64,
        members: &[(&str, i64)],
    ) -> InstanceRosterSnapshot {
        InstanceRosterSnapshot {
            entered_at: chrono::DateTime::from_timestamp_millis(entered_at_ms)
                .unwrap()
                .to_rfc3339(),
            ..roster(location, members)
        }
    }

    #[test]
    fn entering_a_friends_instance_preserves_the_existing_dwell_start() {
        for publish_empty_roster_first in [false, true] {
            let registry = InstanceDwellRegistry::new();
            let record = friend("usr_a", "online", "wrld_a:1");
            let started_at = 1_000;
            let entered_at = started_at + 30 * 60_000;
            let observed_join = entered_at + 12_000;
            registry.observe_friend("usr_a", &place_from_record(&record, started_at));
            if publish_empty_roster_first {
                registry.observe_roster(&entered_roster("wrld_a:1", entered_at, &[]));
            }

            let local = entered_roster("wrld_a:1", entered_at, &[("usr_a", observed_join)]);
            registry.observe_roster(&local);

            assert_eq!(registry.snapshot()[0].since_ms, Some(started_at));
            assert_eq!(
                registry.snapshot()[0].source,
                FriendLocationTimeSource::GameLog
            );
            registry.observe_roster(&local);
            registry.observe_friend("usr_a", &place_from_record(&record, observed_join + 60_000));
            assert_eq!(registry.snapshot()[0].since_ms, Some(started_at));
            registry.observe_roster(&InstanceRosterSnapshot::default());
            assert_eq!(registry.snapshot()[0].since_ms, Some(started_at));
        }
    }

    #[test]
    fn inherited_local_start_is_stable_through_remote_changes_and_other_joins() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 1_000),
        );
        registry.observe_friend(
            "usr_b",
            &place_from_record(&friend("usr_b", "online", "wrld_b:2"), 1_000),
        );
        registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)]));

        for record in [
            friend("usr_a", "online", "traveling"),
            friend("usr_a", "offline", "offline"),
            friend("usr_a", "online", "wrld_b:2"),
            friend("usr_a", "online", "wrld_a:1"),
        ] {
            registry.observe_friend("usr_a", &place_from_record(&record, 9_000));
            registry.observe_roster(&entered_roster(
                "wrld_a:1",
                5_000,
                &[("usr_a", 6_000), ("usr_b", 10_000)],
            ));
            let times = registry.snapshot();
            assert_eq!(times[0].since_ms, Some(1_000));
            assert_eq!(times[0].location, "wrld_a:1");
            assert_eq!(times[1].since_ms, Some(10_000));
        }
    }

    #[test]
    fn local_arrival_only_inherits_present_time_known_before_self_entry() {
        let mut traveling = friend("usr_a", "online", "traveling");
        traveling.presence.traveling_to_location = "wrld_a:1".into();
        for (record, observed_at) in [
            (traveling, 1_000),
            (friend("usr_a", "online", "wrld_a:2"), 1_000),
            (friend("usr_a", "offline", "wrld_a:1"), 1_000),
            (friend("usr_a", "online", "private"), 1_000),
            (friend("usr_a", "online", "wrld_a:1"), 0),
            (friend("usr_a", "online", "wrld_a:1"), 5_001),
        ] {
            let registry = InstanceDwellRegistry::new();
            registry.observe_friend("usr_a", &place_from_record(&record, observed_at));
            registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)]));
            assert_eq!(registry.snapshot()[0].since_ms, Some(6_000));
        }

        for entered_at in ["", "invalid"] {
            let registry = InstanceDwellRegistry::new();
            registry.observe_friend(
                "usr_a",
                &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 1_000),
            );
            registry.observe_roster(&InstanceRosterSnapshot {
                entered_at: entered_at.into(),
                ..roster("wrld_a:1", &[("usr_a", 6_000)])
            });
            assert_eq!(registry.snapshot()[0].since_ms, Some(6_000));
        }
    }

    #[test]
    fn remote_departure_before_local_observation_cancels_the_arrival_start() {
        let registry = InstanceDwellRegistry::new();
        let record = friend("usr_a", "online", "wrld_a:1");
        registry.observe_friend("usr_a", &place_from_record(&record, 1_000));
        registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[]));
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "offline", "offline"), 5_100),
        );
        registry.observe_friend("usr_a", &place_from_record(&record, 5_200));
        registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(6_000));
    }

    #[test]
    fn a_new_local_join_cannot_reuse_an_inherited_start() {
        for publish_leave_first in [false, true] {
            let registry = InstanceDwellRegistry::new();
            registry.observe_friend(
                "usr_a",
                &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 1_000),
            );
            registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)]));
            assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
            if publish_leave_first {
                registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[]));
            }
            registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 9_000)]));
            assert_eq!(registry.snapshot()[0].since_ms, Some(9_000));
        }
    }

    #[test]
    fn a_batched_departure_cancels_arrival_and_same_timestamp_rejoin_starts() {
        for observed_locally_first in [false, true] {
            let registry = InstanceDwellRegistry::new();
            registry.observe_friend(
                "usr_a",
                &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 1_000),
            );
            registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[]));
            if observed_locally_first {
                registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)]));
                assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
            }
            registry.observe_roster(&InstanceRosterSnapshot {
                departed_user_ids: vec!["usr_a".into()],
                ..entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)])
            });
            assert_eq!(registry.snapshot()[0].since_ms, Some(6_000));
        }
    }

    #[test]
    fn self_reentry_to_the_same_instance_gets_a_new_arrival_context() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 1_000),
        );
        registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)]));
        registry.observe_roster(&entered_roster("wrld_a:1", 9_000, &[("usr_a", 10_000)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
    }

    #[test]
    fn conflicting_previous_local_presence_cannot_seed_the_next_instance() {
        for publish_self_leave_first in [false, true] {
            let registry = InstanceDwellRegistry::new();
            let record = friend("usr_a", "online", "wrld_b:2");
            registry.observe_friend("usr_a", &place_from_record(&record, 1_000));
            registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)]));
            registry.observe_friend("usr_a", &place_from_record(&record, 7_000));
            if publish_self_leave_first {
                registry.observe_roster(&roster("traveling", &[]));
            }
            registry.observe_roster(&entered_roster("wrld_b:2", 9_000, &[("usr_a", 10_000)]));
            assert_eq!(registry.snapshot()[0].since_ms, Some(10_000));
        }
    }

    #[test]
    fn cold_start_roster_and_baseline_order_does_not_change_the_local_start() {
        for roster_first in [false, true] {
            let registry = InstanceDwellRegistry::new();
            let local = entered_roster("wrld_a:1", 1_000, &[("usr_a", 2_000)]);
            if roster_first {
                registry.observe_roster(&local);
            }
            registry.sync_friends(&places_from_records(
                &HashMap::from([("usr_a".into(), friend("usr_a", "online", "wrld_a:1"))]),
                5_000,
            ));
            registry.observe_roster(&local);
            assert_eq!(registry.snapshot()[0].since_ms, Some(2_000));
        }
    }

    #[test]
    fn replayed_departures_cancel_arrival_starts_without_restarting_remote_time() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 1_000),
        );
        registry.observe_roster(&InstanceRosterSnapshot {
            replayed_departed_user_ids: vec!["usr_a".into()],
            ..entered_roster("wrld_a:1", 5_000, &[])
        });
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
        registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(6_000));
    }

    #[test]
    fn removing_a_friend_or_clearing_the_session_discards_arrival_starts() {
        for removal in 0..3 {
            let registry = InstanceDwellRegistry::new();
            let record = friend("usr_a", "online", "wrld_a:1");
            registry.observe_friend("usr_a", &place_from_record(&record, 1_000));
            registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[]));
            match removal {
                0 => {
                    registry.forget_friend("usr_a");
                }
                1 => {
                    registry.sync_friends(&places_from_records(&HashMap::new(), 5_100));
                }
                _ => {
                    registry.clear();
                    registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[]));
                }
            }
            registry.observe_friend("usr_a", &place_from_record(&record, 5_200));
            registry.observe_roster(&entered_roster("wrld_a:1", 5_000, &[("usr_a", 6_000)]));
            assert_eq!(registry.snapshot()[0].since_ms, Some(6_000));
        }
    }

    #[test]
    fn friend_snapshot_contains_every_current_friend() {
        let registry = InstanceDwellRegistry::new();
        let friends = HashMap::from([
            (
                "usr_online".to_string(),
                friend("usr_online", "online", "wrld_a:1"),
            ),
            (
                "usr_offline".to_string(),
                friend("usr_offline", "offline", "offline"),
            ),
        ]);

        let snapshot = registry
            .sync_friends(&places_from_records(&friends, 5_000))
            .unwrap();

        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].user_id, "usr_offline");
        assert_eq!(snapshot[0].since_ms, None);
        assert_eq!(snapshot[1].user_id, "usr_online");
        assert_eq!(snapshot[1].location, "wrld_a:1");
        assert_eq!(snapshot[1].since_ms, Some(5_000));

        assert_eq!(
            registry.sync_friends(&places_from_records(&HashMap::new(), 6_000)),
            Some(vec![])
        );
    }

    #[test]
    fn repeated_observation_in_the_same_instance_keeps_the_start() {
        let registry = InstanceDwellRegistry::new();
        let record = friend("usr_a", "online", "wrld_a:1");
        registry.observe_friend("usr_a", &place_from_record(&record, 1_000));

        assert_eq!(
            registry.observe_friend("usr_a", &place_from_record(&record, 8_000)),
            None
        );
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
    }

    #[test]
    fn local_mode_ignores_remote_location_and_state_changes() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 500),
        );
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        for record in [
            friend("usr_a", "online", "traveling"),
            friend("usr_a", "offline", "offline"),
            friend("usr_a", "online", "wrld_b:2"),
        ] {
            registry.observe_friend("usr_a", &place_from_record(&record, 18_001_000));
            let snapshot = registry.snapshot();
            assert_eq!(snapshot[0].location, "wrld_a:1");
            assert_eq!(snapshot[0].since_ms, Some(1_000));
        }
    }

    #[test]
    fn local_mode_friend_leave_restarts_remote_time_without_another_ws_event() {
        let registry = InstanceDwellRegistry::new();
        let record = friend("usr_a", "online", "wrld_a:1");
        registry.observe_friend("usr_a", &place_from_record(&record, 500));
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));
        let before_leave = chrono::Utc::now().timestamp_millis();

        registry.observe_roster(&InstanceRosterSnapshot {
            departed_user_ids: vec!["usr_a".into()],
            ..roster("wrld_a:1", &[])
        });

        let restarted_at = registry.snapshot()[0].since_ms.unwrap();
        assert!(restarted_at >= before_leave);
        assert!(restarted_at <= chrono::Utc::now().timestamp_millis());
        registry.observe_friend("usr_a", &place_from_record(&record, restarted_at + 5_000));
        assert_eq!(registry.snapshot()[0].since_ms, Some(restarted_at));
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_b:2"), restarted_at + 8_000),
        );
        assert_eq!(registry.snapshot()[0].since_ms, Some(restarted_at + 8_000));
    }

    #[test]
    fn local_mode_self_leave_does_not_restart_other_friends() {
        for next in [
            roster("traveling", &[]),
            roster("wrld_b:2", &[]),
            InstanceRosterSnapshot::default(),
            InstanceRosterSnapshot {
                entered_at: "1970-01-01T00:00:20Z".into(),
                ..roster("wrld_a:1", &[])
            },
        ] {
            let registry = InstanceDwellRegistry::new();
            registry.observe_friend(
                "usr_a",
                &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 5_000),
            );
            registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

            registry.observe_roster(&next);

            assert_eq!(registry.snapshot()[0].location, "wrld_a:1");
            assert_eq!(registry.snapshot()[0].since_ms, Some(5_000));
        }
    }

    #[test]
    fn local_mode_new_join_replaces_the_previous_visit_even_in_one_snapshot() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 500),
        );
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 20_000)]));

        assert_eq!(registry.snapshot()[0].since_ms, Some(20_000));
    }

    #[test]
    fn moving_to_another_instance_restarts_the_timer() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 1_000),
        );
        let snapshot = registry
            .observe_friend(
                "usr_a",
                &place_from_record(&friend("usr_a", "online", "wrld_b:2"), 7_000),
            )
            .unwrap();

        assert_eq!(snapshot[0].location, "wrld_b:2");
        assert_eq!(snapshot[0].since_ms, Some(7_000));
    }

    #[test]
    fn traveling_arrival_restarts_the_timer_even_for_the_same_target() {
        let registry = InstanceDwellRegistry::new();
        let mut traveling = friend("usr_a", "online", "traveling");
        traveling.presence.traveling_to_location = "wrld_a:1".to_string();
        registry.observe_friend("usr_a", &place_from_record(&traveling, 1_000));
        assert_eq!(registry.snapshot()[0].location, "wrld_a:1");
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));

        let arrived = friend("usr_a", "online", "wrld_a:1");
        let snapshot = registry
            .observe_friend("usr_a", &place_from_record(&arrived, 7_000))
            .unwrap();

        assert_eq!(snapshot[0].location, "wrld_a:1");
        assert_eq!(snapshot[0].since_ms, Some(7_000));
    }

    #[test]
    fn pending_offline_preserves_the_start_until_offline_is_confirmed() {
        let registry = InstanceDwellRegistry::new();
        let online = friend("usr_a", "online", "wrld_a:1");
        registry.observe_friend("usr_a", &place_from_record(&online, 1_000));
        let mut pending = online.clone();
        pending
            .record
            .extra
            .insert("pendingOffline".into(), serde_json::Value::Bool(true));

        assert_eq!(
            registry.observe_friend("usr_a", &place_from_record(&pending, 5_000)),
            None
        );
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));

        assert_eq!(
            registry.observe_friend("usr_a", &place_from_record(&online, 6_000)),
            None
        );
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));

        let snapshot = registry
            .observe_friend(
                "usr_a",
                &place_from_record(&friend("usr_a", "offline", "offline"), 7_000),
            )
            .unwrap();
        assert_eq!(snapshot[0].since_ms, None);
    }

    #[test]
    fn returning_online_restarts_even_when_the_location_is_unchanged() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 1_000),
        );
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "offline", "wrld_a:1"), 5_000),
        );
        let snapshot = registry
            .observe_friend(
                "usr_a",
                &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 8_000),
            )
            .unwrap();

        assert_eq!(snapshot[0].since_ms, Some(8_000));
    }

    #[test]
    fn roster_join_time_is_projected_only_for_current_friends() {
        let registry = InstanceDwellRegistry::new();
        let friends = HashMap::from([(
            "usr_friend".to_string(),
            friend("usr_friend", "online", "private"),
        )]);
        registry.sync_friends(&places_from_records(&friends, 5_000));

        registry.observe_roster(&roster(
            "wrld_a:1",
            &[("usr_friend", 1_000), ("usr_stranger", 2_000)],
        ));
        let snapshot = registry.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].user_id, "usr_friend");
        assert_eq!(snapshot[0].location, "wrld_a:1");
        assert_eq!(snapshot[0].since_ms, Some(1_000));

        registry.observe_roster(&roster("wrld_a:1", &[]));
        assert_eq!(registry.snapshot()[0].since_ms, None);
    }

    #[test]
    fn local_roster_replaces_the_start_with_the_current_join() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 5_000),
        );

        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 9_000)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(9_000));
    }

    #[test]
    fn game_exit_restores_remote_time_and_rejects_stale_local_rosters() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 5_000),
        );
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        vrcx_0_contracts::InstanceRosterObserver::on_game_running(&registry, false);
        registry.observe_roster(&InstanceRosterSnapshot::default());
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        assert_eq!(registry.snapshot()[0].since_ms, Some(5_000));
        assert_eq!(
            registry.snapshot()[0].source,
            FriendLocationTimeSource::Realtime
        );
        assert_eq!(registry.tracked_count(), (1, 0));
    }

    #[test]
    fn self_leaving_releases_local_mode_to_the_latest_remote_presence() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 5_000),
        );
        let mut traveling = friend("usr_a", "online", "traveling");
        traveling.presence.traveling_to_location = "wrld_a:1".into();
        registry.observe_friend("usr_a", &place_from_record(&traveling, 7_000));
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 9_000),
        );

        registry.observe_roster(&InstanceRosterSnapshot::default());

        assert_eq!(registry.snapshot()[0].since_ms, Some(9_000));
    }

    #[test]
    fn friend_leaving_restarts_the_latest_remote_instance_time() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 5_000),
        );
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_b:2"), 9_000),
        );
        assert_eq!(registry.snapshot()[0].location, "wrld_a:1");
        let before_leave = chrono::Utc::now().timestamp_millis();
        registry.observe_roster(&InstanceRosterSnapshot {
            departed_user_ids: vec!["usr_a".into()],
            ..roster("wrld_a:1", &[])
        });

        assert_eq!(registry.snapshot()[0].location, "wrld_b:2");
        assert!(registry.snapshot()[0].since_ms.unwrap() >= before_leave);
    }

    #[test]
    fn new_instance_roster_does_not_reuse_previous_instance_members() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_b:2"), 100_000),
        );
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        registry.observe_roster(&roster("wrld_b:2", &[]));
        assert_eq!(registry.tracked_count(), (1, 0));
        assert_eq!(registry.snapshot()[0].since_ms, Some(100_000));

        registry.observe_roster(&roster("wrld_b:2", &[("usr_a", 100_500)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(100_500));
    }

    #[test]
    fn game_exit_discards_roster_members_before_the_next_instance() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_b:2"), 100_000),
        );
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        vrcx_0_contracts::InstanceRosterObserver::on_game_running(&registry, false);
        assert_eq!(registry.tracked_count(), (1, 0));

        vrcx_0_contracts::InstanceRosterObserver::on_game_running(&registry, true);
        registry.observe_roster(&roster("wrld_b:2", &[]));
        registry.observe_roster(&roster("wrld_b:2", &[("usr_a", 100_500)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(100_500));
    }

    #[test]
    fn game_start_in_another_instance_preserves_remote_friend_timers() {
        let registry = InstanceDwellRegistry::new();
        for (user_id, observed_ms) in [("usr_a", 1_000), ("usr_b", 2_000)] {
            registry.observe_friend(
                user_id,
                &place_from_record(&friend(user_id, "online", "wrld_friends:1"), observed_ms),
            );
        }
        vrcx_0_contracts::InstanceRosterObserver::on_game_running(&registry, false);
        let before = registry.snapshot();

        vrcx_0_contracts::InstanceRosterObserver::on_game_running(&registry, true);
        registry.observe_roster(&roster("wrld_self:2", &[]));

        assert_eq!(registry.snapshot(), before);
        assert!(before
            .iter()
            .all(|entry| entry.source == FriendLocationTimeSource::Realtime));
    }

    #[test]
    fn local_roster_overrides_conflicting_remote_presence() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_remote",
            &place_from_record(&friend("usr_remote", "online", "wrld_far:9"), 3_000),
        );
        registry.observe_roster(&roster("wrld_a:1", &[("usr_remote", 1_000)]));

        assert_eq!(registry.snapshot()[0].location, "wrld_a:1");
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
    }

    #[test]
    fn forgetting_and_clearing_remove_tracked_friends() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend(
            "usr_a",
            &place_from_record(&friend("usr_a", "online", "wrld_a:1"), 1_000),
        );
        assert_eq!(registry.forget_friend("usr_a").unwrap(), []);

        registry.observe_friend(
            "usr_b",
            &place_from_record(&friend("usr_b", "online", "wrld_b:2"), 2_000),
        );
        registry.clear();
        assert!(registry.snapshot().is_empty());
        assert_eq!(registry.tracked_count(), (0, 0));
    }

    #[test]
    fn baseline_reconnect_preserves_time_until_the_registry_is_cleared() {
        let registry = InstanceDwellRegistry::new();
        let friends = HashMap::from([("usr_a".to_string(), friend("usr_a", "online", "wrld_a:1"))]);

        registry.sync_friends(&places_from_records(&friends, 1_000));
        assert_eq!(
            registry.sync_friends(&places_from_records(&friends, 5_000)),
            None
        );
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));

        registry.clear();
        let snapshot = registry
            .sync_friends(&places_from_records(&friends, 8_000))
            .unwrap();
        assert_eq!(snapshot[0].since_ms, Some(8_000));
    }
}
