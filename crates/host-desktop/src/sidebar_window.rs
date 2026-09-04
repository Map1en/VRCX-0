#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn position(self) -> Point {
        Point {
            x: self.x,
            y: self.y,
        }
    }

    pub fn at(self, point: Point) -> Self {
        Self {
            x: point.x,
            y: point.y,
            ..self
        }
    }

    pub fn contains(self, point: Point) -> bool {
        point.x >= self.x
            && point.x < self.x + self.width
            && point.y >= self.y
            && point.y < self.y + self.height
    }

    pub fn intersects(self, other: Self) -> bool {
        self.x < other.x + other.width
            && self.x + self.width > other.x
            && self.y < other.y + other.height
            && self.y + self.height > other.y
    }

    pub fn clamp_position(self, area: Self) -> Point {
        Point {
            x: self
                .x
                .clamp(area.x, (area.x + area.width - self.width).max(area.x)),
            y: self
                .y
                .clamp(area.y, (area.y + area.height - self.height).max(area.y)),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Screen {
    pub id: std::sync::Arc<str>,
    pub bounds: Rect,
    pub work_area: Rect,
    pub scale: f64,
}

#[derive(Clone, Copy)]
pub struct Interaction {
    pub pointer_down: bool,
    pub blocked: bool,
    pub reveal_allowed: bool,
}

#[derive(Default)]
pub struct NotificationStateCache {
    #[cfg(windows)]
    value: Option<(std::time::Instant, bool)>,
}

#[cfg(windows)]
impl NotificationStateCache {
    fn read(
        &mut self,
        now: std::time::Instant,
        verify_allowed: bool,
        query: impl FnOnce() -> bool,
    ) -> bool {
        if let Some((sampled_at, value)) = self.value {
            if now.duration_since(sampled_at) < std::time::Duration::from_millis(500)
                && !(verify_allowed && value)
            {
                return value;
            }
        }
        let value = query();
        self.value = Some((now, value));
        value
    }
}

#[cfg(windows)]
pub fn interaction(
    handle: isize,
    notification_state: &mut NotificationStateCache,
    verify_reveal: bool,
    now: std::time::Instant,
) -> Interaction {
    use windows_sys::Win32::UI::{
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, IsWindowEnabled, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
        },
        Shell::{
            SHQueryUserNotificationState, QUNS_BUSY, QUNS_NOT_PRESENT, QUNS_PRESENTATION_MODE,
            QUNS_RUNNING_D3D_FULL_SCREEN,
        },
        WindowsAndMessaging::{
            GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO, GUI_INMENUMODE,
            GUI_INMOVESIZE, GUI_POPUPMENUMODE, GUI_SYSTEMMENUMODE,
        },
    };
    let pointer_down = unsafe {
        [VK_LBUTTON, VK_MBUTTON, VK_RBUTTON]
            .into_iter()
            .any(|key| GetAsyncKeyState(i32::from(key)) < 0)
    };
    let reveal_allowed = notification_state.read(now, verify_reveal && !pointer_down, || unsafe {
        let mut state = 0;
        let result = SHQueryUserNotificationState(&mut state);
        result >= 0
            && !matches!(
                state,
                QUNS_BUSY
                    | QUNS_NOT_PRESENT
                    | QUNS_PRESENTATION_MODE
                    | QUNS_RUNNING_D3D_FULL_SCREEN
            )
    });
    unsafe {
        let mut gui = GUITHREADINFO {
            cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        let thread = GetWindowThreadProcessId(handle as _, std::ptr::null_mut());
        let native_interaction = GetGUIThreadInfo(thread, &mut gui) != 0
            && gui.flags
                & (GUI_INMENUMODE | GUI_INMOVESIZE | GUI_POPUPMENUMODE | GUI_SYSTEMMENUMODE)
                != 0;
        Interaction {
            pointer_down,
            blocked: IsWindowEnabled(handle as _) == 0 || native_interaction,
            reveal_allowed,
        }
    }
}

#[cfg(windows)]
pub fn place_window(handle: isize, point: Point, raise: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
    };
    let order_flags = if raise { 0 } else { SWP_NOZORDER };
    let updated = unsafe {
        SetWindowPos(
            handle as _,
            HWND_TOP,
            point.x.round() as i32,
            point.y.round() as i32,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOSIZE | order_flags,
        )
    };
    if updated == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn interaction(
    handle: isize,
    _notification_state: &mut NotificationStateCache,
    _verify_reveal: bool,
    _now: std::time::Instant,
) -> Interaction {
    use objc2_app_kit::{NSEvent, NSWindow};
    let window = unsafe { &*(handle as *const NSWindow) };
    Interaction {
        pointer_down: NSEvent::pressedMouseButtons() != 0,
        blocked: window.attachedSheet().is_some(),
        reveal_allowed: window.isOnActiveSpace(),
    }
}

#[cfg(windows)]
pub fn set_taskbar_button(handle: isize, shown: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE, SW_HIDE, SW_SHOWNOACTIVATE,
        WS_EX_TOOLWINDOW,
    };
    unsafe {
        let window = handle as _;
        let style = GetWindowLongPtrW(window, GWL_EXSTYLE);
        if style == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let tool_window = WS_EX_TOOLWINDOW as isize;
        let next = if shown {
            style & !tool_window
        } else {
            style | tool_window
        };
        if next == style {
            return Ok(());
        }
        ShowWindow(window, SW_HIDE);
        SetWindowLongPtrW(window, GWL_EXSTYLE, next);
        ShowWindow(window, SW_SHOWNOACTIVATE);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn set_taskbar_button(_handle: isize, _shown: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn place_window(handle: isize, point: Point, raise: bool) -> Result<(), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWindow};
    use objc2_foundation::NSPoint;
    let main_thread =
        MainThreadMarker::new().ok_or("Placing a window requires the main thread.")?;
    let primary = NSScreen::screens(main_thread)
        .firstObject()
        .ok_or("No screen is available.")?;
    let window = unsafe { &*(handle as *const NSWindow) };
    window.setFrameOrigin(NSPoint::new(
        point.x,
        primary.frame().size.height - point.y - window.frame().size.height,
    ));
    if raise {
        window.orderFrontRegardless();
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub struct LogicalGeometry {
    pub rect: Rect,
    pub screens: Vec<Screen>,
}

#[cfg(target_os = "macos")]
pub fn logical_geometry(handle: isize) -> Result<LogicalGeometry, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWindow};
    use objc2_foundation::{NSRect, NSString};
    let main_thread = MainThreadMarker::new().ok_or("Window geometry requires the main thread.")?;
    let screens = NSScreen::screens(main_thread);
    let primary = screens.firstObject().ok_or("No screen is available.")?;
    let height = primary.frame().size.height;
    let convert = |rect: NSRect| Rect {
        x: rect.origin.x,
        y: height - rect.origin.y - rect.size.height,
        width: rect.size.width,
        height: rect.size.height,
    };
    let window = unsafe { &*(handle as *const NSWindow) };
    Ok(LogicalGeometry {
        rect: convert(window.frame()),
        screens: screens
            .iter()
            .map(|screen| {
                let key = NSString::from_str("NSScreenNumber");
                let number = screen
                    .deviceDescription()
                    .objectForKey(&key)
                    .ok_or("Screen identity is unavailable.")?;
                let id: u32 = unsafe { objc2::msg_send![&*number, unsignedIntValue] };
                Ok(Screen {
                    id: format!("macos:{id}").into(),
                    bounds: convert(screen.frame()),
                    work_area: convert(screen.visibleFrame()),
                    scale: 1.0,
                })
            })
            .collect::<Result<_, String>>()?,
    })
}

#[cfg(target_os = "macos")]
pub fn logical_pointer() -> Result<Point, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSScreen};
    let main_thread =
        MainThreadMarker::new().ok_or("Reading the pointer requires the main thread.")?;
    let primary = NSScreen::screens(main_thread)
        .firstObject()
        .ok_or("No screen is available.")?;
    let point = NSEvent::mouseLocation();
    Ok(Point {
        x: point.x,
        y: primary.frame().size.height - point.y,
    })
}

#[cfg(all(test, windows))]
mod tests {
    use super::{place_window, NotificationStateCache, Point};
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetForegroundWindow, GetWindowRect, IsWindowVisible,
        WS_EX_TOOLWINDOW, WS_OVERLAPPEDWINDOW,
    };

    struct TestWindow(isize);

    impl Drop for TestWindow {
        fn drop(&mut self) {
            unsafe {
                DestroyWindow(self.0 as _);
            }
        }
    }

    fn create_test_window() -> TestWindow {
        let class_name: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let handle = unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                class_name.as_ptr(),
                class_name.as_ptr(),
                WS_OVERLAPPEDWINDOW,
                -30000,
                -30000,
                320,
                240,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        assert!(!handle.is_null());
        TestWindow(handle as isize)
    }

    fn window_origin(window: &TestWindow) -> (i32, i32) {
        let mut rect = RECT::default();
        assert_ne!(unsafe { GetWindowRect(window.0 as _, &mut rect) }, 0);
        (rect.left, rect.top)
    }

    #[test]
    fn repeated_moves_never_show_the_window_or_take_focus() {
        let window = create_test_window();
        let visible = unsafe { IsWindowVisible(window.0 as _) };
        for (step, raise) in [false, true, false, true, false, true]
            .into_iter()
            .enumerate()
        {
            let point = Point {
                x: -30000.0 + step as f64,
                y: -29000.0 - step as f64,
            };
            place_window(window.0, point, raise).unwrap();
            assert_eq!(unsafe { IsWindowVisible(window.0 as _) }, visible);
            assert_ne!(unsafe { GetForegroundWindow() }, window.0 as _);
            assert_eq!(window_origin(&window), (point.x as i32, point.y as i32));
        }
    }

    #[test]
    fn invalid_window_placements_return_errors() {
        let point = Point { x: 0.0, y: 0.0 };
        assert!(place_window(0, point, true).is_err());
        assert!(place_window(0, point, false).is_err());
    }

    #[test]
    fn interaction_uses_the_tick_timestamp_for_notification_sampling() {
        let now = std::time::Instant::now() - std::time::Duration::from_secs(1);
        let mut cache = NotificationStateCache::default();
        super::interaction(0, &mut cache, false, now);
        assert_eq!(cache.value.map(|(sampled_at, _)| sampled_at), Some(now));
    }

    #[test]
    fn notification_state_is_reused_for_500ms_then_refreshed() {
        use std::time::{Duration, Instant};
        let now = Instant::now();
        let mut cache = NotificationStateCache::default();
        let reads = std::cell::Cell::new(0);
        let query = |allowed| {
            reads.set(reads.get() + 1);
            allowed
        };
        assert!(cache.read(now, false, || query(true)));
        for ms in [16, 60, 120, 499] {
            assert!(cache.read(now + Duration::from_millis(ms), false, || query(false)));
        }
        assert_eq!(reads.get(), 1);
        assert!(!cache.read(now + Duration::from_millis(500), false, || query(false)));
        assert!(cache.read(now + Duration::from_millis(1000), false, || query(true)));
        assert_eq!(reads.get(), 3);
    }

    #[test]
    fn revealing_rechecks_cached_permission_but_does_not_poll_a_blocked_desktop() {
        use std::time::{Duration, Instant};
        let now = Instant::now();
        let mut cache = NotificationStateCache::default();
        assert!(cache.read(now, false, || true));
        assert!(!cache.read(now + Duration::from_millis(60), true, || false));
        assert!(
            !cache.read(now + Duration::from_millis(120), true, || panic!(
                "Blocked state must remain cached"
            ))
        );
        assert!(cache.read(now + Duration::from_millis(560), true, || true));
    }
}
