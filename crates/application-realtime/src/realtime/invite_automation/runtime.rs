use std::collections::{HashMap, HashSet, VecDeque};

use super::decision::DeliveryView;

const CLOSED_LOCATIONS_CAPACITY: usize = 512;
const NOTIFICATION_DELIVERY_CAPACITY: usize = 4_096;
pub(crate) const INVITE_FAILURE_BACKOFF_MS: i64 = 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InviteOutcome {
    Sent,
    Skipped,
    Failed,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct InviteAutomationState {
    pending: HashSet<String>,
    processed: HashSet<String>,
    processed_order: VecDeque<String>,
    failure_backoff: HashMap<String, i64>,
    failure_order: VecDeque<String>,
    closed_locations: HashSet<String>,
    closed_order: VecDeque<String>,
}

impl InviteAutomationState {
    pub(crate) fn delivery_view(&self, scope_key: &str, now_ms: i64) -> DeliveryView {
        DeliveryView {
            is_pending: self.pending.contains(scope_key),
            is_processed: self.processed.contains(scope_key),
            in_failure_backoff: self.is_in_failure_backoff(scope_key, now_ms),
        }
    }

    fn is_in_failure_backoff(&self, scope_key: &str, now_ms: i64) -> bool {
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
                self.record_processed(scope_key);
                self.failure_backoff.remove(scope_key);
            }
            InviteOutcome::Failed => {
                if !self.failure_backoff.contains_key(scope_key) {
                    self.failure_order.push_back(scope_key.to_string());
                }
                self.failure_backoff
                    .insert(scope_key.to_string(), now_ms + INVITE_FAILURE_BACKOFF_MS);
                while self.failure_backoff.len() > NOTIFICATION_DELIVERY_CAPACITY {
                    let Some(evicted) = self.failure_order.pop_front() else {
                        break;
                    };
                    self.failure_backoff.remove(&evicted);
                }
            }
            InviteOutcome::Skipped => {}
        }
    }

    pub(crate) fn clear_all(&mut self) {
        self.pending.clear();
        self.processed.clear();
        self.processed_order.clear();
        self.failure_backoff.clear();
        self.failure_order.clear();
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

    fn record_processed(&mut self, scope_key: &str) {
        if !self.processed.insert(scope_key.to_string()) {
            return;
        }
        self.processed_order.push_back(scope_key.to_string());
        if self.processed_order.len() > NOTIFICATION_DELIVERY_CAPACITY {
            if let Some(evicted) = self.processed_order.pop_front() {
                self.processed.remove(&evicted);
            }
        }
    }
}

pub(crate) fn notification_scope_key(
    endpoint: &str,
    current_user_id: &str,
    notification_id: &str,
) -> String {
    [
        endpoint.trim(),
        current_user_id.trim(),
        notification_id.trim(),
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
        assert!(
            state
                .delivery_view("scope", now + INVITE_FAILURE_BACKOFF_MS)
                .is_processed
        );
    }

    #[test]
    fn skipped_outcome_sets_neither_processed_nor_backoff() {
        let mut state = InviteAutomationState::default();
        state.begin("scope");
        state.finish("scope", InviteOutcome::Skipped, 5_000);
        let view = state.delivery_view("scope", 5_000);
        assert!(!view.is_pending);
        assert!(!view.is_processed);
        assert!(!view.in_failure_backoff);
    }

    #[test]
    fn notification_ids_are_independent_even_for_the_same_sender() {
        let first = notification_scope_key("https://api.vrchat.cloud", "usr_self", "not_1");
        let second = notification_scope_key("https://api.vrchat.cloud", "usr_self", "not_2");
        assert_ne!(first, second);

        let mut state = InviteAutomationState::default();
        state.begin(&first);
        state.finish(&first, InviteOutcome::Sent, 1_000);
        assert!(state.delivery_view(&first, 1_000).is_processed);
        assert!(!state.delivery_view(&second, 1_000).is_processed);
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
