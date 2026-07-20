use serde_json::json;

use super::state::{FriendOwnerGuard, PendingFriendBaseline};
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyntheticFriendEventOutcome {
    Applied,
    PersistFailed,
    MissingBaseline,
    Ignored,
}

impl RealtimeHostRuntime {
    pub fn emit_runtime_vrchat_auth_failure(&self, payload: RuntimeVrchatAuthFailurePayload) {
        self.deps
            .event_bus
            .emit_runtime_vrchat_auth_failure(payload);
    }

    pub fn run_scoped_friend_log_removal<T, E>(
        &self,
        owner_user_id: &str,
        endpoint: &str,
        target_user_id: &str,
        mutation: impl FnOnce() -> std::result::Result<T, E>,
    ) -> std::result::Result<T, E> {
        let target_user_id = target_user_id.trim().to_string();
        self.run_scoped_friend_log_mutation(owner_user_id, endpoint, mutation, move |pending| {
            pending.friends_by_id.remove(&target_user_id);
            pending
                .projection
                .patches
                .retain(|patch| patch.user_id != target_user_id);
            if !pending
                .projection
                .removals
                .iter()
                .any(|user_id| user_id == &target_user_id)
            {
                pending.projection.removals.push(target_user_id);
            }
            pending.projection.friend_log_changed = true;
        })
    }

    pub fn run_scoped_friend_log_upsert<T, E>(
        &self,
        owner_user_id: &str,
        endpoint: &str,
        record: FriendRecord,
        mutation: impl FnOnce() -> std::result::Result<T, E>,
    ) -> std::result::Result<T, E> {
        self.run_scoped_friend_log_mutation(owner_user_id, endpoint, mutation, move |pending| {
            let user_id = record.id.clone();
            let state_bucket = record.state_bucket.clone();
            let patch = match serde_json::to_value(&record) {
                Ok(patch) => patch,
                Err(error) => {
                    tracing::warn!(
                        user_id,
                        error = %error,
                        "failed to serialize pending friend mutation projection"
                    );
                    return;
                }
            };
            pending.friends_by_id.insert(user_id.clone(), record);
            pending
                .projection
                .removals
                .retain(|removed_user_id| removed_user_id != &user_id);
            pending
                .projection
                .patches
                .retain(|existing| existing.user_id != user_id);
            pending
                .projection
                .patches
                .push(crate::realtime::FriendProjectionPatch {
                    user_id,
                    patch,
                    state_bucket,
                    state_bucket_authority: Some("explicit".to_string()),
                });
            pending.projection.friend_log_changed = true;
        })
    }

    fn run_scoped_friend_log_mutation<T, E>(
        &self,
        owner_user_id: &str,
        endpoint: &str,
        mutation: impl FnOnce() -> std::result::Result<T, E>,
        update_pending: impl FnOnce(&mut PendingFriendBaseline),
    ) -> std::result::Result<T, E> {
        let owner_user_id = owner_user_id.trim().to_string();
        let endpoint = normalize_vrchat_api_endpoint(Some(endpoint));
        self.run_friend_log_current_mutation_with_state(mutation, move |baseline| {
            let Some(pending) = baseline.pending.as_mut() else {
                return;
            };
            if pending.session.user_id.trim() == owner_user_id
                && normalize_vrchat_api_endpoint(Some(&pending.session.endpoint)) == endpoint
            {
                update_pending(pending);
            }
        })
    }

    pub fn apply_synthetic_friend_event(
        self: &Arc<Self>,
        expected_owner_user_id: &str,
        expected_endpoint: &str,
        message_type: &str,
        content: Value,
        received_at: String,
    ) -> SyntheticFriendEventOutcome {
        let owner = self.lock_friend_owner();
        self.apply_synthetic_friend_event_with_owner(
            &owner,
            expected_owner_user_id,
            expected_endpoint,
            message_type,
            content,
            received_at,
            false,
        )
    }

    pub fn apply_synthetic_trusted_friend_add(
        self: &Arc<Self>,
        expected_owner_user_id: &str,
        expected_endpoint: &str,
        content: Value,
        received_at: String,
    ) -> SyntheticFriendEventOutcome {
        let owner = self.lock_friend_owner();
        self.apply_synthetic_friend_event_with_owner(
            &owner,
            expected_owner_user_id,
            expected_endpoint,
            "friend-add",
            content,
            received_at,
            true,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn apply_synthetic_friend_event_if_sequence(
        self: &Arc<Self>,
        expected_owner_user_id: &str,
        expected_endpoint: &str,
        expected_generation: u64,
        user_id: &str,
        expected_sequence: Option<u64>,
        message_type: &str,
        content: Value,
        received_at: String,
        trust_friend_add_profile_state: bool,
    ) -> SyntheticFriendEventOutcome {
        let owner = self.lock_friend_owner();
        let current_generation = self.state.lock().ok().and_then(|state| {
            state
                .connection
                .active_context
                .as_ref()
                .map(|active| active.generation)
        });
        if current_generation != Some(expected_generation) {
            return SyntheticFriendEventOutcome::MissingBaseline;
        }
        if self
            .friends
            .friend_state_sequence_for_user(expected_generation, user_id)
            != expected_sequence
        {
            return SyntheticFriendEventOutcome::Ignored;
        }
        self.apply_synthetic_friend_event_with_owner(
            &owner,
            expected_owner_user_id,
            expected_endpoint,
            message_type,
            content,
            received_at,
            trust_friend_add_profile_state,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_synthetic_friend_event_with_owner(
        self: &Arc<Self>,
        owner: &FriendOwnerGuard<'_>,
        expected_owner_user_id: &str,
        expected_endpoint: &str,
        message_type: &str,
        content: Value,
        received_at: String,
        trust_friend_add_profile_state: bool,
    ) -> SyntheticFriendEventOutcome {
        let payload = RealtimeWsMessagePayload {
            json: json!({
                "type": message_type,
                "content": content,
            }),
            raw: String::new(),
            received_at,
        };
        match self.friends.apply_scoped_synthetic_message(
            expected_owner_user_id,
            expected_endpoint,
            &payload,
            trust_friend_add_profile_state,
        ) {
            RealtimeFriendApplyResult::Output(output) => {
                if self.apply_friend_output_owned(owner, *output) {
                    SyntheticFriendEventOutcome::Applied
                } else {
                    SyntheticFriendEventOutcome::PersistFailed
                }
            }
            RealtimeFriendApplyResult::MissingBaseline => {
                SyntheticFriendEventOutcome::MissingBaseline
            }
            RealtimeFriendApplyResult::Ignored => SyntheticFriendEventOutcome::Ignored,
        }
    }
}
