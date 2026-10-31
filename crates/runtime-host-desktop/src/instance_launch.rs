use std::sync::Arc;
use std::time::Duration;

use vrcx_0_application::game::{
    InstanceLaunchApiFuture, InstanceLaunchHttpClient, InstanceLaunchPipe, InstanceLaunchRuntime,
};
use vrcx_0_application_core::vrchat_api::{
    execute_api_command, VrchatApiRequest, VrchatApiResponse, VrchatScope,
};
use vrcx_0_application_core::{
    is_remote_mutation_request, AuthenticatedMutationContext, RemoteMutationGate, RuntimeAuthScope,
    RuntimeDiagnostics, RuntimeSyncEngine, WebClient,
};
use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};
use vrcx_0_persistence::config as config_store;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::instances::{instance_self_invite_input, instance_short_name_get_input};

const INSTANCE_JOIN_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub(crate) struct InstanceLaunchRuntimeDeps {
    pub web: Arc<WebClient>,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
    pub auth_scope: RuntimeAuthScope,
    pub remote_mutations: Arc<RemoteMutationGate>,
    pub db: Arc<DatabaseService>,
}

pub(crate) fn build_instance_launch_runtime(
    deps: InstanceLaunchRuntimeDeps,
) -> InstanceLaunchRuntime {
    InstanceLaunchRuntime::new(
        Arc::new(DesktopInstanceLaunchHttpClient {
            web: deps.web,
            diagnostics: deps.diagnostics,
            sync: deps.sync,
            auth_scope: deps.auth_scope,
            remote_mutations: deps.remote_mutations,
        }),
        Arc::new(DesktopInstanceLaunchPipe { db: deps.db }),
    )
}

struct DesktopInstanceLaunchHttpClient {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
}

impl DesktopInstanceLaunchHttpClient {
    async fn execute_join_request(
        &self,
        command: &'static str,
        detail: &'static str,
        mut request: VrchatApiRequest,
    ) -> vrcx_0_application_core::Result<VrchatApiResponse> {
        if !is_remote_mutation_request(&request) {
            return execute_api_command(
                &self.web,
                &self.diagnostics,
                &self.sync,
                (command, detail),
                request,
                VrchatScope::Vrchat,
            )
            .await;
        }
        let mutation = AuthenticatedMutationContext::capture(
            &self.auth_scope,
            self.remote_mutations.as_ref(),
            "Instance launch mutation",
        )?;
        mutation.apply_scope_to_request(&mut request);
        mutation
            .run_after_wait(INSTANCE_JOIN_REMOTE_MUTATION_INTERVAL, || async {
                execute_api_command(
                    &self.web,
                    &self.diagnostics,
                    &self.sync,
                    (command, detail),
                    request,
                    VrchatScope::Vrchat,
                )
                .await
            })
            .await
    }
}

impl InstanceLaunchHttpClient for DesktopInstanceLaunchHttpClient {
    fn instance_short_name<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
    ) -> InstanceLaunchApiFuture<'a> {
        Box::pin(async move {
            let (_, _, request) = instance_short_name_get_input(
                endpoint.to_string(),
                world_id.to_string(),
                instance_id.to_string(),
                String::new(),
            )?;
            self.execute_join_request(
                "app__vrchat_instance_join.short_name",
                "Getting a short name for the instance launch.",
                request,
            )
            .await
        })
    }

    fn self_invite<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
        short_name: &'a str,
    ) -> InstanceLaunchApiFuture<'a> {
        Box::pin(async move {
            let (_, _, request) = instance_self_invite_input(
                endpoint.to_string(),
                world_id.to_string(),
                instance_id.to_string(),
                short_name.to_string(),
            )?;
            self.execute_join_request(
                "app__vrchat_instance_join.self_invite",
                "Sending a self invite for the instance launch.",
                request,
            )
            .await
        })
    }
}

struct DesktopInstanceLaunchPipe {
    db: Arc<DatabaseService>,
}

fn should_focus_game_window(db: &DatabaseService) -> bool {
    config_store::get_bool(db, "focusVrchatOnJoin", false).unwrap_or(false)
        && config_store::get_bool(db, vrcx_0_application_game::IS_GAME_NO_VR_CONFIG_KEY, false)
            .unwrap_or(false)
}

impl InstanceLaunchPipe for DesktopInstanceLaunchPipe {
    fn try_open_vrchat_launch_url(
        &self,
        launch_url: &str,
    ) -> vrcx_0_application_core::Result<bool> {
        require_host_capability(HostCapability::VrchatLaunchPipe)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()))?;
        let result = vrcx_0_host_desktop::vrchat_ipc::vrcipc_send_with_result(launch_url);
        if result.accepted && should_focus_game_window(&self.db) {
            vrcx_0_host_desktop::game_window::request_focus_vrchat_window(result.server_process_id);
        }
        Ok(result.accepted)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use vrcx_0_persistence::config as config_store;
    use vrcx_0_persistence::DatabaseService;

    use super::should_focus_game_window;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-instance-focus-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn database(dir: &TestDir) -> DatabaseService {
        DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap()
    }

    #[test]
    fn focus_stays_off_until_the_user_enables_it() {
        let dir = TestDir::new("default-off");
        let db = database(&dir);
        config_store::set_bool(&db, vrcx_0_application_game::IS_GAME_NO_VR_CONFIG_KEY, true)
            .unwrap();

        assert!(!should_focus_game_window(&db));
    }

    #[test]
    fn focus_is_enabled_for_desktop_mode() {
        let dir = TestDir::new("desktop-mode");
        let db = database(&dir);
        config_store::set_bool(&db, "focusVrchatOnJoin", true).unwrap();
        config_store::set_bool(&db, vrcx_0_application_game::IS_GAME_NO_VR_CONFIG_KEY, true)
            .unwrap();

        assert!(should_focus_game_window(&db));
    }

    #[test]
    fn focus_stays_off_for_vr_mode() {
        let dir = TestDir::new("vr-mode");
        let db = database(&dir);
        config_store::set_bool(&db, "focusVrchatOnJoin", true).unwrap();
        config_store::set_bool(
            &db,
            vrcx_0_application_game::IS_GAME_NO_VR_CONFIG_KEY,
            false,
        )
        .unwrap();

        assert!(!should_focus_game_window(&db));
    }
}
