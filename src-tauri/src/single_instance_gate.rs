#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{CreateMutexW, ReleaseMutex};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, SendMessageW, WM_COPYDATA};

#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(target_os = "windows")]
const SINGLE_INSTANCE_MUTEX_NAME: &str = r"Local\VRCX-0.App.SingleInstanceGuard";
#[cfg(target_os = "windows")]
const SINGLE_INSTANCE_HANDOFF_RETRIES: usize = 15;
#[cfg(target_os = "windows")]
const SINGLE_INSTANCE_HANDOFF_INTERVAL: Duration = Duration::from_millis(200);

// Mirrors tauri-plugin-single-instance 2.x Windows transport so the early guard
// can still wake the already-running app before Tauri finishes initializing.
#[cfg(target_os = "windows")]
const TAURI_SINGLE_INSTANCE_CLASS_NAME: &str = "com.vrcx-0.app-sic";
#[cfg(target_os = "windows")]
const TAURI_SINGLE_INSTANCE_WINDOW_NAME: &str = "com.vrcx-0.app-siw";
#[cfg(target_os = "windows")]
const WMCOPYDATA_SINGLE_INSTANCE_DATA: usize = 1542;

#[cfg(any(target_os = "windows", test))]
enum AcquireAttempt<T> {
    Acquired(T),
    Contended,
    Failed,
}

#[cfg(any(target_os = "windows", test))]
fn acquire_or_notify_with_retry<T>(
    retries: usize,
    mut acquire: impl FnMut() -> AcquireAttempt<T>,
    mut notify: impl FnMut() -> bool,
    mut wait: impl FnMut(),
) -> Option<T> {
    for attempt in 0..=retries {
        match acquire() {
            AcquireAttempt::Acquired(guard) => return Some(guard),
            AcquireAttempt::Failed => {
                notify();
                return None;
            }
            AcquireAttempt::Contended => {
                if notify() || attempt == retries {
                    return None;
                }
                wait();
            }
        }
    }
    None
}

pub(crate) struct SingleInstanceGuard {
    #[cfg(target_os = "windows")]
    handle: HANDLE,
}

#[cfg(target_os = "windows")]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        unsafe {
            ReleaseMutex(self.handle);
            CloseHandle(self.handle);
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn try_acquire_or_notify_existing() -> Option<SingleInstanceGuard> {
    let mutex_name = encode_wide(SINGLE_INSTANCE_MUTEX_NAME);
    acquire_or_notify_with_retry(
        SINGLE_INSTANCE_HANDOFF_RETRIES,
        || try_acquire_windows_mutex(&mutex_name),
        notify_tauri_single_instance_window,
        || std::thread::sleep(SINGLE_INSTANCE_HANDOFF_INTERVAL),
    )
}

#[cfg(target_os = "windows")]
fn try_acquire_windows_mutex(mutex_name: &[u16]) -> AcquireAttempt<SingleInstanceGuard> {
    let handle = unsafe { CreateMutexW(std::ptr::null(), true.into(), mutex_name.as_ptr()) };
    if handle.is_null() {
        return AcquireAttempt::Failed;
    }

    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe {
            CloseHandle(handle);
        }
        return AcquireAttempt::Contended;
    }

    AcquireAttempt::Acquired(SingleInstanceGuard { handle })
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn try_acquire_or_notify_existing() -> Option<SingleInstanceGuard> {
    Some(SingleInstanceGuard {})
}

#[cfg(target_os = "windows")]
fn notify_tauri_single_instance_window() -> bool {
    let class_name = encode_wide(TAURI_SINGLE_INSTANCE_CLASS_NAME);
    let window_name = encode_wide(TAURI_SINGLE_INSTANCE_WINDOW_NAME);
    let hwnd = unsafe { FindWindowW(class_name.as_ptr(), window_name.as_ptr()) };
    if hwnd.is_null() {
        return false;
    }

    let cwd = std::env::current_dir().unwrap_or_default();
    let cwd = cwd.to_str().unwrap_or_default();
    let args = std::env::args().collect::<Vec<String>>().join("|");
    let data = format!("{cwd}|{args}\0");
    let bytes = data.as_bytes();
    let copy_data = COPYDATASTRUCT {
        dwData: WMCOPYDATA_SINGLE_INSTANCE_DATA,
        cbData: bytes.len() as _,
        lpData: bytes.as_ptr() as _,
    };
    unsafe {
        SendMessageW(hwnd, WM_COPYDATA, 0, &copy_data as *const _ as _);
    }
    true
}

#[cfg(target_os = "windows")]
fn encode_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::{acquire_or_notify_with_retry, AcquireAttempt};

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn non_windows_keeps_the_early_gate_non_blocking() {
        assert!(super::try_acquire_or_notify_existing().is_some());
    }

    #[test]
    fn acquires_without_notifying_or_waiting() {
        let mut notifications = 0;
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry(
            3,
            || AcquireAttempt::Acquired("guard"),
            || {
                notifications += 1;
                false
            },
            || waits += 1,
        );

        assert_eq!(guard, Some("guard"));
        assert_eq!(notifications, 0);
        assert_eq!(waits, 0);
    }

    #[test]
    fn notifies_a_running_instance_without_waiting() {
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry::<()>(
            3,
            || AcquireAttempt::Contended,
            || true,
            || waits += 1,
        );

        assert!(guard.is_none());
        assert_eq!(waits, 0);
    }

    #[test]
    fn waits_for_restart_handoff_when_the_window_is_gone() {
        let mut attempts = VecDeque::from([
            AcquireAttempt::Contended,
            AcquireAttempt::Contended,
            AcquireAttempt::Acquired("guard"),
        ]);
        let mut notifications = 0;
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry(
            3,
            || attempts.pop_front().unwrap(),
            || {
                notifications += 1;
                false
            },
            || waits += 1,
        );

        assert_eq!(guard, Some("guard"));
        assert_eq!(notifications, 2);
        assert_eq!(waits, 2);
    }

    #[test]
    fn stops_after_the_handoff_budget_is_exhausted() {
        let mut attempts = 0;
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry::<()>(
            2,
            || {
                attempts += 1;
                AcquireAttempt::Contended
            },
            || false,
            || waits += 1,
        );

        assert!(guard.is_none());
        assert_eq!(attempts, 3);
        assert_eq!(waits, 2);
    }

    #[test]
    fn does_not_retry_an_unavailable_mutex_api() {
        let mut notifications = 0;
        let mut waits = 0;

        let guard = acquire_or_notify_with_retry::<()>(
            3,
            || AcquireAttempt::Failed,
            || {
                notifications += 1;
                false
            },
            || waits += 1,
        );

        assert!(guard.is_none());
        assert_eq!(notifications, 1);
        assert_eq!(waits, 0);
    }
}
