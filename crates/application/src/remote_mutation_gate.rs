use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use tokio::sync::Mutex as AsyncMutex;
use vrcx_0_application_core::RuntimeAuthScopeSnapshot;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct RemoteMutationScope {
    current_user_id: String,
    endpoint: String,
}

type RemoteMutationSlot = Arc<AsyncMutex<Option<Instant>>>;

#[derive(Default)]
pub struct RemoteMutationGate {
    slots: Mutex<HashMap<RemoteMutationScope, RemoteMutationSlot>>,
}

impl RemoteMutationGate {
    pub async fn wait(&self, scope: &RuntimeAuthScopeSnapshot, interval: Duration) {
        if interval.is_zero() {
            return;
        }
        let key = RemoteMutationScope {
            current_user_id: scope.current_user_id.clone(),
            endpoint: scope.endpoint.clone(),
        };
        let slot = {
            let mut slots = self
                .slots
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            Arc::clone(
                slots
                    .entry(key)
                    .or_insert_with(|| Arc::new(AsyncMutex::new(None))),
            )
        };
        let mut last_started = slot.lock().await;
        if let Some(started) = *last_started {
            let remaining = interval.saturating_sub(started.elapsed());
            if !remaining.is_zero() {
                tokio::time::sleep(remaining).await;
            }
        }
        *last_started = Some(Instant::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(user_id: &str, endpoint: &str, generation: u64) -> RuntimeAuthScopeSnapshot {
        RuntimeAuthScopeSnapshot {
            current_user_id: user_id.into(),
            endpoint: endpoint.into(),
            generation,
            active: true,
        }
    }

    #[tokio::test]
    async fn serializes_starts_for_the_same_account_across_auth_generations() {
        let gate = RemoteMutationGate::default();
        let interval = Duration::from_millis(100);
        gate.wait(&scope("usr_self", "https://api.vrchat.cloud", 1), interval)
            .await;

        assert!(tokio::time::timeout(
            Duration::from_millis(10),
            gate.wait(&scope("usr_self", "https://api.vrchat.cloud", 2), interval),
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn does_not_serialize_different_accounts() {
        let gate = RemoteMutationGate::default();
        let interval = Duration::from_millis(100);
        gate.wait(&scope("usr_a", "https://api.vrchat.cloud", 1), interval)
            .await;

        tokio::time::timeout(
            Duration::from_millis(10),
            gate.wait(&scope("usr_b", "https://api.vrchat.cloud", 1), interval),
        )
        .await
        .expect("different accounts should have independent mutation slots");
    }
}
