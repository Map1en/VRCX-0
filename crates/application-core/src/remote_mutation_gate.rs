use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use crate::{
    vrchat_api::VrchatApiRequest, Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot,
};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct RemoteMutationKey {
    current_user_id: String,
    endpoint: String,
}

type RemoteMutationSlot = Arc<AsyncMutex<Option<Instant>>>;

#[derive(Default)]
pub struct RemoteMutationGate {
    slots: Mutex<HashMap<RemoteMutationKey, RemoteMutationSlot>>,
}

impl RemoteMutationGate {
    pub async fn wait(&self, scope: &RuntimeAuthScopeSnapshot, interval: Duration) {
        if interval.is_zero() {
            return;
        }
        let key = RemoteMutationKey {
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

pub struct AuthenticatedMutationContext<'a> {
    auth_scope: &'a RuntimeAuthScope,
    expected_scope: RuntimeAuthScopeSnapshot,
    remote_mutation_gate: &'a RemoteMutationGate,
    label: &'static str,
}

impl<'a> AuthenticatedMutationContext<'a> {
    pub fn capture(
        auth_scope: &'a RuntimeAuthScope,
        remote_mutation_gate: &'a RemoteMutationGate,
        label: &'static str,
    ) -> Result<Self> {
        let expected_scope = auth_scope.snapshot();
        if !expected_scope.active || expected_scope.current_user_id.trim().is_empty() {
            return Err(Error::Custom(format!(
                "{label} requires an authenticated session."
            )));
        }
        Ok(Self {
            auth_scope,
            expected_scope,
            remote_mutation_gate,
            label,
        })
    }

    pub fn scope(&self) -> &RuntimeAuthScopeSnapshot {
        &self.expected_scope
    }

    pub fn is_current(&self) -> bool {
        self.auth_scope
            .snapshot()
            .generation_matches(&self.expected_scope)
    }

    pub fn ensure_current(&self) -> Result<()> {
        if self.is_current() {
            Ok(())
        } else {
            Err(Error::Custom(format!(
                "{} authentication scope changed.",
                self.label
            )))
        }
    }

    pub async fn pace(&self, interval: Duration) {
        self.remote_mutation_gate
            .wait(&self.expected_scope, interval)
            .await;
    }

    pub async fn wait_for_remote(&self, interval: Duration) -> Result<()> {
        self.ensure_current()?;
        self.pace(interval).await;
        self.ensure_current()
    }

    pub fn apply_scope_to_request(&self, request: &mut VrchatApiRequest) {
        if request.url.is_none() {
            request.endpoint = Some(self.expected_scope.endpoint.clone());
        }
    }

    pub async fn run_after_wait<T, F, Fut>(&self, interval: Duration, action: F) -> Result<T>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T>>,
    {
        self.wait_for_remote(interval).await?;
        let output = action().await?;
        self.ensure_current()?;
        Ok(output)
    }
}

pub fn is_remote_mutation_request(request: &VrchatApiRequest) -> bool {
    !matches!(
        request.method.as_deref().unwrap_or("GET").trim(),
        method if method.eq_ignore_ascii_case("GET")
            || method.eq_ignore_ascii_case("HEAD")
            || method.eq_ignore_ascii_case("OPTIONS")
    )
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

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

    #[test]
    fn authenticated_context_requires_an_active_scope() {
        let auth_scope = RuntimeAuthScope::new();
        let gate = RemoteMutationGate::default();

        let error = AuthenticatedMutationContext::capture(&auth_scope, &gate, "Favorite mutation")
            .err()
            .unwrap();

        assert_eq!(
            error.to_string(),
            "Favorite mutation requires an authenticated session."
        );
    }

    #[test]
    fn authenticated_context_rejects_a_replaced_scope() {
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_a", "https://api.vrchat.cloud/api/1");
        let gate = RemoteMutationGate::default();
        let context =
            AuthenticatedMutationContext::capture(&auth_scope, &gate, "Favorite mutation").unwrap();

        auth_scope.set("usr_b", "https://api.vrchat.cloud/api/1");

        assert_eq!(
            context.ensure_current().unwrap_err().to_string(),
            "Favorite mutation authentication scope changed."
        );
    }

    #[test]
    fn request_method_classification_keeps_reads_out_of_the_mutation_gate() {
        for method in [
            None,
            Some("GET"),
            Some("get"),
            Some("HEAD"),
            Some("OPTIONS"),
        ] {
            let request = VrchatApiRequest {
                method: method.map(str::to_string),
                ..Default::default()
            };
            assert!(!is_remote_mutation_request(&request));
        }

        for method in ["POST", "PUT", "PATCH", "DELETE"] {
            let request = VrchatApiRequest {
                method: Some(method.into()),
                ..Default::default()
            };
            assert!(is_remote_mutation_request(&request));
        }
    }

    #[test]
    fn authenticated_context_replaces_request_endpoint_with_captured_scope() {
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_a", "https://api.vrchat.cloud/api/1");
        let gate = RemoteMutationGate::default();
        let context =
            AuthenticatedMutationContext::capture(&auth_scope, &gate, "VRChat mutation").unwrap();
        let mut request = VrchatApiRequest {
            endpoint: Some("https://stale.example.test/api/1".into()),
            method: Some("POST".into()),
            ..Default::default()
        };

        context.apply_scope_to_request(&mut request);

        assert_eq!(
            request.endpoint.as_deref(),
            Some("https://api.vrchat.cloud/api/1")
        );
    }

    #[tokio::test]
    async fn action_observes_state_updated_while_waiting_for_the_remote_slot() {
        let auth_scope = RuntimeAuthScope::new();
        let expected = auth_scope.set("usr_a", "https://api.vrchat.cloud/api/1");
        let gate = RemoteMutationGate::default();
        let interval = Duration::from_millis(40);
        gate.wait(&expected, interval).await;
        let context =
            AuthenticatedMutationContext::capture(&auth_scope, &gate, "Avatar mutation").unwrap();
        let sequence = Arc::new(AtomicUsize::new(1));
        let updated_sequence = Arc::clone(&sequence);
        let update = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            updated_sequence.store(2, Ordering::SeqCst);
        });

        let observed = context
            .run_after_wait(interval, || async { Ok(sequence.load(Ordering::SeqCst)) })
            .await
            .unwrap();
        update.await.unwrap();

        assert_eq!(observed, 2);
    }
}
