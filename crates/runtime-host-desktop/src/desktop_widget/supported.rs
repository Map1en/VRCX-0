use std::sync::{Arc, Mutex, Weak};

use vrcx_0_application_activity::{
    ActivityDelivery, ActivitySink, ActivitySinkRegistry, ActivitySnapshot,
};
use vrcx_0_application_core::{
    RuntimeAuthScope, RuntimeAuthScopeObserver, RuntimeAuthScopeSnapshot, RuntimeEventBus,
};
use vrcx_0_core::OwnerId;
pub(crate) use vrcx_0_overlay_runtime::desktop_widget::is_desktop_widget_config_key;
use vrcx_0_overlay_runtime::desktop_widget::{
    DesktopWidgetHost, DesktopWidgetMenuCommand, DesktopWidgetRuntime, DesktopWidgetState,
    DesktopWidgetTarget, DesktopWidgetWindows, NativeDesktopWidgetWindows,
};
use vrcx_0_overlay_runtime::VrOverlayRuntimeServices;
use vrcx_0_persistence::config::ConfigRepository;

use super::DesktopWidgetSnapshot;
use crate::notification::DesktopNotificationAction;
use crate::{DesktopRuntimeServices, PrivacyLockRuntime, RuntimeHost};

pub(super) struct Widget {
    runtime: Arc<DesktopWidgetRuntime>,
    _account_switch: Arc<AccountSwitch>,
}

pub(super) struct DesktopWidgetParts {
    pub(super) config: ConfigRepository,
    pub(super) host: RuntimeHost,
    pub(super) event_bus: RuntimeEventBus,
    pub(super) auth_scope: RuntimeAuthScope,
    pub(super) privacy_lock: Arc<PrivacyLockRuntime>,
    pub(super) activity_sinks: ActivitySinkRegistry,
    pub(super) services: Option<Arc<dyn VrOverlayRuntimeServices>>,
}

impl Widget {
    pub(super) fn new(services: &Arc<DesktopRuntimeServices>) -> Self {
        let overlay_services: Arc<dyn VrOverlayRuntimeServices> = services.clone();
        Self::assemble(
            DesktopWidgetParts {
                config: services.config().clone(),
                host: services.host.clone(),
                event_bus: services.event_bus(),
                auth_scope: services.auth_scope().clone(),
                privacy_lock: services.privacy_lock(),
                activity_sinks: services.activity_sinks(),
                services: Some(overlay_services),
            },
            Arc::new(NativeDesktopWidgetWindows::new()),
        )
    }

    pub(super) fn assemble(
        parts: DesktopWidgetParts,
        windows: Arc<dyn DesktopWidgetWindows>,
    ) -> Self {
        let host = Arc::new(HostBridge {
            host: parts.host,
            event_bus: parts.event_bus,
            auth_scope: parts.auth_scope.clone(),
        });
        let runtime =
            DesktopWidgetRuntime::new(parts.config, host, windows, parts.privacy_lock.is_locked());
        if let Some(services) = parts.services {
            runtime.attach_services(services);
        }
        parts
            .activity_sinks
            .add(Arc::new(WidgetActivitySink(Arc::downgrade(&runtime))));
        let lock_runtime = Arc::downgrade(&runtime);
        parts.privacy_lock.add_observer(Arc::new(move |snapshot| {
            if let Some(runtime) = lock_runtime.upgrade() {
                runtime.set_privacy_locked(snapshot.locked);
            }
        }));
        let account_switch = Arc::new(AccountSwitch {
            runtime: Arc::downgrade(&runtime),
            user_id: Mutex::new(parts.auth_scope.snapshot().current_user_id),
        });
        parts.auth_scope.add_observer(account_switch.clone());
        Self {
            runtime,
            _account_switch: account_switch,
        }
    }

    #[cfg(test)]
    pub(super) fn runtime(&self) -> Arc<DesktopWidgetRuntime> {
        Arc::clone(&self.runtime)
    }

    pub(super) fn snapshot(&self) -> DesktopWidgetSnapshot {
        snapshot_of(self.runtime.state())
    }

    pub(super) fn set_enabled(
        &self,
        enabled: bool,
    ) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        Ok(snapshot_of(self.runtime.set_enabled(enabled)?))
    }

    pub(super) fn toggle_pinned(&self) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        Ok(snapshot_of(
            self.runtime
                .menu_command(DesktopWidgetMenuCommand::TogglePinned)?,
        ))
    }

    pub(super) fn toggle_click_through(
        &self,
    ) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        Ok(snapshot_of(self.runtime.menu_command(
            DesktopWidgetMenuCommand::ToggleClickThrough,
        )?))
    }

    pub(super) fn bring_to_front(&self) {
        self.runtime.bring_to_front();
    }

    pub(super) fn reload_settings(&self) {
        self.runtime.reload_settings();
    }

    pub(super) fn shutdown(&self) {
        self.runtime.shutdown();
    }
}

fn snapshot_of(state: DesktopWidgetState) -> DesktopWidgetSnapshot {
    DesktopWidgetSnapshot {
        supported: true,
        enabled: state.enabled,
        pinned: state.pinned,
        click_through: state.click_through,
    }
}

struct HostBridge {
    host: RuntimeHost,
    event_bus: RuntimeEventBus,
    auth_scope: RuntimeAuthScope,
}

impl DesktopWidgetHost for HostBridge {
    fn open_target(&self, target: DesktopWidgetTarget) {
        let owner = OwnerId::new(self.auth_scope.snapshot().current_user_id);
        let action = match target {
            DesktopWidgetTarget::User { user_id } => {
                DesktopNotificationAction::open_user_profile(&owner, &user_id)
            }
            DesktopWidgetTarget::Location { location } => {
                DesktopNotificationAction::open_location(&owner, &location)
            }
        };
        if let Some(action) = action {
            self.host.open_activity_target(action);
        }
    }

    fn state_changed(&self, state: DesktopWidgetState) {
        self.event_bus.emit(snapshot_of(state));
        self.host.refresh_tray_menu();
    }
}

struct WidgetActivitySink(Weak<DesktopWidgetRuntime>);

impl ActivitySink for WidgetActivitySink {
    fn emit_overlay_activity_snapshot(&self, _snapshot: ActivitySnapshot) {}

    fn emit_overlay_activity_delivery(&self, delivery: ActivityDelivery) {
        if let Some(runtime) = self.0.upgrade() {
            runtime.ingest_delivery(delivery);
        }
    }
}

struct AccountSwitch {
    runtime: Weak<DesktopWidgetRuntime>,
    user_id: Mutex<String>,
}

impl RuntimeAuthScopeObserver for AccountSwitch {
    fn runtime_auth_scope_changed(&self, scope: &RuntimeAuthScopeSnapshot) {
        let changed = self
            .user_id
            .lock()
            .map(|mut user_id| {
                std::mem::replace(&mut *user_id, scope.current_user_id.clone())
                    != scope.current_user_id
            })
            .unwrap_or(false);
        if changed {
            if let Some(runtime) = self.runtime.upgrade() {
                runtime.clear_activity();
            }
        }
    }
}
