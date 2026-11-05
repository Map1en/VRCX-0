use std::sync::Arc;

use vrcx_0_application::auth::VrchatConfigRuntime;
use vrcx_0_application::favorites::FavoriteDetailsRuntime;
use vrcx_0_application::game::InstanceLaunchRuntime;
use vrcx_0_application::remote::{VrchatApiRuntime, VrchatRemoteFacade, WorldRemoteRuntime};
use vrcx_0_application::social::{
    CurrentUserMutationRuntime, GroupMembershipBatchCoordinator, GroupModerationBatchCoordinator,
    QuickSearchRuntime, QuickSearchSources,
};
use vrcx_0_composition::RuntimeHostState;
use vrcx_0_outbound_adapters::{
    CachedWorldNameResolver, CachedWorldResponseProjection, LocalAvatarApplicationAdapter,
    LocalMediaUploadAdapter, LocalModerationSyncStore, LocalNotificationWebhookTransport,
    LocalPrintAdapter, LocalProfileBioStore, LocalQuickSearchDetailStore, PersistenceRealtimeStore,
    VrchatApiRemote, VrchatAvatarRemote, VrchatCurrentUserMutationRemote, VrchatFavoriteRemote,
    VrchatRequestAdapter, VrchatWorldRemote,
};

use crate::avatar::DesktopAvatarRuntime;
use crate::external_api::ExternalApiRuntime;
use crate::group::DesktopGroupRuntime;
use crate::instance_launch::{build_instance_launch_runtime, InstanceLaunchRuntimeDeps};
use crate::media::DesktopMediaRuntime;
use crate::social::DesktopSocialRuntime;
use crate::HostFileAccess;

pub(crate) struct RemoteRuntimes {
    pub(crate) current_user_mutations: CurrentUserMutationRuntime,
    pub(crate) avatars: DesktopAvatarRuntime,
    pub(crate) instance_launch: InstanceLaunchRuntime,
    pub(crate) external_api: ExternalApiRuntime,
    pub(crate) groups: DesktopGroupRuntime,
    pub(crate) social: DesktopSocialRuntime,
    pub(crate) media: DesktopMediaRuntime,
    pub(crate) vrchat_remote: VrchatRemoteFacade,
    pub(crate) worlds: WorldRemoteRuntime,
    pub(crate) vrchat_config: VrchatConfigRuntime,
    pub(crate) favorite_details: FavoriteDetailsRuntime,
    pub(crate) quick_search: QuickSearchRuntime,
    pub(crate) group_membership_batches: GroupMembershipBatchCoordinator,
    pub(crate) group_moderation_batches: GroupModerationBatchCoordinator,
    pub(crate) vrchat_requests: VrchatRequestAdapter,
    pub(crate) world_names: CachedWorldNameResolver,
    pub(crate) webhook_transport: LocalNotificationWebhookTransport,
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
    let current_user_mutations = CurrentUserMutationRuntime::new(
        context.auth_scope().clone(),
        Arc::clone(context.remote_mutations()),
        Arc::new(VrchatCurrentUserMutationRemote::new(
            Arc::clone(context.web_client()),
            context.diagnostics().clone(),
            context.sync().clone(),
            Arc::clone(runtime.realtime_runtime()),
        )),
    );
    let avatars = DesktopAvatarRuntime {
        application_adapter: LocalAvatarApplicationAdapter::new(Arc::clone(runtime.database())),
        remote: Arc::new(VrchatAvatarRemote::new(
            Arc::clone(runtime.web_client()),
            context.diagnostics().clone(),
            context.sync().clone(),
        )),
        realtime: Arc::clone(runtime.realtime_runtime()),
        avatar_cache: Arc::clone(context.avatar_cache()),
        avatar_moderation: context.avatar_moderation().clone(),
        auth_scope: context.auth_scope().clone(),
        remote_mutations: Arc::clone(context.remote_mutations()),
    };
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
    let social = DesktopSocialRuntime {
        db: Arc::clone(runtime.database()),
        realtime_store: Arc::new(PersistenceRealtimeStore::new(Arc::clone(
            runtime.database(),
        ))),
        media_upload_adapter: LocalMediaUploadAdapter::new(Arc::clone(runtime.web_client())),
        moderation_sync_store: LocalModerationSyncStore::new(Arc::clone(runtime.database())),
        web: Arc::clone(runtime.web_client()),
        remote: VrchatRequestAdapter::new(Arc::clone(runtime.web_client())),
        auth_scope: context.auth_scope().clone(),
        remote_mutations: Arc::clone(context.remote_mutations()),
        realtime: Arc::clone(runtime.realtime_runtime()),
        diagnostics: context.diagnostics().clone(),
        sync: context.sync().clone(),
        event_bus: context.event_bus().clone(),
        world_cache: Arc::clone(context.world_cache()),
        moderation_sync: context.moderation_sync().clone(),
        authenticated: runtime.authenticated_runtime().clone(),
    };
    let media_upload_adapter = Arc::new(LocalMediaUploadAdapter::new(Arc::clone(
        runtime.web_client(),
    )));
    let print_adapter = Arc::new(LocalPrintAdapter::new(
        Arc::clone(runtime.database()),
        Arc::clone(runtime.web_client()),
    ));
    let media = DesktopMediaRuntime {
        file_access: host_file_access.clone(),
        paths: runtime.paths().clone(),
        image_cache: Arc::clone(runtime.image_cache()),
        print_adapter: print_adapter.clone(),
        media_upload_adapter: media_upload_adapter.clone(),
        inventory_remote: VrchatRequestAdapter::new(Arc::clone(runtime.web_client())),
        auth_scope: context.auth_scope().clone(),
        remote_mutations: Arc::clone(context.remote_mutations()),
        diagnostics: context.diagnostics().clone(),
    };
    let vrchat_api = VrchatApiRuntime::new(
        context.auth_scope().clone(),
        Arc::clone(context.remote_mutations()),
        Arc::new(VrchatApiRemote::new(
            Arc::clone(context.web_client()),
            context.diagnostics().clone(),
            context.sync().clone(),
        )),
    );
    let worlds = WorldRemoteRuntime::new(
        context.auth_scope().clone(),
        Arc::clone(context.remote_mutations()),
        Arc::new(VrchatWorldRemote::new(
            Arc::clone(context.web_client()),
            context.diagnostics().clone(),
            context.sync().clone(),
        )),
        Arc::new(CachedWorldResponseProjection::new(Arc::clone(
            context.world_cache(),
        ))),
    );
    let vrchat_remote = VrchatRemoteFacade::new(
        vrchat_api.clone(),
        media_upload_adapter,
        print_adapter,
        Arc::new(LocalProfileBioStore::new(Arc::clone(runtime.database()))),
        Arc::clone(runtime.realtime_runtime()),
        context.auth_scope().clone(),
    );
    let vrchat_config = VrchatConfigRuntime::new(
        vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT.into(),
        Arc::new(vrcx_0_outbound_adapters::VrchatConfigAdapter::new(
            Arc::clone(runtime.web_client()),
            vrchat_api,
        )),
    );
    let favorite_details = FavoriteDetailsRuntime::new(
        Arc::new(VrchatFavoriteRemote::new(
            Arc::clone(runtime.web_client()),
            context.diagnostics().clone(),
            context.sync().clone(),
            Arc::clone(context.world_cache()),
        )),
        context.auth_scope().clone(),
        Arc::clone(context.world_cache()),
        Arc::clone(context.avatar_cache()),
        context.tasks().clone(),
    );
    let quick_search = QuickSearchRuntime::new(
        QuickSearchSources::new(
            Arc::new(LocalQuickSearchDetailStore::new(Arc::clone(
                runtime.database(),
            ))),
            Arc::new(LocalAvatarApplicationAdapter::new(Arc::clone(
                runtime.database(),
            ))),
            Arc::new(VrchatAvatarRemote::new(
                Arc::clone(runtime.web_client()),
                context.diagnostics().clone(),
                context.sync().clone(),
            )),
            Arc::clone(context.world_cache()),
        ),
        Arc::new(VrchatRequestAdapter::new(Arc::clone(runtime.web_client()))),
        context.auth_scope().clone(),
        context.diagnostics().clone(),
        context.sync().clone(),
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
        favorite_details,
        quick_search,
        group_membership_batches: GroupMembershipBatchCoordinator::default(),
        group_moderation_batches: GroupModerationBatchCoordinator::default(),
        vrchat_requests: VrchatRequestAdapter::new(Arc::clone(runtime.web_client())),
        world_names: CachedWorldNameResolver::new(Arc::clone(context.world_cache())),
        webhook_transport: LocalNotificationWebhookTransport::new(Arc::clone(runtime.web_client())),
    }
}
