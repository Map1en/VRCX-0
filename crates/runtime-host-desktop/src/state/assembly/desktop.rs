use std::sync::Arc;

use tokio::sync::broadcast;
use vrcx_0_application::profile::{
    AppUpdateBuildInfo, AppUpdateRuntime, AppUpdateRuntimeDeps, BackgroundImageService,
    CommunityThemeService, ProfileConfigStore,
};
use vrcx_0_application::telemetry::{TelemetryRuntime, TelemetryRuntimeDeps};
use vrcx_0_application_core::{BackendRuntimeStatusPublisher, UpdaterPort};
use vrcx_0_composition::{Result, RuntimeHostState, RuntimeHostStateBuilder};
use vrcx_0_contracts::InstanceRosterObserver;
use vrcx_0_host_desktop::discord_rpc::DiscordRpc;
use vrcx_0_integration_api::{
    integration_api_publisher_channel, IntegrationApiConfigStore, IntegrationApiController,
    IntegrationApiInputReceiver,
};

use crate::background_image::HostBackgroundImageFileResolver;
use crate::desktop_widget::DesktopWidget;
use crate::feed_logger::DesktopFeedLoggerRuntime;
use crate::integration_api::{
    start_integration_api_input_task, DesktopIntegrationApiConfigStore,
    DesktopIntegrationApiRuntime, IntegrationApiEnrichmentRequest,
};
use crate::log_watcher::{CurrentUserLocalPresenceObserver, HostInstanceRosterFanout};
use crate::state::{
    build_desktop_runtime_services_deps, register_desktop_file_access_grants, DesktopRuntimeBundle,
};
use crate::vr_overlay::DesktopVrOverlayRuntime;
use crate::{DesktopRuntimeServices, HostFileAccess};

pub(crate) struct DesktopWiring {
    pub(crate) host_file_access: HostFileAccess,
    pub(crate) services: Arc<DesktopRuntimeServices>,
    pub(crate) backend_status: BackendRuntimeStatusPublisher,
    pub(crate) profile_config: Arc<dyn ProfileConfigStore>,
    pub(crate) game_roster_observer: Arc<dyn InstanceRosterObserver>,
    pub(crate) current_user_presence_observer: Arc<CurrentUserLocalPresenceObserver>,
    pub(crate) integration_api_observer: Arc<dyn InstanceRosterObserver>,
    pub(crate) integration_api_input: IntegrationApiInput,
}

pub(crate) struct IntegrationApiInput {
    runtime: Arc<DesktopIntegrationApiRuntime>,
    receiver: IntegrationApiInputReceiver,
    enrichment_receiver: broadcast::Receiver<IntegrationApiEnrichmentRequest>,
}

pub(crate) fn build_desktop_wiring(
    builder: &RuntimeHostStateBuilder,
    app_version: &str,
) -> Result<DesktopWiring> {
    let context = builder.desktop_assembly();
    let host_file_access = HostFileAccess::new();
    register_desktop_file_access_grants(
        &host_file_access,
        builder.profile_backup(),
        context.config_store().as_ref(),
    )?;
    let services = Arc::new(DesktopRuntimeServices::new(
        build_desktop_runtime_services_deps(context),
    )?);
    let backend_status = BackendRuntimeStatusPublisher::new(
        builder.backend_runtime().clone(),
        context.event_bus().clone(),
    );
    let integration_api_config: Arc<dyn IntegrationApiConfigStore> = Arc::new(
        DesktopIntegrationApiConfigStore::new(context.config_store()),
    );
    let integration_api_controller = Arc::new(
        IntegrationApiController::new(integration_api_config, app_version.to_owned())
            .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()))?,
    );
    let (integration_api, enrichment_receiver) =
        DesktopIntegrationApiRuntime::new(integration_api_controller, context.auth_scope().clone());
    let (integration_api_publisher, receiver) = integration_api_publisher_channel();
    let integration_api_observer: Arc<dyn InstanceRosterObserver> =
        Arc::new(integration_api_publisher);
    let current_user_presence_observer = Arc::new(CurrentUserLocalPresenceObserver::default());
    let game_roster_observer: Arc<dyn InstanceRosterObserver> =
        Arc::new(HostInstanceRosterFanout::new(vec![
            Arc::clone(&integration_api_observer),
            Arc::clone(context.instance_dwell()) as Arc<dyn InstanceRosterObserver>,
            Arc::clone(&current_user_presence_observer) as Arc<dyn InstanceRosterObserver>,
        ]));
    let profile_config = context.profile_config();
    Ok(DesktopWiring {
        host_file_access,
        services,
        backend_status,
        profile_config,
        game_roster_observer,
        current_user_presence_observer,
        integration_api_observer,
        integration_api_input: IntegrationApiInput {
            runtime: Arc::new(integration_api),
            receiver,
            enrichment_receiver,
        },
    })
}

pub(crate) fn build_desktop_runtime(
    builder: &RuntimeHostStateBuilder,
    wiring: &DesktopWiring,
    vr_overlay_runtime: Arc<DesktopVrOverlayRuntime>,
    desktop_widget: Arc<DesktopWidget>,
    build: AppUpdateBuildInfo,
    updater_port: Arc<dyn UpdaterPort>,
) -> Arc<DesktopRuntimeBundle> {
    let context = builder.desktop_assembly();
    let telemetry = TelemetryRuntime::new(TelemetryRuntimeDeps {
        config: context.config_store(),
        environment: Arc::new(vrcx_0_outbound_adapters::LocalTelemetryEnvironment::new(
            Arc::clone(context.database()),
            builder.paths().app_data.clone(),
            Arc::new(|| {
                vrcx_0_host_desktop::system_theme::current_system_theme_category()
                    .unwrap_or_default()
                    .to_string()
            }),
        )),
        transport: Arc::new(vrcx_0_outbound_adapters::HttpTelemetryTransport::production()),
        tasks: context.tasks().clone(),
        backend_runtime: builder.backend_runtime().clone(),
        auth_scope: context.auth_scope().clone(),
        session: context.session().clone(),
        app_version: build.app_version.clone(),
    });
    let feed_logger = Arc::new(
        DesktopFeedLoggerRuntime::new(
            Arc::clone(builder.database()),
            context.config_store(),
            Arc::clone(context.world_cache()),
            context.file_cache().clone(),
            context.event_bus().clone(),
            context.auth_scope().clone(),
            context.auth_credentials_shared(),
        )
        .for_app_version(&build.app_version),
    );
    let app_update = AppUpdateRuntime::new(AppUpdateRuntimeDeps {
        release_catalog: Arc::new(vrcx_0_outbound_adapters::GitHubReleaseCatalogAdapter::new(
            Arc::clone(builder.web_client()),
        )),
        config: Arc::clone(&wiring.profile_config),
        event_bus: context.event_bus().clone(),
        background_jobs: context.background_jobs().clone(),
        build,
        target_resolver: Arc::new(|| {
            vrcx_0_host_desktop::updater_policy::expected_updater_target().ok()
        }),
        port: updater_port,
        tasks: context.tasks().clone(),
    });
    let background_image = BackgroundImageService::new(
        Arc::clone(&wiring.profile_config),
        Arc::new(
            vrcx_0_outbound_adapters::ExternalBackgroundImageRemote::new(Arc::clone(
                builder.web_client(),
            )),
        ),
        context.event_bus().clone(),
        Arc::new(HostBackgroundImageFileResolver::new(
            wiring.host_file_access.clone(),
        )),
    );
    let community_theme = CommunityThemeService::new(
        Arc::clone(&wiring.profile_config),
        Arc::new(vrcx_0_outbound_adapters::ExternalCommunityThemeRemote::new(
            Arc::clone(builder.web_client()),
        )),
        context.event_bus().clone(),
        background_image.clone(),
    );
    Arc::new(DesktopRuntimeBundle {
        services: Arc::clone(&wiring.services),
        host_file_access: wiring.host_file_access.clone(),
        discord_rpc: Arc::new(DiscordRpc::new()),
        vr_overlay_runtime,
        desktop_widget,
        app_update,
        telemetry,
        feed_logger,
        background_image,
        community_theme,
        integration_api: Arc::clone(&wiring.integration_api_input.runtime),
        integration_api_observer: Arc::clone(&wiring.integration_api_observer),
    })
}

pub(crate) fn attach_desktop_realtime(
    runtime: &RuntimeHostState,
    desktop: &DesktopRuntimeBundle,
    integration_api_input: IntegrationApiInput,
) {
    let hmd_membership_runtime = Arc::downgrade(runtime.realtime_runtime());
    desktop
        .vr_overlay_runtime
        .set_hmd_friend_membership_provider(move |user_id| {
            hmd_membership_runtime
                .upgrade()
                .is_some_and(|runtime| runtime.is_current_friend(user_id))
        });
    desktop
        .services
        .attach_realtime_runtime(runtime.realtime_runtime());
    start_integration_api_input_task(
        Arc::clone(runtime.desktop_assembly().database()),
        runtime.desktop_assembly().event_bus().clone(),
        runtime.desktop_assembly().tasks().clone(),
        Arc::clone(runtime.realtime_runtime()),
        integration_api_input.runtime,
        integration_api_input.receiver,
        integration_api_input.enrichment_receiver,
    );
}
