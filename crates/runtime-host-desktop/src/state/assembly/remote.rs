use std::sync::Arc;

use vrcx_0_application::auth::VrchatConfigRuntime;
use vrcx_0_application::game::InstanceLaunchRuntime;
use vrcx_0_application::remote::WorldRemoteRuntime;
use vrcx_0_application::social::CurrentUserMutationRuntime;
use vrcx_0_composition::RuntimeHostState;

use crate::avatar::DesktopAvatarRuntime;
use crate::current_user_mutation::{
    build_current_user_mutation_runtime, CurrentUserMutationRuntimeDeps,
};
use crate::external_api::ExternalApiRuntime;
use crate::group::DesktopGroupRuntime;
use crate::instance_launch::{build_instance_launch_runtime, InstanceLaunchRuntimeDeps};
use crate::media::DesktopMediaRuntime;
use crate::profile_bio::ProfileBioObserver;
use crate::social::DesktopSocialRuntime;
use crate::vrchat_api::{build_vrchat_api_runtime, VrchatApiRuntimeDeps};
use crate::vrchat_remote::DesktopVrchatRemoteFacade;
use crate::world_remote::{build_world_remote_runtime, WorldRemoteRuntimeDeps};
use crate::HostFileAccess;

pub(crate) struct RemoteRuntimes {
    pub(crate) current_user_mutations: CurrentUserMutationRuntime,
    pub(crate) avatars: DesktopAvatarRuntime,
    pub(crate) instance_launch: InstanceLaunchRuntime,
    pub(crate) external_api: ExternalApiRuntime,
    pub(crate) groups: DesktopGroupRuntime,
    pub(crate) social: DesktopSocialRuntime,
    pub(crate) media: DesktopMediaRuntime,
    pub(crate) vrchat_remote: DesktopVrchatRemoteFacade,
    pub(crate) worlds: WorldRemoteRuntime,
    pub(crate) vrchat_config: VrchatConfigRuntime,
}

pub(crate) fn build_remote_runtimes(
    runtime: &RuntimeHostState,
    host_file_access: &HostFileAccess,
) -> RemoteRuntimes {
    let context = runtime.desktop_assembly();
    let instance_launch = build_instance_launch_runtime(InstanceLaunchRuntimeDeps {
        web: Arc::clone(context.web_client()),
        diagnostics: context.diagnostics().clone(),
        sync: context.sync().clone(),
        auth_scope: context.auth_scope().clone(),
        remote_mutations: Arc::clone(context.remote_mutations()),
        db: Arc::clone(context.database()),
    });
    let current_user_mutations =
        build_current_user_mutation_runtime(CurrentUserMutationRuntimeDeps {
            auth_scope: context.auth_scope().clone(),
            remote_mutations: Arc::clone(context.remote_mutations()),
            web: Arc::clone(context.web_client()),
            diagnostics: context.diagnostics().clone(),
            sync: context.sync().clone(),
            realtime_runtime: Arc::clone(runtime.realtime_runtime()),
        });
    let avatars = DesktopAvatarRuntime::new(
        Arc::clone(runtime.database()),
        Arc::clone(runtime.web_client()),
        context.diagnostics().clone(),
        context.sync().clone(),
        Arc::clone(runtime.realtime_runtime()),
        Arc::clone(context.avatar_cache()),
        context.avatar_moderation().clone(),
        context.auth_scope().clone(),
        Arc::clone(context.remote_mutations()),
    );
    let external_api = ExternalApiRuntime::new(
        Arc::clone(runtime.web_client()),
        context.diagnostics().clone(),
        context.sync().clone(),
    );
    let groups = DesktopGroupRuntime::new(
        Arc::clone(runtime.web_client()),
        context.diagnostics().clone(),
        context.sync().clone(),
        context.auth_scope().clone(),
        Arc::clone(context.remote_mutations()),
    );
    let social = DesktopSocialRuntime::new(
        Arc::clone(runtime.database()),
        Arc::clone(runtime.web_client()),
        context.auth_scope().clone(),
        Arc::clone(context.remote_mutations()),
        Arc::clone(runtime.realtime_runtime()),
        context.diagnostics().clone(),
        context.sync().clone(),
        context.event_bus().clone(),
        Arc::clone(context.world_cache()),
        context.moderation_sync().clone(),
        runtime.authenticated_runtime().clone(),
    );
    let media = DesktopMediaRuntime::new(
        host_file_access.clone(),
        runtime.paths().clone(),
        Arc::clone(runtime.image_cache()),
        Arc::clone(runtime.database()),
        Arc::clone(runtime.web_client()),
        context.auth_scope().clone(),
        Arc::clone(context.remote_mutations()),
        context.diagnostics().clone(),
    );
    let vrchat_api = build_vrchat_api_runtime(VrchatApiRuntimeDeps {
        auth_scope: context.auth_scope().clone(),
        remote_mutations: Arc::clone(context.remote_mutations()),
        web: Arc::clone(context.web_client()),
        diagnostics: context.diagnostics().clone(),
        sync: context.sync().clone(),
    });
    let worlds = build_world_remote_runtime(WorldRemoteRuntimeDeps {
        auth_scope: context.auth_scope().clone(),
        remote_mutations: Arc::clone(context.remote_mutations()),
        web: Arc::clone(context.web_client()),
        diagnostics: context.diagnostics().clone(),
        sync: context.sync().clone(),
        world_cache: Arc::clone(context.world_cache()),
    });
    let vrchat_remote = DesktopVrchatRemoteFacade::new(
        vrchat_api.clone(),
        media.clone(),
        ProfileBioObserver::new(
            Arc::clone(runtime.database()),
            Arc::clone(runtime.realtime_runtime()),
            context.auth_scope().clone(),
        ),
    );
    let vrchat_config = VrchatConfigRuntime::new(
        vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT.into(),
        Arc::new(vrcx_0_outbound_adapters::VrchatConfigAdapter::new(
            Arc::clone(runtime.web_client()),
            vrchat_api,
        )),
    );
    RemoteRuntimes {
        current_user_mutations,
        avatars,
        instance_launch,
        external_api,
        groups,
        social,
        media,
        vrchat_remote,
        worlds,
        vrchat_config,
    }
}
