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
    pub source: FriendLocationTimeSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FriendLocationTimeSource {
    GameLog,
    Realtime,
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
struct LocalInstanceRoster {
    location: String,
    joins: HashMap<String, i64>,
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
    state.friends.insert(user_id.to_string(), next);
}

fn projected_friend(
    state: &InstanceDwellState,
    user_id: &str,
    entry: &FriendLocationEntry,
) -> FriendLocationTime {
    if let Some(&joined_at_ms) = state.local_roster.joins.get(user_id) {
        return FriendLocationTime {
            user_id: user_id.to_string(),
            location: state.local_roster.location.clone(),
            since_ms: Some(joined_at_ms),
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
        let changed = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            let previous = snapshot_locked(&state);
            let mut next = LocalInstanceRoster::default();
            if state.game_running != Some(false)
                && parse_location(&snapshot.location).is_real_instance
            {
                next.location = normalized(&snapshot.location).to_string();
                for member in &snapshot.members {
                    let user_id = normalized(&member.user_id);
                    let Some(joined_at_ms) = member.joined_at_ms.filter(|value| *value > 0) else {
                        continue;
                    };
                    if !user_id.is_empty() {
                        next.joins.insert(user_id.to_string(), joined_at_ms);
                    }
                }
            }
            if state.game_running != Some(false) && !snapshot.departed_user_ids.is_empty() {
                let observed_ms = chrono::Utc::now().timestamp_millis();
                for user_id in &snapshot.departed_user_ids {
                    if let Some(entry) = state.friends.get_mut(normalized(user_id)) {
                        entry.since_ms = entry.since_ms.map(|_| observed_ms);
                    }
                }
            }
            state.local_roster = next;
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

    fn roster(location: &str, members: &[(&str, i64)]) -> InstanceRosterSnapshot {
        InstanceRosterSnapshot {
            location: location.to_string(),
            world_name: String::new(),
            destination: String::new(),
            entered_at: String::new(),
            departed_user_ids: Vec::new(),
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
    fn local_mode_ignores_remote_location_and_state_changes() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 500);
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        for record in [
            friend("usr_a", "online", "traveling"),
            friend("usr_a", "offline", "offline"),
            friend("usr_a", "online", "wrld_b:2"),
        ] {
            registry.observe_friend_record("usr_a", &record, 18_001_000);
            let snapshot = registry.snapshot();
            assert_eq!(snapshot[0].location, "wrld_a:1");
            assert_eq!(snapshot[0].since_ms, Some(1_000));
        }
    }

    #[test]
    fn local_mode_friend_leave_restarts_remote_time_without_another_ws_event() {
        let registry = InstanceDwellRegistry::new();
        let record = friend("usr_a", "online", "wrld_a:1");
        registry.observe_friend_record("usr_a", &record, 500);
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));
        let before_leave = chrono::Utc::now().timestamp_millis();

        registry.observe_roster(&InstanceRosterSnapshot {
            departed_user_ids: vec!["usr_a".into()],
            ..roster("wrld_a:1", &[])
        });

        let restarted_at = registry.snapshot()[0].since_ms.unwrap();
        assert!(restarted_at >= before_leave);
        assert!(restarted_at <= chrono::Utc::now().timestamp_millis());
        registry.observe_friend_record("usr_a", &record, restarted_at + 5_000);
        assert_eq!(registry.snapshot()[0].since_ms, Some(restarted_at));
        registry.observe_friend_record(
            "usr_a",
            &friend("usr_a", "online", "wrld_b:2"),
            restarted_at + 8_000,
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
            registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 5_000);
            registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

            registry.observe_roster(&next);

            assert_eq!(registry.snapshot()[0].location, "wrld_a:1");
            assert_eq!(registry.snapshot()[0].since_ms, Some(5_000));
        }
    }

    #[test]
    fn local_mode_new_join_replaces_the_previous_visit_even_in_one_snapshot() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 500);
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 20_000)]));

        assert_eq!(registry.snapshot()[0].since_ms, Some(20_000));
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
    fn local_roster_replaces_the_start_with_the_current_join() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 5_000);

        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 9_000)]));
        assert_eq!(registry.snapshot()[0].since_ms, Some(9_000));
    }

    #[test]
    fn game_exit_restores_remote_time_and_rejects_stale_local_rosters() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 5_000);
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
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 5_000);
        let mut traveling = friend("usr_a", "online", "traveling");
        traveling.traveling_to_location = "wrld_a:1".into();
        registry.observe_friend_record("usr_a", &traveling, 7_000);
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 9_000);

        registry.observe_roster(&InstanceRosterSnapshot::default());

        assert_eq!(registry.snapshot()[0].since_ms, Some(9_000));
    }

    #[test]
    fn friend_leaving_restarts_the_latest_remote_instance_time() {
        let registry = InstanceDwellRegistry::new();
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_a:1"), 5_000);
        registry.observe_roster(&roster("wrld_a:1", &[("usr_a", 1_000)]));

        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_b:2"), 9_000);
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
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_b:2"), 100_000);
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
        registry.observe_friend_record("usr_a", &friend("usr_a", "online", "wrld_b:2"), 100_000);
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
            registry.observe_friend_record(
                user_id,
                &friend(user_id, "online", "wrld_friends:1"),
                observed_ms,
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
        registry.observe_friend_record(
            "usr_remote",
            &friend("usr_remote", "online", "wrld_far:9"),
            3_000,
        );
        registry.observe_roster(&roster("wrld_a:1", &[("usr_remote", 1_000)]));

        assert_eq!(registry.snapshot()[0].location, "wrld_a:1");
        assert_eq!(registry.snapshot()[0].since_ms, Some(1_000));
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
