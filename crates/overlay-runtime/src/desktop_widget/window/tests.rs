use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
    ActivityText,
};
use vrcx_0_application_core::{ConfigStore, MemoryConfigStore};
use vrcx_0_contracts::activity::ActivityKind;
use vrcx_0_host_desktop::desktop_widget_window::screen_work_areas;
use windows_sys::Win32::Foundation::RECT;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, IsWindow, SendMessageW, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
};

use super::NativeDesktopWidgetWindows;
use crate::desktop_widget::feed::DesktopWidgetTarget;
use crate::desktop_widget::runtime::{DesktopWidgetHost, DesktopWidgetRuntime, DesktopWidgetState};
use crate::desktop_widget::settings::{
    DesktopWidgetBounds, DesktopWidgetSettings, DESKTOP_WIDGET_NEWEST_ON_TOP_CONFIG_KEY,
};

#[test]
fn turning_the_widget_on_shows_a_window_where_it_was_left_and_turning_it_off_removes_it() {
    let widget = TestWidget::new();

    widget.runtime.set_enabled(true).unwrap();
    let handle = widget.window_handle();

    assert_eq!(window_rect(handle), widget.bounds);

    widget.runtime.set_enabled(false).unwrap();
    assert!(!is_window(handle));
}

#[test]
fn clicking_a_name_in_the_window_asks_the_app_to_open_that_user() {
    let widget = TestWidget::new();
    widget.runtime.set_enabled(true).unwrap();
    let handle = widget.window_handle();
    widget.runtime.ingest_delivery(delivery("Ada"));
    std::thread::sleep(Duration::from_millis(200));

    let scale = unsafe { GetDpiForWindow(handle as _) } as f32 / 96.0;
    let x = (40.0 * scale) as isize;
    let y = (18.0 * scale) as isize;
    let point = (y << 16) | x;
    unsafe {
        SendMessageW(handle as _, WM_MOUSEMOVE, 0, point);
        SendMessageW(handle as _, WM_LBUTTONDOWN, 1, point);
        SendMessageW(handle as _, WM_LBUTTONUP, 0, point);
    }

    assert_eq!(
        widget.host.targets.lock().unwrap().clone(),
        [DesktopWidgetTarget::User {
            user_id: "usr_Ada".to_string()
        }]
    );
    widget.runtime.set_enabled(false).unwrap();
}

#[test]
fn switching_to_newest_at_the_bottom_redraws_the_open_window_right_away() {
    let widget = TestWidget::new();
    widget.runtime.set_enabled(true).unwrap();
    let handle = widget.window_handle();
    widget.runtime.ingest_delivery(delivery("Ada"));
    widget.runtime.ingest_delivery(delivery("Bob"));
    std::thread::sleep(Duration::from_millis(200));

    widget
        .config
        .set_bool(DESKTOP_WIDGET_NEWEST_ON_TOP_CONFIG_KEY, false)
        .unwrap();
    widget.runtime.reload_settings();
    std::thread::sleep(Duration::from_millis(200));
    click(
        handle,
        (widget.bounds.height as f32) - 18.0 * scale_of(handle),
    );

    assert_eq!(
        widget.host.targets.lock().unwrap().clone(),
        [DesktopWidgetTarget::User {
            user_id: "usr_Bob".to_string()
        }]
    );
    widget.runtime.set_enabled(false).unwrap();
}

fn scale_of(handle: isize) -> f32 {
    let dpi = unsafe { GetDpiForWindow(handle as _) };
    dpi as f32 / 96.0
}

fn click(handle: isize, y: f32) {
    let x = (40.0 * scale_of(handle)) as isize;
    let point = ((y as isize) << 16) | x;
    unsafe {
        SendMessageW(handle as _, WM_MOUSEMOVE, 0, point);
        SendMessageW(handle as _, WM_LBUTTONDOWN, 1, point);
        SendMessageW(handle as _, WM_LBUTTONUP, 0, point);
    }
}

struct TestWidget {
    config: Arc<dyn ConfigStore>,
    host: Arc<RecordingHost>,
    windows: Arc<NativeDesktopWidgetWindows>,
    runtime: Arc<DesktopWidgetRuntime>,
    bounds: DesktopWidgetBounds,
}

impl TestWidget {
    fn new() -> Self {
        let config: Arc<dyn ConfigStore> = Arc::new(MemoryConfigStore::default());
        let (_, primary) = screen_work_areas();
        let primary = primary.expect("a primary screen");
        let bounds = DesktopWidgetBounds {
            x: primary.x + 40,
            y: primary.y + 40,
            width: 360,
            height: 240,
        };
        let mut settings = DesktopWidgetSettings::load(config.as_ref());
        settings.bounds = Some(bounds);
        settings.save(config.as_ref()).unwrap();
        let host = Arc::new(RecordingHost::default());
        let windows = Arc::new(NativeDesktopWidgetWindows::new());
        let runtime = DesktopWidgetRuntime::new(
            config.clone(),
            Arc::clone(&host) as Arc<dyn DesktopWidgetHost>,
            Arc::clone(&windows) as Arc<dyn super::DesktopWidgetWindows>,
            false,
        );
        Self {
            config,
            host,
            windows,
            runtime,
            bounds,
        }
    }

    fn window_handle(&self) -> isize {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(handle) = self.windows.last_window_handle() {
                return handle;
            }
            assert!(Instant::now() < deadline, "the widget window never opened");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

#[derive(Default)]
struct RecordingHost {
    targets: Mutex<Vec<DesktopWidgetTarget>>,
}

impl DesktopWidgetHost for RecordingHost {
    fn open_target(&self, target: DesktopWidgetTarget) {
        self.targets.lock().unwrap().push(target);
    }

    fn state_changed(&self, _state: DesktopWidgetState) {}
}

fn window_rect(handle: isize) -> DesktopWidgetBounds {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    unsafe { GetWindowRect(handle as _, &mut rect) };
    DesktopWidgetBounds {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    }
}

fn is_window(handle: isize) -> bool {
    unsafe { IsWindow(handle as _) != 0 }
}

fn delivery(name: &str) -> ActivityDelivery {
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
        desktop: false,
        vr: false,
        hmd: false,
        webhook: false,
        tts: false,
        widget: true,
    }
}
