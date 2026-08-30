use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use vrcx_0_contracts::InstanceRosterSnapshot;
use vrcx_0_core::friends::{FriendRecord, StateBucket};
use vrcx_0_core::location::parse_location;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendLocationTime {
    pub user_id: String,
    pub location: String,
    pub since_ms: Option<i64>,
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
}

#[derive(Debug, Default)]
struct InstanceDwellState {
    friends: HashMap<String, FriendLocationEntry>,
    roster_location: String,
    roster_joins: HashMap<String, i64>,
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

fn is_pending_offline(record: &FriendRecord) -> bool {
    record
        .extra
        .get("pendingOffline")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn observed_entry(record: &FriendRecord, observed_ms: i64) -> FriendLocationEntry {
    if !StateBucket::Online.matches(&record.state) {
        return FriendLocationEntry {
            location: normalized(&record.location).to_string(),
            since_ms: None,
            phase: FriendLocationPhase::Inactive,
        };
    }

    let parsed = parse_location(&record.location);
    if parsed.is_traveling {
        let location = normalized(&record.traveling_to_location).to_string();
        return FriendLocationEntry {
            since_ms: (!location.is_empty()).then_some(observed_ms),
            location,
            phase: FriendLocationPhase::Traveling,
        };
    }
    if parsed.is_real_instance {
        return FriendLocationEntry {
            location: normalized(&record.location).to_string(),
            since_ms: Some(observed_ms),
            phase: FriendLocationPhase::Present,
        };
    }

    FriendLocationEntry {
        location: normalized(&record.location).to_string(),
        since_ms: None,
        phase: FriendLocationPhase::Inactive,
    }
}

fn calibrate_friend_entry(
    entry: &mut FriendLocationEntry,
    roster_location: &str,
    joined_at_ms: i64,
) {
    if entry.location == roster_location
        && matches!(
            entry.phase,
            FriendLocationPhase::Present | FriendLocationPhase::Traveling
        )
    {
        entry.since_ms = Some(
            entry
                .since_ms
                .map_or(joined_at_ms, |since_ms| since_ms.min(joined_at_ms)),
        );
    }
}

fn update_friend_entry(
    state: &mut InstanceDwellState,
    user_id: &str,
    record: &FriendRecord,
    observed_ms: i64,
) {
    if is_pending_offline(record) && state.friends.contains_key(user_id) {
        return;
    }

    let mut next = observed_entry(record, observed_ms);
    if let Some(previous) = state.friends.get(user_id) {
        if previous.location == next.location && previous.phase == next.phase {
            next.since_ms = previous.since_ms;
        }
    }
    if let Some(&joined_at_ms) = state.roster_joins.get(user_id) {
        calibrate_friend_entry(&mut next, &state.roster_location, joined_at_ms);
    }
    state.friends.insert(user_id.to_string(), next);
}

fn projected_friend(
    state: &InstanceDwellState,
    user_id: &str,
    entry: &FriendLocationEntry,
) -> FriendLocationTime {
    let roster_join = state.roster_joins.get(user_id).copied();
    let roster_can_supply_location = !state.roster_location.is_empty()
        && entry.phase == FriendLocationPhase::Inactive
        && !parse_location(&entry.location).is_real_instance;

    if let Some(joined_at_ms) = roster_join {
        if roster_can_supply_location {
            return FriendLocationTime {
                user_id: user_id.to_string(),
                location: state.roster_location.clone(),
                since_ms: Some(joined_at_ms),
            };
        }
    }

    FriendLocationTime {
        user_id: user_id.to_string(),
        location: entry.location.clone(),
        since_ms: entry.since_ms,
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
        friends_by_id: &HashMap<String, FriendRecord>,
        observed_ms: i64,
    ) -> Option<Vec<FriendLocationTime>> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let previous = snapshot_locked(&state);
        state
            .friends
            .retain(|user_id, _entry| friends_by_id.contains_key(user_id));
        for (user_id, record) in friends_by_id {
            update_friend_entry(&mut state, user_id, record, observed_ms);
        }
        let next = snapshot_locked(&state);
        (next != previous).then_some(next)
    }

    pub fn observe_friend_record(
        &self,
        user_id: &str,
        record: &FriendRecord,
        observed_ms: i64,
    ) -> Option<Vec<FriendLocationTime>> {
        let user_id = normalized(user_id);
        if user_id.is_empty() {
            return None;
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let previous = snapshot_locked(&state);
        update_friend_entry(&mut state, user_id, record, observed_ms);
        let next = snapshot_locked(&state);
        (next != previous).then_some(next)
    }

    pub fn observe_roster(&self, snapshot: &InstanceRosterSnapshot) {
        let location = normalized(&snapshot.location).to_string();
        let changed = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            let previous = snapshot_locked(&state);
            let previous_joins = if state.roster_location == location {
                std::mem::take(&mut state.roster_joins)
            } else {
                state.roster_joins.clear();
                HashMap::new()
            };
            state.roster_location = location.clone();
            if !location.is_empty() {
                for member in &snapshot.members {
                    let user_id = normalized(&member.user_id);
                    let Some(joined_at_ms) = member.joined_at_ms.filter(|value| *value > 0) else {
                        continue;
                    };
                    if !user_id.is_empty() {
                        let joined_at_ms = previous_joins
                            .get(user_id)
                            .copied()
                            .map_or(joined_at_ms, |previous| previous.min(joined_at_ms));
                        state.roster_joins.insert(user_id.to_string(), joined_at_ms);
                        if let Some(entry) = state.friends.get_mut(user_id) {
                            calibrate_friend_entry(entry, &location, joined_at_ms);
                        }
                    }
                }
            }
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
        let next = snapshot_locked(&state);
        (next != previous).then_some(next)
    }

    #[cfg(test)]
    pub fn tracked_count(&self) -> (usize, usize) {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        (state.friends.len(), state.roster_joins.len())
    }

    pub fn clear(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.friends.clear();
        state.roster_joins.clear();
        state.roster_location.clear();
    }
}

impl vrcx_0_contracts::InstanceRosterObserver for InstanceDwellRegistry {
    fn on_instance_roster(&self, snapshot: InstanceRosterSnapshot) {
        self.observe_roster(&snapshot);
    }

    fn on_game_running(&self, running: bool) {
        if !running {
            self.observe_roster(&InstanceRosterSnapshot::default());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vrcx_0_contracts::InstanceRosterMember;

    fn roster(location: &str, members: &[(&str, i64)]) -> InstanceRosterSnapshot {
        InstanceRosterSnapshot {
            location: location.to_string(),
            world_name: String::new(),
            destination: String::new(),
            entered_at: String::new(),
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

    fn friend(user_id: &str, state: &str, location: &str) -> FriendRecord {
        FriendRecord {
            id: user_id.to_string(),
            state: state.into(),
            location: location.to_string(),
            ..FriendRecord::default()
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

        let snapshot = registry.sync_friends(&friends, 5_000).unwrap();

        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].user_id, "usr_offline");
        assert_eq!(snapshot[0].since_ms, None);
        assert_eq!(snapshot[1].user_id, "usr_online");
        assert_eq!(snapshot[1].location, "wrld_a:1");
        assert_eq!(snapshot[1].since_ms, Some(5_000));

        assert_eq!(registry.sync_friends(&HashMap::new(), 6_000), Some(vec![]));
    }

    #[test]
    fn repeated_observation_in_the_same_instance_keeps_the_start() {
        let registry = InstanceDwellRegistry::new();
        let record = friend("usr_a", "online", "wrld_a:1");
        registry.observe_friend_record("usr_a", &record, 1_000);

        assert_eq!(
            registry.observe_friend_record("usr_a", &record, 8_000),
            None
        );
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
    }

    #[test]
    fn moving_to_another_instance_restarts_the_timer() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 1_000);
        let snapshot = registry
            .observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_b:2"), 7_000)
            .unwrap();

        assert_eq!(snapshot[0].location, "wrld_b:2");
        assert_eq!(snapshot[0].since_ms, Some(7_000));
    }

    #[test]
    fn traveling_arrival_restarts_the_timer_even_for_the_same_target() {
        let registry = InstanceDwellRegistry::new();
        let mut traveling = friend("usr_a", "online", "traveling");
        traveling.traveling_to_location = "wrld_a:1".to_string();
        registry.observe_friend_record("usr_a", &traveling, 1_000);
        assert_eq!(registry.snapshot()[0].location, "wrld_a:1");
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));

        let arrived = friend("usr_a", "online", "wrld_a:1");
        let snapshot = registry
            .observe_friend_record("usr_a", &arrived, 7_000)
            .unwrap();

        assert_eq!(snapshot[0].location, "wrld_a:1");
        assert_eq!(snapshot[0].since_ms, Some(7_000));
    }

    #[test]
    fn pending_offline_preserves_the_start_until_offline_is_confirmed() {
        let registry = InstanceDwellRegistry::new();
        let online = friend("usr_a", "online", "wrld_a:1");
        registry.observe_friend_record("usr_a", &online, 1_000);
        let mut pending = online.clone();
        pending
            .extra
            .insert("pendingOffline".into(), serde_json::Value::Bool(true));

        assert_eq!(
            registry.observe_friend_record("usr_a", &pending, 5_000),
            None
        );
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));

        assert_eq!(
            registry.observe_friend_record("usr_a", &online, 6_000),
            None
        );
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));

        let snapshot = registry
            .observe_friend_record("usr_a", &friend("usr_a", "offline", "offline"), 7_000)
            .unwrap();
        assert_eq!(snapshot[0].since_ms, None);
    }

    #[test]
    fn returning_online_restarts_even_when_the_location_is_unchanged() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 1_000);
        registry.observe_friend_record("usr_a", &friend("usr_a", "offline", "wrld_a:1"), 5_000);
        let snapshot = registry
            .observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 8_000)
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
        registry.sync_friends(&friends, 5_000);

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
    fn roster_only_moves_an_established_start_earlier() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 5_000);

        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 9_000)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
    }

    #[test]
    fn calibrated_start_survives_leaving_the_local_roster() {
        for next_roster in [roster("wrld_a:1", &[]), roster("wrld_b:2", &[])] {
            let registry = InstanceDwellRegistry::new();
            let record = friend("usr_a", "online", "wrld_a:1");
            registry.observe_friend_record("usr_a", &record, 5_000);
            registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

            registry.observe_roster(&next_roster);
            registry.observe_friend_record("usr_a", &record, 9_000);

            assert_eq!(registry.snapshot()[0].location, "wrld_a:1");
            assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
        }
    }

    #[test]
    fn calibrated_start_survives_game_exit() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 5_000);
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        vrcx_0_contracts::InstanceRosterObserver::on_game_running(&registry, false);
        registry.observe_roster(&InstanceRosterSnapshot::default());

        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
        assert_eq!(registry.tracked_count(), (1, 0));
    }

    #[test]
    fn existing_roster_calibrates_presence_updates_before_it_is_removed() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 5_000);
        let mut traveling = friend("usr_a", "online", "traveling");
        traveling.traveling_to_location = "wrld_a:1".into();
        registry.observe_friend_record("usr_a", &traveling, 7_000);
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 9_000);

        registry.observe_roster(&roster("wrld_a:1", &[]));

        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
    }

    #[test]
    fn calibrated_start_is_not_reused_after_a_friend_changes_instance() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 5_000);
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_b:2"), 9_000);
        registry.observe_roster(&roster("wrld_a:1", &[]));

        assert_eq!(registry.snapshot()[0].location, "wrld_b:2");
        assert_eq!(registry.snapshot()[0].since_ms, Some(9_000));
    }

    #[test]
    fn new_instance_roster_does_not_reuse_previous_instance_members() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_b:2"), 100_000);
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        registry.observe_roster(&roster("wrld_b:2", &[]));
        assert_eq!(registry.tracked_count(), (1, 0));
        assert_eq!(registry.snapshot()[0].since_ms, Some(100_000));

        registry.observe_roster(&roster("wrld_b:2", &[("usr_a", 100_500)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(100_000));
    }

    #[test]
    fn game_exit_discards_roster_members_before_the_next_instance() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_b:2"), 100_000);
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        vrcx_0_contracts::InstanceRosterObserver::on_game_running(&registry, false);
        assert_eq!(registry.tracked_count(), (1, 0));

        registry.observe_roster(&roster("wrld_b:2", &[]));
        registry.observe_roster(&roster("wrld_b:2", &[("usr_a", 100_500)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(100_000));
    }

    #[test]
    fn conflicting_remote_presence_is_not_overridden_by_local_roster() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record(
            "usr_remote",
            &friend("usr_remote", "online", "wrld_far:9"),
            3_000,
        );
        registry.observe_roster(&roster("wrld_a:1", &[("usr_remote", 1_000)]));

        assert_eq!(registry.snapshot()[0].location, "wrld_far:9");
        assert_eq!(registry.snapshot()[0].since_ms, Some(3_000));
    }

    #[test]
    fn forgetting_and_clearing_remove_tracked_friends() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 1_000);
        assert_eq!(registry.forget_friend("usr_a").unwrap(), []);

        registry.observe_friend_record("usr_b", &friend("usr_b", "online", "wrld_b:2"), 2_000);
        registry.clear();
        assert!(registry.snapshot().is_empty());
        assert_eq!(registry.tracked_count(), (0, 0));
    }

    #[test]
    fn baseline_reconnect_preserves_time_until_the_registry_is_cleared() {
        let registry = InstanceDwellRegistry::new();
        let friends = HashMap::from([("usr_a".to_string(), friend("usr_a", "online", "wrld_a:1"))]);

        registry.sync_friends(&friends, 1_000);
        assert_eq!(registry.sync_friends(&friends, 5_000), None);
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));

        registry.clear();
        let snapshot = registry.sync_friends(&friends, 8_000).unwrap();
        assert_eq!(snapshot[0].since_ms, Some(8_000));
    }
}
