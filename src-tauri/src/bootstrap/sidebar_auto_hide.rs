use crate::error::AppError;
use tauri::{AppHandle, Manager};
use vrcx_0_runtime_host_desktop::sidebar_auto_hide::{
    SidebarAutoHideContext, SidebarAutoHideSnapshot,
};

#[cfg(any(windows, target_os = "macos"))]
const PREFERENCE_KEY: &str = "VRCX_SidebarAutoHide";
#[cfg(any(windows, target_os = "macos"))]
const STATUS_EVENT: &str = "sidebarAutoHideState";

static SIDEBAR_MODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub(crate) fn sidebar_mode() -> bool {
    SIDEBAR_MODE.load(std::sync::atomic::Ordering::Acquire)
}

pub(crate) fn snapshot(app: &AppHandle) -> SidebarAutoHideSnapshot {
    #[cfg(any(windows, target_os = "macos"))]
    if let Some(shared) = app.try_state::<native::Shared>() {
        return shared
            .control
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .snapshot();
    }
    let _ = app;
    SidebarAutoHideSnapshot::default()
}

pub(crate) async fn set_enabled(app: AppHandle, enabled: bool) -> Result<bool, AppError> {
    #[cfg(any(windows, target_os = "macos"))]
    {
        native::update(app.clone(), move |control, window| {
            control.recover(window)?;
            control.enabled = enabled;
            control.failed = false;
            Ok(())
        })
        .await?;
        app.state::<crate::state::AppState>()
            .runtime_host()
            .storage_set(PREFERENCE_KEY.into(), enabled.to_string());
        Ok(enabled)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, enabled);
        Err(AppError::Custom(
            "Sidebar auto-hide is not supported on this platform.".into(),
        ))
    }
}

pub(crate) async fn set_context(
    app: AppHandle,
    context: SidebarAutoHideContext,
) -> Result<(), AppError> {
    if SIDEBAR_MODE.swap(context.sidebar_mode, std::sync::atomic::Ordering::AcqRel)
        != context.sidebar_mode
    {
        if let Some(state) = app.try_state::<crate::state::AppState>() {
            if let Err(error) = super::refresh_tray_menu(&app, &state) {
                tracing::warn!(error = %error, "failed to refresh tray menu after sidebar mode change");
            }
        }
    }
    #[cfg(any(windows, target_os = "macos"))]
    return native::update(app, move |control, window| {
        if context.sidebar_mode != control.context.sidebar_mode {
            control.recover(window)?;
            control.failed = false;
        }
        control.context = context;
        Ok(())
    })
    .await;
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, context);
        Ok(())
    }
}

pub(crate) async fn set_suspended(app: AppHandle, suspended: bool) -> Result<(), AppError> {
    #[cfg(any(windows, target_os = "macos"))]
    return native::update(app, move |control, window| {
        if suspended || control.failed {
            control.recover(window)?;
        }
        control.suspended = suspended;
        if !suspended {
            control.failed = false;
        }
        Ok(())
    })
    .await;
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, suspended);
        Ok(())
    }
}

pub(crate) fn park(app: &AppHandle, parked: bool) {
    #[cfg(any(windows, target_os = "macos"))]
    native::park(app, parked);
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = (app, parked);
}

pub(crate) fn attach(window: &tauri::WebviewWindow) {
    #[cfg(any(windows, target_os = "macos"))]
    native::attach(window);
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = window;
}

#[cfg(windows)]
pub(crate) fn is_animating(app: &AppHandle) -> bool {
    app.try_state::<native::Shared>()
        .is_some_and(|shared| shared.animating.load(std::sync::atomic::Ordering::Acquire))
}

#[cfg(any(windows, target_os = "macos"))]
mod native {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };
    use std::time::{Duration, Instant};
    use tauri::{Emitter, Manager, WebviewWindow};
    use tokio::sync::Notify;
    use vrcx_0_host_desktop::sidebar_window;
    use vrcx_0_runtime_host_desktop::sidebar_auto_hide::{
        visible_position, Action, Point, Rect, Sample, Screen, SidebarAutoHide,
    };

    #[derive(Default)]
    pub(super) struct Control {
        pub enabled: bool,
        pub context: SidebarAutoHideContext,
        pub suspended: bool,
        pub failed: bool,
        pub parked: bool,
        pub machine: SidebarAutoHide,
        geometry: Option<(Rect, Vec<Screen>)>,
        sampled_at: Option<Instant>,
        notification_state: sidebar_window::NotificationStateCache,
    }

    #[derive(Default)]
    pub(super) struct Shared {
        pub control: Mutex<Control>,
        pub animating: AtomicBool,
        geometry_dirty: AtomicBool,
        pub wake: Arc<Notify>,
    }

    fn window_error(error: tauri::Error) -> AppError {
        AppError::Custom(error.to_string())
    }

    impl Control {
        fn poll_interval(&self) -> Option<Duration> {
            (self.enabled
                && self.context.sidebar_mode
                && !self.suspended
                && !self.parked
                && !self.failed)
                .then(|| self.machine.interval())
        }

        fn refresh_geometry(
            &mut self,
            now: Instant,
            dirty: bool,
            read: impl FnOnce() -> Result<(Rect, Vec<Screen>), AppError>,
        ) -> Result<(), AppError> {
            if dirty
                || self
                    .sampled_at
                    .is_none_or(|last| now.duration_since(last) >= Duration::from_secs(1))
            {
                self.geometry = Some(read()?);
                self.sampled_at = Some(now);
            }
            Ok(())
        }

        pub fn snapshot(&self) -> SidebarAutoHideSnapshot {
            SidebarAutoHideSnapshot {
                enabled: self.enabled,
                failed: self.failed,
            }
        }

        pub fn recover(&mut self, window: &WebviewWindow) -> Result<(), AppError> {
            self.sampled_at = None;
            self.notification_state = sidebar_window::NotificationStateCache::default();
            set_taskbar_button(window, true)?;
            let pending_bounds = self.machine.recovery_bounds();
            if pending_bounds.is_some() || self.failed {
                let (current, screens) = geometry(window)?;
                let bounds = pending_bounds.unwrap_or(current);
                let point = visible_position(
                    Rect {
                        width: current.width,
                        height: current.height,
                        ..bounds
                    },
                    &screens,
                )
                .ok_or_else(|| {
                    AppError::Custom("No screen is available for window recovery.".into())
                })?;
                place(window, point, true)?;
            }
            self.machine.reset();
            Ok(())
        }
    }

    fn publish(window: &WebviewWindow, control: &Control) {
        let _ = window.emit(STATUS_EVENT, control.snapshot());
    }

    fn with_control(
        app: &AppHandle,
        action: impl FnOnce(&mut Control, &WebviewWindow) -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| AppError::Custom("Main window is not available.".into()))?;
        let shared = app
            .try_state::<Shared>()
            .ok_or_else(|| AppError::Custom("Sidebar auto-hide state is not available.".into()))?;
        let mut control = shared.control.lock().unwrap_or_else(|e| e.into_inner());
        shared.animating.store(false, Ordering::Release);
        let result = action(&mut control, &window);
        publish(&window, &control);
        shared.wake.notify_one();
        result
    }

    pub(super) fn park(app: &AppHandle, parked: bool) {
        let main_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = with_control(&main_app, move |control, window| {
                control.parked = parked;
                match control.recover(window) {
                    Ok(()) => {
                        if !parked {
                            control.failed = false;
                        }
                    }
                    Err(error) => {
                        control.failed = true;
                        tracing::warn!(%error, "failed to restore edge-hidden window");
                    }
                }
                Ok(())
            });
        });
    }

    fn handle(window: &WebviewWindow) -> Result<isize, AppError> {
        #[cfg(windows)]
        return Ok(window.hwnd().map_err(window_error)?.0 as isize);
        #[cfg(target_os = "macos")]
        return Ok(window.ns_window().map_err(window_error)? as isize);
    }

    fn place(window: &WebviewWindow, point: Point, raise: bool) -> Result<(), AppError> {
        sidebar_window::place_window(handle(window)?, point, raise).map_err(AppError::Custom)
    }

    fn set_taskbar_button(window: &WebviewWindow, shown: bool) -> Result<(), AppError> {
        sidebar_window::set_taskbar_button(handle(window)?, shown).map_err(AppError::Custom)
    }

    fn apply(window: &WebviewWindow, action: Action) -> Result<(), AppError> {
        match action {
            Action::Move(point) => place(window, point, false),
            Action::Hide(point) => {
                place(window, point, false)?;
                set_taskbar_button(window, false)
            }
            Action::Reveal(point) => {
                set_taskbar_button(window, true)?;
                place(window, point, true)
            }
        }
    }

    pub(super) async fn update(
        app: AppHandle,
        action: impl FnOnce(&mut Control, &WebviewWindow) -> Result<(), AppError> + Send + 'static,
    ) -> Result<(), AppError> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let main_app = app.clone();
        app.run_on_main_thread(move || {
            let _ = sender.send(with_control(&main_app, action));
        })
        .map_err(window_error)?;
        receiver
            .await
            .map_err(|error| AppError::Custom(error.to_string()))?
    }

    pub(super) fn attach(window: &WebviewWindow) {
        let app = window.app_handle();
        if app.try_state::<Shared>().is_none() {
            app.manage(Shared::default());
        }
        *app.state::<Shared>()
            .control
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Control {
            enabled: app
                .state::<crate::state::AppState>()
                .runtime_host()
                .storage_get(PREFERENCE_KEY)
                .as_deref()
                != Some("false"),
            ..Control::default()
        };
        let destroyed = Arc::new(AtomicBool::new(false));
        let on_destroyed = destroyed.clone();
        let event_app = app.clone();
        let wake = app.state::<Shared>().wake.clone();
        let event_wake = wake.clone();
        window.on_window_event(move |event| {
            let shared = event_app.state::<Shared>();
            match event {
                tauri::WindowEvent::Destroyed => {
                    on_destroyed.store(true, Ordering::Release);
                    event_wake.notify_one();
                }
                tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    shared.geometry_dirty.store(true, Ordering::Release);
                }
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                    if !shared.animating.load(Ordering::Acquire) =>
                {
                    shared.geometry_dirty.store(true, Ordering::Release);
                }
                _ => {}
            }
        });
        let window = window.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = None;
            while !destroyed.load(Ordering::Acquire) {
                match interval {
                    Some(duration) => tokio::select! {
                        _ = tokio::time::sleep(duration) => {}
                        _ = wake.notified() => {}
                    },
                    None => wake.notified().await,
                }
                if destroyed.load(Ordering::Acquire) {
                    break;
                }
                let (sender, receiver) = tokio::sync::oneshot::channel();
                let tick_window = window.clone();
                let tick_destroyed = destroyed.clone();
                if window.run_on_main_thread(move || {
                    if tick_destroyed.load(Ordering::Acquire) { return; }
                    let shared = tick_window.app_handle().state::<Shared>();
                    let mut control = shared.control.lock().unwrap_or_else(|e| e.into_inner());
                    let interval = match tick(&tick_window, &mut control, &shared) {
                        Ok(interval) => interval,
                        Err(error) => {
                            control.failed = true;
                            shared.animating.store(false, Ordering::Release);
                            let recovery = control.recover(&tick_window);
                            publish(&tick_window, &control);
                            tracing::warn!(%error, ?recovery, "sidebar auto-hide suspended after a window error");
                            None
                        }
                    };
                    let _ = sender.send(interval);
                }).is_err() { break; }
                let Ok(next_interval) = receiver.await else {
                    break;
                };
                interval = next_interval;
            }
        });
    }

    #[cfg(windows)]
    fn screen_id(name: Option<&str>, position: Point) -> Arc<str> {
        match name.filter(|name| !name.trim().is_empty()) {
            Some(name) => name.into(),
            None => format!("position:{}:{}", position.x, position.y).into(),
        }
    }

    #[cfg(windows)]
    fn geometry(window: &WebviewWindow) -> Result<(Rect, Vec<Screen>), AppError> {
        let position = window.outer_position().map_err(window_error)?;
        let size = window.outer_size().map_err(window_error)?;
        let screens = window
            .available_monitors()
            .map_err(window_error)?
            .into_iter()
            .map(|monitor| {
                let work_area = monitor.work_area();
                Screen {
                    id: screen_id(
                        monitor.name().map(String::as_str),
                        Point {
                            x: monitor.position().x.into(),
                            y: monitor.position().y.into(),
                        },
                    ),
                    bounds: Rect {
                        x: monitor.position().x.into(),
                        y: monitor.position().y.into(),
                        width: monitor.size().width.into(),
                        height: monitor.size().height.into(),
                    },
                    work_area: Rect {
                        x: work_area.position.x.into(),
                        y: work_area.position.y.into(),
                        width: work_area.size.width.into(),
                        height: work_area.size.height.into(),
                    },
                    scale: monitor.scale_factor(),
                }
            })
            .collect();
        Ok((
            Rect {
                x: position.x.into(),
                y: position.y.into(),
                width: size.width.into(),
                height: size.height.into(),
            },
            screens,
        ))
    }

    #[cfg(target_os = "macos")]
    fn geometry(window: &WebviewWindow) -> Result<(Rect, Vec<Screen>), AppError> {
        let geometry =
            sidebar_window::logical_geometry(handle(window)?).map_err(AppError::Custom)?;
        Ok((geometry.rect, geometry.screens))
    }

    fn tick(
        window: &WebviewWindow,
        control: &mut Control,
        shared: &Shared,
    ) -> Result<Option<Duration>, AppError> {
        if control.poll_interval().is_none() {
            shared.animating.store(false, Ordering::Release);
            return Ok(None);
        }
        let now = Instant::now();
        control.refresh_geometry(
            now,
            shared.geometry_dirty.swap(false, Ordering::AcqRel),
            || geometry(window),
        )?;
        let (rect, screens) = control
            .geometry
            .as_ref()
            .ok_or_else(|| AppError::Custom("Window geometry is unavailable.".into()))?;
        #[cfg(windows)]
        let pointer = window.cursor_position().ok().map(|point| Point {
            x: point.x,
            y: point.y,
        });
        #[cfg(target_os = "macos")]
        let pointer = Some(sidebar_window::logical_pointer().map_err(AppError::Custom)?);
        let verify_reveal = control.machine.is_hidden_edge_hovered(pointer);
        let interaction = sidebar_window::interaction(
            handle(window)?,
            &mut control.notification_state,
            verify_reveal,
            now,
        );
        let sample = Sample {
            rect: *rect,
            screens: screens.clone(),
            pointer,
            pointer_down: interaction.pointer_down,
            visible: window.is_visible().map_err(window_error)?,
            minimized: window.is_minimized().map_err(window_error)?,
            maximized: window.is_maximized().map_err(window_error)?
                || window.is_fullscreen().map_err(window_error)?,
            blocked: control.context.blocked || interaction.blocked,
            reveal_allowed: interaction.reveal_allowed,
            reduced_motion: control.context.reduced_motion,
            frame_inset: control.context.frame_inset,
        };
        control
            .machine
            .tick(now, &sample, |action, next_animating| {
                shared.animating.store(next_animating, Ordering::Release);
                apply(window, action)?;
                let point = match action {
                    Action::Move(point) | Action::Hide(point) | Action::Reveal(point) => point,
                };
                if let Some((rect, _)) = &mut control.geometry {
                    rect.x = point.x;
                    rect.y = point.y;
                }
                Ok::<(), AppError>(())
            })?;
        shared
            .animating
            .store(control.machine.is_animating(), Ordering::Release);
        Ok(control.poll_interval())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn inactive_states_have_no_polling_deadline() {
            let mut control = Control::default();
            assert_eq!(control.poll_interval(), None);
            control.enabled = true;
            assert_eq!(control.poll_interval(), None);
            control.context.sidebar_mode = true;
            assert_eq!(control.poll_interval(), Some(Duration::from_millis(60)));
            control.failed = true;
            assert_eq!(control.poll_interval(), None);
            control.failed = false;
            control.parked = true;
            assert_eq!(control.poll_interval(), None);
            control.parked = false;
            control.suspended = true;
            assert_eq!(control.poll_interval(), None);
        }

        #[test]
        fn display_enumeration_is_cached_until_invalidated_or_expired() {
            let now = Instant::now();
            let mut control = Control::default();
            let reads = std::cell::Cell::new(0);
            let read = || {
                reads.set(reads.get() + 1);
                Ok((
                    Rect {
                        x: 0.0,
                        y: 0.0,
                        width: 400.0,
                        height: 700.0,
                    },
                    Vec::new(),
                ))
            };
            for ms in [0, 16, 32, 60, 120, 999] {
                control
                    .refresh_geometry(now + Duration::from_millis(ms), false, read)
                    .unwrap();
            }
            assert_eq!(reads.get(), 1);
            control
                .refresh_geometry(now + Duration::from_millis(1000), false, read)
                .unwrap();
            assert_eq!(reads.get(), 2);
            control
                .refresh_geometry(now + Duration::from_millis(1016), true, read)
                .unwrap();
            assert_eq!(reads.get(), 3);
        }

        #[cfg(windows)]
        #[test]
        fn unnamed_monitors_use_distinct_position_ids_without_failing() {
            let left = Point { x: -1920.0, y: 0.0 };
            let right = Point { x: 0.0, y: 0.0 };
            assert_eq!(screen_id(None, left), screen_id(Some(""), left));
            assert_eq!(screen_id(None, left), screen_id(Some("  "), left));
            assert_ne!(screen_id(None, left), screen_id(None, right));
            assert_eq!(
                screen_id(Some(r"\\.\DISPLAY1"), left).as_ref(),
                r"\\.\DISPLAY1"
            );
        }
    }
}
