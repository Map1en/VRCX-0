use std::collections::{HashMap, HashSet, VecDeque};

use super::decision::CooldownView;

const CLOSED_LOCATIONS_CAPACITY: usize = 512;
pub(crate) const INVITE_FAILURE_BACKOFF_MS: i64 = 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InviteOutcome {
    Sent,
    Skipped,
    Failed,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct InviteAutomationState {
    cooldowns: HashMap<String, i64>,
    pending: HashSet<String>,
    failure_backoff: HashMap<String, i64>,
    closed_locations: HashSet<String>,
    closed_order: VecDeque<String>,
}

impl InviteAutomationState {
    pub(crate) fn cooldown_view(&self, scope_key: &str) -> CooldownView {
        CooldownView {
            last_sent_at_ms: self.cooldowns.get(scope_key).copied(),
            is_pending: self.pending.contains(scope_key),
        }
    }

    pub(crate) fn is_in_failure_backoff(&self, scope_key: &str, now_ms: i64) -> bool {
        self.failure_backoff
            .get(scope_key)
            .is_some_and(|until_ms| now_ms < *until_ms)
    }

    pub(crate) fn begin(&mut self, scope_key: &str) {
        self.pending.insert(scope_key.to_string());
    }

    pub(crate) fn finish(&mut self, scope_key: &str, outcome: InviteOutcome, now_ms: i64) {
        self.pending.remove(scope_key);
        match outcome {
            InviteOutcome::Sent => {
                self.cooldowns.insert(scope_key.to_string(), now_ms);
                self.failure_backoff.remove(scope_key);
            }
            InviteOutcome::Failed => {
                self.failure_backoff
                    .insert(scope_key.to_string(), now_ms + INVITE_FAILURE_BACKOFF_MS);
            }
            InviteOutcome::Skipped => {}
        }
    }

    pub(crate) fn clear_all(&mut self) {
        self.cooldowns.clear();
        self.pending.clear();
        self.failure_backoff.clear();
        self.closed_locations.clear();
        self.closed_order.clear();
    }

    pub(crate) fn record_closed_location(&mut self, location: &str) {
        let location = location.trim();
        if location.is_empty() || !self.closed_locations.insert(location.to_string()) {
            return;
        }
        self.closed_order.push_back(location.to_string());
        if self.closed_order.len() > CLOSED_LOCATIONS_CAPACITY {
            if let Some(evicted) = self.closed_order.pop_front() {
                self.closed_locations.remove(&evicted);
            }
        }
    }

    pub(crate) fn closed_locations(&self) -> HashSet<String> {
        self.closed_locations.clone()
    }
}

pub(crate) fn sender_scope_key(
    endpoint: &str,
    current_user_id: &str,
    sender_user_id: &str,
) -> String {
    [
        endpoint.trim(),
        current_user_id.trim(),
        sender_user_id.trim(),
    ]
    .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_send_backs_off_then_clears_on_success() {
        let mut state = InviteAutomationState::default();
        let now = 1_000_000;

        state.begin("scope");
        state.finish("scope", InviteOutcome::Failed, now);
        assert!(state.is_in_failure_backoff("scope", now));
        assert!(state.is_in_failure_backoff("scope", now + INVITE_FAILURE_BACKOFF_MS - 1));
        assert!(!state.is_in_failure_backoff("scope", now + INVITE_FAILURE_BACKOFF_MS));

        state.begin("scope");
        state.finish(
            "scope",
            InviteOutcome::Sent,
            now + INVITE_FAILURE_BACKOFF_MS,
        );
        assert!(!state.is_in_failure_backoff("scope", now + INVITE_FAILURE_BACKOFF_MS));
        assert_eq!(
            state.cooldown_view("scope").last_sent_at_ms,
            Some(now + INVITE_FAILURE_BACKOFF_MS)
        );
    }

    #[test]
    fn skipped_outcome_sets_neither_cooldown_nor_backoff() {
        let mut state = InviteAutomationState::default();
        state.begin("scope");
        state.finish("scope", InviteOutcome::Skipped, 5_000);
        assert!(!state.cooldown_view("scope").is_pending);
        assert_eq!(state.cooldown_view("scope").last_sent_at_ms, None);
        assert!(!state.is_in_failure_backoff("scope", 5_000));
    }

    #[test]
    fn closed_locations_evict_oldest_beyond_capacity() {
        let mut state = InviteAutomationState::default();
        for index in 0..(CLOSED_LOCATIONS_CAPACITY + 10) {
            state.record_closed_location(&format!("loc_{index}"));
        }
        let closed = state.closed_locations();
        assert_eq!(closed.len(), CLOSED_LOCATIONS_CAPACITY);
        assert!(!closed.contains("loc_0"));
        assert!(closed.contains(&format!("loc_{}", CLOSED_LOCATIONS_CAPACITY + 9)));
    }
}
