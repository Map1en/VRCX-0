use futures_util::future::BoxFuture;

use std::sync::Arc;
use std::time::Duration;

use vrcx_0_application_core::{
    is_remote_mutation_request, AuthenticatedMutationContext, RemoteMutationGate, Result,
    RuntimeAuthScope,
};
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatResponse, VrchatScope};

const VRCHAT_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub type VrchatApiFuture<'a> = BoxFuture<'a, Result<VrchatResponse>>;
pub type VrchatRequestFuture<'a> = BoxFuture<'a, Result<VrchatResponse>>;

pub trait VrchatRequestPort: Send + Sync {
    fn send(&self, input: VrchatRequest, scope: VrchatScope) -> VrchatRequestFuture<'_>;
}

#[cfg(test)]
pub(crate) struct TestVrchatRequestPort;

#[cfg(test)]
impl VrchatRequestPort for TestVrchatRequestPort {
    fn send(&self, _input: VrchatRequest, _scope: VrchatScope) -> VrchatRequestFuture<'_> {
        Box::pin(async {
            Ok(VrchatResponse {
                status: 200,
                data: "{}".into(),
            })
        })
    }
}

pub trait VrchatApiPort: Send + Sync {
    fn execute(
        &self,
        command: String,
        detail: String,
        input: VrchatRequest,
        scope: VrchatScope,
    ) -> VrchatApiFuture<'_>;
}

#[derive(Clone)]
pub struct VrchatApiRuntime {
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
    port: Arc<dyn VrchatApiPort>,
}

impl VrchatApiRuntime {
    pub fn new(
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
        port: Arc<dyn VrchatApiPort>,
    ) -> Self {
        Self {
            auth_scope,
            remote_mutations,
            port,
        }
    }

    pub async fn execute(
        &self,
        command: impl Into<String>,
        detail: impl Into<String>,
        mut input: VrchatRequest,
        scope: VrchatScope,
    ) -> Result<VrchatResponse> {
        let command = command.into();
        let detail = detail.into();
        if !is_remote_mutation_request(&input) {
            return self.port.execute(command, detail, input, scope).await;
        }
        let mutation = AuthenticatedMutationContext::capture(
            &self.auth_scope,
            &self.remote_mutations,
            "VRChat mutation",
        )?;
        mutation.apply_scope_to_request(&mut input);
        mutation
            .run_after_wait(VRCHAT_REMOTE_MUTATION_INTERVAL, || {
                self.port.execute(command, detail, input, scope)
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct RecordingPort {
        requests: Mutex<Vec<VrchatRequest>>,
    }

    impl VrchatApiPort for RecordingPort {
        fn execute(
            &self,
            _command: String,
            _detail: String,
            input: VrchatRequest,
            _scope: VrchatScope,
        ) -> VrchatApiFuture<'_> {
            self.requests.lock().unwrap().push(input);
            Box::pin(async {
                Ok(VrchatResponse {
                    status: 200,
                    data: "{}".into(),
                })
            })
        }
    }

    #[tokio::test]
    async fn read_request_executes_without_an_authenticated_scope() {
        let port = Arc::new(RecordingPort::default());
        let runtime = VrchatApiRuntime::new(
            RuntimeAuthScope::new(),
            Arc::new(RemoteMutationGate::default()),
            port.clone(),
        );

        runtime
            .execute(
                "read",
                "read",
                VrchatRequest {
                    method: Some("GET".into()),
                    ..Default::default()
                },
                VrchatScope::Vrchat,
            )
            .await
            .unwrap();

        assert_eq!(port.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn mutation_rejects_before_the_port_when_scope_is_inactive() {
        let port = Arc::new(RecordingPort::default());
        let runtime = VrchatApiRuntime::new(
            RuntimeAuthScope::new(),
            Arc::new(RemoteMutationGate::default()),
            port.clone(),
        );

        let error = runtime
            .execute(
                "write",
                "write",
                VrchatRequest {
                    method: Some("POST".into()),
                    ..Default::default()
                },
                VrchatScope::Vrchat,
            )
            .await
            .unwrap_err();

        assert_eq!(
            error.to_string(),
            "VRChat mutation requires an authenticated session."
        );
        assert!(port.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn mutation_uses_the_captured_endpoint() {
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_current", "https://api.example.test/api/1");
        let port = Arc::new(RecordingPort::default());
        let runtime = VrchatApiRuntime::new(
            auth_scope,
            Arc::new(RemoteMutationGate::default()),
            port.clone(),
        );

        runtime
            .execute(
                "write",
                "write",
                VrchatRequest {
                    endpoint: Some("https://stale.example.test/api/1".into()),
                    method: Some("POST".into()),
                    ..Default::default()
                },
                VrchatScope::Vrchat,
            )
            .await
            .unwrap();

        assert_eq!(
            port.requests.lock().unwrap()[0].endpoint.as_deref(),
            Some("https://api.example.test/api/1")
        );
    }
}
