//! Friend roster state owned by the host realtime runtime.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use vrcx_0_domain::friends::{FriendRecord, FriendRosterBaseline};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeFriendSnapshot {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub generation: u64,
    pub friends_by_id: HashMap<String, FriendRecord>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendBaselineResult {
    pub accepted: bool,
    pub generation: u64,
    pub friend_count: usize,
}

#[derive(Clone, Debug, Default)]
struct RealtimeFriendState {
    generation: u64,
    baseline: Option<RealtimeFriendSnapshot>,
}

#[derive(Clone, Debug, Default)]
pub struct RealtimeFriendsRuntime {
    state: Arc<Mutex<RealtimeFriendState>>,
}

impl RealtimeFriendsRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_baseline(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
    ) -> FriendBaselineResult {
        let baseline = baseline.normalized();
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        let generation = state.generation.max(realtime_generation);
        state.generation = generation;
        let friend_count = baseline.friends_by_id.len();
        state.baseline = Some(RealtimeFriendSnapshot {
            current_user_id: baseline.current_user_id,
            endpoint: baseline.endpoint,
            websocket: baseline.websocket,
            generation,
            friends_by_id: baseline.friends_by_id,
        });

        FriendBaselineResult {
            accepted: true,
            generation,
            friend_count,
        }
    }

    pub fn clear(&self) -> u64 {
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        state.baseline = None;
        state.generation
    }

    pub fn snapshot(&self) -> Option<RealtimeFriendSnapshot> {
        self.lock_state().baseline.clone()
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, RealtimeFriendState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use vrcx_0_domain::friends::{FriendRecord, FriendRosterBaseline};

    use super::RealtimeFriendsRuntime;

    #[test]
    fn stores_normalized_friend_baseline() {
        let runtime = RealtimeFriendsRuntime::new();
        let result = runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: " usr_self ".into(),
                endpoint: " https://api.example.test ".into(),
                websocket: " wss://ws.example.test ".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        display_name: "Friend".into(),
                        state: "active".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
            },
            7,
        );

        assert!(result.accepted);
        assert_eq!(result.friend_count, 1);
        assert_eq!(result.generation, 7);
        let snapshot = runtime.snapshot().unwrap();
        assert_eq!(snapshot.current_user_id, "usr_self");
        assert_eq!(snapshot.generation, 7);
        assert_eq!(
            snapshot
                .friends_by_id
                .get("usr_friend")
                .unwrap()
                .state_bucket,
            "active"
        );
    }

    #[test]
    fn clear_drops_baseline() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(FriendRosterBaseline::default(), 7);

        let generation = runtime.clear();

        assert!(generation > 7);
        assert!(runtime.snapshot().is_none());
    }
}
