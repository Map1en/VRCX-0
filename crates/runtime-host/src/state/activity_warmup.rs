use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

use vrcx_0_application::RuntimeAuthScope;

use super::RuntimeHostState;

const ACTIVITY_WARMUP_RANGE_DAYS: i64 = 365;

impl RuntimeHostState {
    pub(super) fn schedule_activity_warmup(&self, user_id: String, auth_generation: u64) {
        let auth_scope = self.runtime_context.auth_scope.clone();
        if !activity_warmup_scope_matches(&auth_scope, &user_id, auth_generation)
            || !claim_activity_warmup_generation(
                self.activity_warmup_generation.as_ref(),
                auth_generation,
            )
        {
            return;
        }
        let db = Arc::clone(&self.db);
        let scheduled_generation = Arc::clone(&self.activity_warmup_generation);
        self.runtime_context
            .tasks
            .spawn_thread("activity-session-warmup", move || {
                if !activity_warmup_scope_matches(&auth_scope, &user_id, auth_generation) {
                    release_activity_warmup_generation(
                        scheduled_generation.as_ref(),
                        auth_generation,
                    );
                    return;
                }
                match vrcx_0_persistence::activity::activity_self_sessions_warmup(
                    db.as_ref(),
                    user_id.clone(),
                    ACTIVITY_WARMUP_RANGE_DAYS,
                    None,
                ) {
                    Ok(output) => tracing::debug!(
                        user_id = %user_id,
                        cached_range_days = output.sync.cached_range_days,
                        source_count = output.source_count,
                        session_count = output.sessions.len(),
                        "activity session warmup completed"
                    ),
                    Err(error) => {
                        tracing::warn!(
                            user_id = %user_id,
                            error = %error,
                            "activity session warmup failed"
                        );
                        release_activity_warmup_generation(
                            scheduled_generation.as_ref(),
                            auth_generation,
                        );
                    }
                }
            });
    }
}

fn claim_activity_warmup_generation(scheduled: &AtomicU64, auth_generation: u64) -> bool {
    auth_generation > 0
        && scheduled
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                (current < auth_generation).then_some(auth_generation)
            })
            .is_ok()
}

fn release_activity_warmup_generation(scheduled: &AtomicU64, auth_generation: u64) {
    let _ = scheduled.compare_exchange(auth_generation, 0, Ordering::AcqRel, Ordering::Acquire);
}

fn activity_warmup_scope_matches(
    auth_scope: &RuntimeAuthScope,
    user_id: &str,
    auth_generation: u64,
) -> bool {
    let current = auth_scope.snapshot();
    current.active && current.current_user_id == user_id && current.generation == auth_generation
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warmup_generation_is_claimed_once_per_auth_scope() {
        let scheduled = AtomicU64::new(0);

        assert!(claim_activity_warmup_generation(&scheduled, 1));
        assert!(!claim_activity_warmup_generation(&scheduled, 1));
        assert!(claim_activity_warmup_generation(&scheduled, 2));
        assert!(!claim_activity_warmup_generation(&scheduled, 1));
        release_activity_warmup_generation(&scheduled, 1);
        assert_eq!(scheduled.load(Ordering::Acquire), 2);
    }

    #[test]
    fn warmup_scope_rejects_account_switches_and_cleared_auth() {
        let auth_scope = RuntimeAuthScope::new();
        let first = auth_scope.set("usr_first", "");
        assert!(activity_warmup_scope_matches(
            &auth_scope,
            "usr_first",
            first.generation
        ));

        auth_scope.set("usr_second", "");
        assert!(!activity_warmup_scope_matches(
            &auth_scope,
            "usr_first",
            first.generation
        ));

        let cleared = auth_scope.set("", "");
        assert!(!activity_warmup_scope_matches(
            &auth_scope,
            "",
            cleared.generation
        ));
    }
}
