use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};

use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
    ActivitySink, ActivitySinkRegistry, ActivityText,
};
use vrcx_0_application_core::{RuntimeAuthScope, RuntimeEventBus, RuntimeVrchatAuthFailurePayload};
use vrcx_0_contracts::activity::ActivityKind;
use vrcx_0_core::OwnerId;
use vrcx_0_overlay_runtime::desktop_widget::{
    DesktopWidgetRowPart, DesktopWidgetRuntime, DesktopWidgetWindow, DesktopWidgetWindows,
};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use super::imp::{DesktopWidgetParts, Widget};
use super::DesktopWidget;
use crate::notification::{DesktopNotificationAction, DesktopNotificationTarget};
use crate::privacy_lock::tests::runtime_with_scope;
use crate::{PrivacyLockRuntime, RuntimeHost, RuntimeHostActions};

const OWNER: &str = "usr_12345678-1234-1234-1234-1234567890ab";
const FRIEND: &str = "usr_abcdefab-cdef-abcd-efab-cdefabcdefab";
const OTHER_ACCOUNT: &str = "usr_99999999-1234-1234-1234-1234567890ab";
const ENDPOINT: &str = "https://api.example.test/api/1";

#[test]
fn the_widget_is_available_on_windows() {
    let widget = TestWidget::new();

    assert!(widget.widget.snapshot().supported);
}

#[test]
fn activity_routed_to_the_widget_reaches_it() {
    let widget = TestWidget::new();
    widget.widget.set_enabled(true).unwrap();

    widget
        .sinks
        .emit_overlay_activity_delivery(delivery(FRIEND, "Ada"));

    assert_eq!(widget.row_count(), 1);
}

#[test]
fn locking_the_app_closes_the_widget_and_unlocking_reopens_it() {
    let widget = TestWidget::new();
    widget.widget.set_enabled(true).unwrap();
    widget.privacy_lock.set_password("1234").unwrap();

    widget.privacy_lock.engage().unwrap();
    assert_eq!(widget.windows.open_count(), 0);

    widget.privacy_lock.unlock("1234").unwrap();
    assert_eq!(widget.windows.open_count(), 1);
}

#[test]
fn a_widget_starting_while_the_app_is_locked_stays_closed() {
    let first = TestWidget::new();
    first.widget.set_enabled(true).unwrap();
    first.privacy_lock.set_password("1234").unwrap();
    first.privacy_lock.engage().unwrap();

    let restarted = first.restart();

    assert_eq!(restarted.windows.open_count(), 0);
}

#[test]
fn switching_accounts_clears_the_widget() {
    let widget = TestWidget::new();
    widget.widget.set_enabled(true).unwrap();
    widget
        .sinks
        .emit_overlay_activity_delivery(delivery(FRIEND, "Ada"));

    widget.scope.set(OTHER_ACCOUNT, ENDPOINT);

    assert_eq!(widget.row_count(), 0);
}

#[test]
fn changing_the_widget_tells_the_app_and_refreshes_the_tray() {
    let widget = TestWidget::new();
    widget.event_bus.take_events_for_test();

    let snapshot = widget.widget.toggle_click_through().unwrap();

    assert!(snapshot.click_through && snapshot.pinned);
    let events = widget.event_bus.take_events_for_test();
    assert!(events
        .iter()
        .any(|event| event.name == "desktopWidgetState"));
    assert!(widget.actions.tray_refreshes.load(Ordering::SeqCst) > 0);
}

#[test]
fn clicking_a_name_opens_that_user_for_the_signed_in_account() {
    let widget = TestWidget::new();
    widget.widget.set_enabled(true).unwrap();
    widget
        .sinks
        .emit_overlay_activity_delivery(delivery(FRIEND, "Ada"));
    let runtime = widget.widget.imp.runtime();
    let id = runtime.view().rows[0].id;

    runtime.activate(id, DesktopWidgetRowPart::Actor);

    assert_eq!(
        widget.actions.opened.lock().unwrap().clone(),
        [DesktopNotificationAction {
            owner_user_id: OwnerId::new(OWNER),
            target: DesktopNotificationTarget::OpenUserProfile {
                user_id: FRIEND.to_string(),
            },
        }]
    );
}

struct TestWidget {
    dir: Arc<TestDir>,
    config: ConfigRepository,
    scope: RuntimeAuthScope,
    privacy_lock: Arc<PrivacyLockRuntime>,
    sinks: ActivitySinkRegistry,
    event_bus: RuntimeEventBus,
    actions: Arc<RecordingActions>,
    windows: Arc<RecordingWindows>,
    widget: DesktopWidget,
}

impl TestWidget {
    fn new() -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = Arc::new(TestDir(std::env::temp_dir().join(format!(
            "vrcx-0-desktop-widget-facade-{}-{nonce}",
            std::process::id()
        ))));
        std::fs::create_dir_all(&dir.0).unwrap();
        let config = ConfigRepository::new(Arc::new(
            DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap(),
        ));
        let (privacy_lock, scope) = runtime_with_scope();
        scope.set(OWNER, ENDPOINT);
        Self::assemble(dir, config, scope, privacy_lock)
    }

    fn restart(&self) -> Self {
        Self::assemble(
            Arc::clone(&self.dir),
            self.config.clone(),
            self.scope.clone(),
            Arc::clone(&self.privacy_lock),
        )
    }

    fn assemble(
        dir: Arc<TestDir>,
        config: ConfigRepository,
        scope: RuntimeAuthScope,
        privacy_lock: Arc<PrivacyLockRuntime>,
    ) -> Self {
        let host = RuntimeHost::new();
        let actions = Arc::new(RecordingActions::default());
        host.set_actions(SharedActions(Arc::clone(&actions)));
        let sinks = ActivitySinkRegistry::default();
        let event_bus = RuntimeEventBus::new();
        let windows = Arc::new(RecordingWindows::default());
        let widget = DesktopWidget {
            imp: Widget::assemble(
                DesktopWidgetParts {
                    config: config.clone(),
                    host,
                    event_bus: event_bus.clone(),
                    auth_scope: scope.clone(),
                    privacy_lock: Arc::clone(&privacy_lock),
                    activity_sinks: sinks.clone(),
                    services: None,
                },
                Arc::clone(&windows) as Arc<dyn DesktopWidgetWindows>,
            ),
        };
        Self {
            dir,
            config,
            scope,
            privacy_lock,
            sinks,
            event_bus,
            actions,
            windows,
            widget,
        }
    }

    fn row_count(&self) -> usize {
        self.widget.imp.runtime().view().rows.len()
    }
}

#[derive(Default)]
struct RecordingActions {
    tray_refreshes: AtomicUsize,
    opened: Mutex<Vec<DesktopNotificationAction>>,
}

struct SharedActions(Arc<RecordingActions>);

impl RuntimeHostActions for SharedActions {
    fn focus_main_window(&self) {}

    fn set_tray_icon_notification(&self, _notify: bool) {}

    fn vrchat_auth_failed(&self, _failure: &RuntimeVrchatAuthFailurePayload) {}

    fn refresh_tray_menu(&self) {
        self.0.tray_refreshes.fetch_add(1, Ordering::SeqCst);
    }

    fn open_activity_target(&self, action: DesktopNotificationAction) {
        self.0.opened.lock().unwrap().push(action);
    }
}

#[derive(Default)]
struct RecordingWindows {
    open: Arc<AtomicUsize>,
}

impl RecordingWindows {
    fn open_count(&self) -> usize {
        self.open.load(Ordering::SeqCst)
    }
}

impl DesktopWidgetWindows for RecordingWindows {
    fn open(&self, _runtime: Weak<DesktopWidgetRuntime>) -> Box<dyn DesktopWidgetWindow> {
        self.open.fetch_add(1, Ordering::SeqCst);
        Box::new(RecordingWindow {
            open: Arc::clone(&self.open),
        })
    }
}

struct RecordingWindow {
    open: Arc<AtomicUsize>,
}

impl DesktopWidgetWindow for RecordingWindow {
    fn refresh(&self) {}

    fn bring_to_front(&self) {}

    fn close(self: Box<Self>) {
        self.open.fetch_sub(1, Ordering::SeqCst);
    }
}

struct TestDir(PathBuf);

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn delivery(user_id: &str, name: &str) -> ActivityDelivery {
    ActivityDelivery {
        entry: ActivityEntry {
            sequence: 1,
            source_id: format!("online:{user_id}"),
            kind: ActivityKind::Online,
            category: ActivityCategory::FavoriteMovement,
            created_at: "2026-06-01T12:34:56.000Z".to_string(),
            actor_user_id: user_id.to_string(),
            actor_display_name: name.to_string(),
            content: ActivityContent {
                title: ActivityText::literal(name),
                body: ActivityText::literal("has logged in"),
                ..ActivityContent::default()
            },
            actor_relation: ActivityActorRelation::Friend,
        },
        desktop: false,
        vr: false,
        hmd: false,
        webhook: false,
        tts: false,
        widget: true,
    }
}
