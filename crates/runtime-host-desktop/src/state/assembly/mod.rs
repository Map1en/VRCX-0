pub(super) mod desktop;
pub(super) mod game;
pub(super) mod local;
pub(super) mod remote;

use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};

use vrcx_0_application_game::GameLogLocalGameContextSource;
use vrcx_0_application_realtime::FriendProjectionObserver;
use vrcx_0_composition::{RuntimeHostComposition, RuntimeHostState, RuntimeHostStateBuilder};

use super::{
    DesktopRuntimeBundle, DesktopRuntimeProfileExtension, GameRuntimeBundle,
    RegistryBackupMaintenanceState,
};
use crate::game_isolation::IsolatedLocalGameContextSource;
use crate::group_order::HostGroupOrderSource;
use desktop::DesktopWiring;

pub(super) fn build_profile_extension(
    builder: &RuntimeHostStateBuilder,
    game: &Arc<GameRuntimeBundle>,
    desktop: &Arc<DesktopRuntimeBundle>,
) -> Arc<DesktopRuntimeProfileExtension> {
    Arc::new(DesktopRuntimeProfileExtension {
        game: Arc::clone(game),
        desktop: Arc::clone(desktop),
        registry_backup_maintenance_running: Arc::new(AtomicBool::new(false)),
        desktop_maintenance_running: Arc::new(AtomicBool::new(false)),
        background_image_started: AtomicBool::new(false),
        app_launcher_events_started: AtomicBool::new(false),
        discord_reconcile_generation: Arc::new(AtomicU64::new(0)),
        registry_backup_state: Arc::new(Mutex::new(RegistryBackupMaintenanceState::default())),
        presence_state_path: builder
            .paths()
            .app_data
            .join("presenceAutomationState.json"),
    })
}

pub(super) fn build_runtime_composition(
    builder: &RuntimeHostStateBuilder,
    wiring: &DesktopWiring,
    extension: Arc<DesktopRuntimeProfileExtension>,
) -> RuntimeHostComposition {
    let local_game_context = Arc::new(IsolatedLocalGameContextSource::new(
        Arc::new(GameLogLocalGameContextSource::new(
            builder.desktop_assembly().session().clone(),
            wiring.services.game_log_snapshot_handle(),
        )),
        wiring.services.game_isolation(),
    ));
    let friend_projection_observer: Arc<dyn FriendProjectionObserver> = wiring.services.clone();
    RuntimeHostComposition {
        local_game_context,
        group_order_source: Arc::new(HostGroupOrderSource),
        friend_projection_observer: Some(friend_projection_observer),
        profile_extension: Some(extension),
    }
}

pub(super) fn bind_realtime_runtime(runtime: &RuntimeHostState, wiring: &DesktopWiring) {
    wiring
        .current_user_presence_observer
        .bind(runtime.realtime_runtime());
    let isolation_realtime = Arc::downgrade(runtime.realtime_runtime());
    wiring
        .services
        .game_isolation()
        .add_observer(Arc::new(move |_enabled| {
            if let Some(realtime_runtime) = isolation_realtime.upgrade() {
                realtime_runtime.refresh_current_user_local_presence();
            }
        }));
    let realtime_runtime = Arc::downgrade(runtime.realtime_runtime());
    runtime
        .desktop_assembly()
        .instance_dwell()
        .set_roster_change_callback(Arc::new(move || {
            if let Some(realtime_runtime) = realtime_runtime.upgrade() {
                realtime_runtime.emit_friend_location_time_snapshot();
            }
        }));
}
