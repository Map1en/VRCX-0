use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};

use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
    ActivityText,
};
use vrcx_0_application_core::{ConfigStore, MemoryConfigStore};
use vrcx_0_contracts::activity::ActivityKind;

use super::{
    DesktopWidgetHost, DesktopWidgetMenuCommand, DesktopWidgetRuntime, DesktopWidgetState,
    DesktopWidgetWindow, DesktopWidgetWindows,
};
use crate::desktop_widget::feed::{DesktopWidgetRowPart, DesktopWidgetTarget};
use crate::desktop_widget::settings::{
    DesktopWidgetBounds, DesktopWidgetSettings, DESKTOP_WIDGET_OPACITY_CONFIG_KEY,
};

#[test]
fn only_activity_meant_for_the_widget_is_shown() {
    let widget = TestWidget::enabled();

    widget.runtime.ingest_delivery(delivery("Ada", true));
    widget.runtime.ingest_delivery(delivery("Bob", false));

    assert_eq!(widget.actors(), ["Ada"]);
}

#[test]
fn nothing_is_collected_while_the_widget_is_off() {
    let widget = TestWidget::new();

    widget.runtime.ingest_delivery(delivery("Ada", true));
    widget.runtime.set_enabled(true).unwrap();

    assert!(widget.actors().is_empty());
}

#[test]
fn turning_the_widget_on_opens_it_and_off_closes_it() {
    let widget = TestWidget::new();
    assert_eq!(widget.windows.open_count(), 0);

    let on = widget.runtime.set_enabled(true).unwrap();
    assert!(on.enabled);
    assert_eq!(widget.windows.open_count(), 1);

    let off = widget.runtime.set_enabled(false).unwrap();
    assert!(!off.enabled);
    assert_eq!(widget.windows.open_count(), 0);
}

#[test]
fn a_widget_left_on_opens_again_on_the_next_start() {
    let widget = TestWidget::enabled();

    let restarted = widget.restart();

    assert!(restarted.runtime.state().enabled);
    assert_eq!(restarted.windows.open_count(), 1);
}

#[test]
fn the_privacy_lock_closes_the_widget_and_unlocking_brings_back_recent_activity() {
    let widget = TestWidget::enabled();
    widget.runtime.ingest_delivery(delivery("Ada", true));

    widget.runtime.set_privacy_locked(true);
    assert_eq!(widget.windows.open_count(), 0);
    widget.runtime.ingest_delivery(delivery("Bob", true));

    widget.runtime.set_privacy_locked(false);
    assert_eq!(widget.windows.open_count(), 1);
    assert_eq!(widget.actors(), ["Ada", "Bob"]);
    assert!(widget.runtime.state().enabled);
}

#[test]
fn a_widget_turned_on_while_locked_waits_for_the_unlock() {
    let widget = TestWidget::new();
    widget.runtime.set_privacy_locked(true);

    widget.runtime.set_enabled(true).unwrap();
    assert_eq!(widget.windows.open_count(), 0);

    widget.runtime.set_privacy_locked(false);
    assert_eq!(widget.windows.open_count(), 1);
}

#[test]
fn a_widget_that_starts_while_the_app_is_locked_stays_closed() {
    let widget = TestWidget::enabled();

    let locked_start = DesktopWidgetRuntime::new(
        widget.config.clone(),
        Arc::new(RecordingHost::default()),
        Arc::clone(&widget.windows) as Arc<dyn DesktopWidgetWindows>,
        true,
    );

    assert!(locked_start.state().enabled);
    assert_eq!(widget.windows.open_count(), 1);
}

#[test]
fn quitting_the_app_closes_the_widget_but_keeps_it_on_for_the_next_start() {
    let widget = TestWidget::enabled();

    widget.runtime.shutdown();
    widget.runtime.set_privacy_locked(true);
    widget.runtime.set_privacy_locked(false);

    assert_eq!(widget.windows.open_count(), 0);
    assert!(DesktopWidgetSettings::load(widget.config.as_ref()).enabled);
}

#[test]
fn switching_accounts_clears_the_widget() {
    let widget = TestWidget::enabled();
    widget.runtime.ingest_delivery(delivery("Ada", true));

    widget.runtime.clear_activity();

    assert!(widget.actors().is_empty());
}

#[test]
fn new_activity_redraws_the_open_widget() {
    let widget = TestWidget::enabled();
    let before = widget.windows.refresh_count();

    widget.runtime.ingest_delivery(delivery("Ada", true));

    assert!(widget.windows.refresh_count() > before);
}

#[test]
fn clicking_a_name_asks_the_app_to_open_that_user() {
    let widget = TestWidget::enabled();
    widget.runtime.ingest_delivery(delivery("Ada", true));
    let id = widget.runtime.view().rows[0].id;

    widget.runtime.activate(id, DesktopWidgetRowPart::Actor);

    assert_eq!(
        widget.host.targets(),
        [DesktopWidgetTarget::User {
            user_id: "usr_Ada".to_string()
        }]
    );
}

#[test]
fn the_right_click_menu_toggles_pin_and_click_through_and_remembers_them() {
    let widget = TestWidget::enabled();

    let click_through = widget
        .runtime
        .menu_command(DesktopWidgetMenuCommand::ToggleClickThrough)
        .unwrap();
    assert!(click_through.click_through && click_through.pinned);

    let unpinned = widget
        .runtime
        .menu_command(DesktopWidgetMenuCommand::TogglePinned)
        .unwrap();
    assert!(!unpinned.pinned && !unpinned.click_through);

    let saved = DesktopWidgetSettings::load(widget.config.as_ref());
    assert!(!saved.pinned && !saved.click_through);
    assert_eq!(widget.host.last_state(), Some(unpinned));
}

#[test]
fn closing_from_the_menu_turns_the_widget_off() {
    let widget = TestWidget::enabled();

    let state = widget
        .runtime
        .menu_command(DesktopWidgetMenuCommand::Close)
        .unwrap();

    assert!(!state.enabled);
    assert_eq!(widget.windows.open_count(), 0);
    assert!(!DesktopWidgetSettings::load(widget.config.as_ref()).enabled);
    assert_eq!(widget.host.last_state(), Some(state));
}

#[test]
fn changing_background_opacity_in_settings_reaches_the_open_widget() {
    let widget = TestWidget::enabled();
    widget
        .config
        .set_string(DESKTOP_WIDGET_OPACITY_CONFIG_KEY, "0")
        .unwrap();
    let before = widget.windows.refresh_count();

    widget.runtime.reload_settings();

    assert!(widget.windows.refresh_count() > before);
    assert_eq!(widget.runtime.view().settings.background_opacity, 0);
}

#[test]
fn changing_the_app_language_redraws_the_open_widget() {
    let widget = TestWidget::enabled();
    widget.runtime.ingest_delivery(delivery("Ada", true));
    widget.config.set_string("appLanguage", "ja").unwrap();
    let before = widget.windows.refresh_count();

    widget.runtime.reload_settings();

    assert!(widget.windows.refresh_count() > before);
}

#[test]
fn moving_or_resizing_the_widget_is_remembered() {
    let widget = TestWidget::enabled();
    let bounds = DesktopWidgetBounds {
        x: 10,
        y: 20,
        width: 300,
        height: 200,
    };

    widget.runtime.save_bounds(bounds);

    assert_eq!(
        widget.restart().runtime.view().settings.bounds,
        Some(bounds)
    );
}

struct TestWidget {
    config: Arc<dyn ConfigStore>,
    host: Arc<RecordingHost>,
    windows: Arc<RecordingWindows>,
    runtime: Arc<DesktopWidgetRuntime>,
}

impl TestWidget {
    fn new() -> Self {
        Self::open(Arc::new(MemoryConfigStore::default()))
    }

    fn enabled() -> Self {
        let widget = Self::new();
        widget.runtime.set_enabled(true).unwrap();
        widget
    }

    fn restart(&self) -> Self {
        Self::open(Arc::clone(&self.config))
    }

    fn open(config: Arc<dyn ConfigStore>) -> Self {
        let host = Arc::new(RecordingHost::default());
        let windows = Arc::new(RecordingWindows::default());
        let runtime = DesktopWidgetRuntime::new(
            config.clone(),
            Arc::clone(&host) as Arc<dyn DesktopWidgetHost>,
            Arc::clone(&windows) as Arc<dyn DesktopWidgetWindows>,
            false,
        );
        Self {
            config,
            host,
            windows,
            runtime,
        }
    }

    fn actors(&self) -> Vec<String> {
        self.runtime
            .view()
            .rows
            .into_iter()
            .map(|row| row.actor)
            .collect()
    }
}

#[derive(Default)]
struct RecordingHost {
    targets: Mutex<Vec<DesktopWidgetTarget>>,
    states: Mutex<Vec<DesktopWidgetState>>,
}

impl RecordingHost {
    fn targets(&self) -> Vec<DesktopWidgetTarget> {
        self.targets.lock().unwrap().clone()
    }

    fn last_state(&self) -> Option<DesktopWidgetState> {
        self.states.lock().unwrap().last().copied()
    }
}

impl DesktopWidgetHost for RecordingHost {
    fn open_target(&self, target: DesktopWidgetTarget) {
        self.targets.lock().unwrap().push(target);
    }

    fn state_changed(&self, state: DesktopWidgetState) {
        self.states.lock().unwrap().push(state);
    }
}

#[derive(Default)]
struct RecordingWindows {
    open: Arc<AtomicUsize>,
    refreshes: Arc<AtomicUsize>,
}

impl RecordingWindows {
    fn open_count(&self) -> usize {
        self.open.load(Ordering::SeqCst)
    }

    fn refresh_count(&self) -> usize {
        self.refreshes.load(Ordering::SeqCst)
    }
}

impl DesktopWidgetWindows for RecordingWindows {
    fn open(&self, _runtime: Weak<DesktopWidgetRuntime>) -> Box<dyn DesktopWidgetWindow> {
        self.open.fetch_add(1, Ordering::SeqCst);
        Box::new(RecordingWindow {
            open: Arc::clone(&self.open),
            refreshes: Arc::clone(&self.refreshes),
        })
    }
}

struct RecordingWindow {
    open: Arc<AtomicUsize>,
    refreshes: Arc<AtomicUsize>,
}

impl DesktopWidgetWindow for RecordingWindow {
    fn refresh(&self) {
        self.refreshes.fetch_add(1, Ordering::SeqCst);
    }

    fn bring_to_front(&self) {}

    fn close(self: Box<Self>) {
        self.open.fetch_sub(1, Ordering::SeqCst);
    }
}

fn delivery(name: &str, widget: bool) -> ActivityDelivery {
    ActivityDelivery {
        entry: ActivityEntry {
            sequence: 1,
            source_id: format!("online:{name}"),
            kind: ActivityKind::Online,
            category: ActivityCategory::FavoriteMovement,
            created_at: "2026-06-01T12:34:56.000Z".to_string(),
            actor_user_id: format!("usr_{name}"),
            actor_display_name: name.to_string(),
            content: ActivityContent {
                title: ActivityText::literal(name),
                body: ActivityText::literal("has logged in"),
                ..ActivityContent::default()
            },
            actor_relation: ActivityActorRelation::Friend,
        },
        desktop: !widget,
        vr: false,
        hmd: false,
        webhook: false,
        tts: false,
        widget,
    }
}
