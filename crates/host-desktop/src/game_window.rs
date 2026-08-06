#[cfg(target_os = "windows")]
pub fn focus_vrchat_window() -> bool {
    focus_vrchat_windows(
        crate::process_status::vrchat_process_ids()
            .into_iter()
            .collect(),
    )
}

#[cfg(target_os = "windows")]
pub fn focus_vrchat_window_for_process(process_id: u32) -> bool {
    use std::collections::HashSet;

    if !crate::process_status::vrchat_process_ids().contains(&process_id) {
        return false;
    }
    focus_vrchat_windows(HashSet::from([process_id]))
}

#[cfg(target_os = "windows")]
fn focus_vrchat_windows(process_ids: std::collections::HashSet<u32>) -> bool {
    use std::collections::HashSet;

    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FlashWindowEx, GetWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, FLASHWINFO, FLASHW_TRAY, GW_OWNER, SW_RESTORE,
    };

    struct WindowSearch {
        process_ids: HashSet<u32>,
        window: HWND,
    }

    unsafe extern "system" fn find_window(window: HWND, parameter: LPARAM) -> BOOL {
        let search = unsafe { &mut *(parameter as *mut WindowSearch) };
        if unsafe { IsWindowVisible(window) } == 0
            || !unsafe { GetWindow(window, GW_OWNER) }.is_null()
        {
            return 1;
        }

        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(window, &mut process_id) };
        if !search.process_ids.contains(&process_id) {
            return 1;
        }

        search.window = window;
        0
    }

    let mut search = WindowSearch {
        process_ids,
        window: std::ptr::null_mut(),
    };
    if search.process_ids.is_empty() {
        return false;
    }

    unsafe {
        EnumWindows(
            Some(find_window),
            &mut search as *mut WindowSearch as LPARAM,
        );
    }
    if search.window.is_null() {
        return false;
    }

    unsafe {
        if IsIconic(search.window) != 0 {
            ShowWindow(search.window, SW_RESTORE);
        }
        if SetForegroundWindow(search.window) != 0 {
            return true;
        }

        let flash = FLASHWINFO {
            cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
            hwnd: search.window,
            dwFlags: FLASHW_TRAY,
            uCount: 3,
            dwTimeout: 0,
        };
        FlashWindowEx(&flash);
    }
    false
}

#[cfg(not(target_os = "windows"))]
pub fn focus_vrchat_window() -> bool {
    false
}

#[cfg(not(target_os = "windows"))]
pub fn focus_vrchat_window_for_process(_process_id: u32) -> bool {
    false
}
