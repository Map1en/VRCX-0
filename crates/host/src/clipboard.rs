use std::path::Path;
#[cfg(target_os = "linux")]
use std::process::Command;
#[cfg(windows)]
use std::time::Duration;

use crate::error::Error;

#[cfg(windows)]
const WINDOWS_CLIPBOARD_OPEN_RETRY_COUNT: usize = 5;
#[cfg(windows)]
const WINDOWS_CLIPBOARD_OPEN_RETRY_DELAY: Duration = Duration::from_millis(5);

pub fn get_clipboard_text() -> Result<String, Error> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| Error::Custom(format!("clipboard: {e}")))?;
    Ok(clipboard.get_text().unwrap_or_default())
}

fn is_supported_image_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "bmp" | "gif" | "webp"
    )
}

fn validate_image_path(path: &Path) -> Result<(), Error> {
    if !path.is_file() {
        return Err(Error::Custom(format!(
            "image file does not exist: {}",
            path.display()
        )));
    }

    if !is_supported_image_path(path) {
        return Err(Error::Custom("unsupported image format".into()));
    }

    Ok(())
}

#[cfg(windows)]
fn last_windows_clipboard_error(context: &str) -> Error {
    Error::Custom(format!("{context}: {}", std::io::Error::last_os_error()))
}

#[cfg(windows)]
struct WindowsClipboardGuard;

#[cfg(windows)]
impl Drop for WindowsClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::System::DataExchange::CloseClipboard();
        }
    }
}

#[cfg(windows)]
fn open_windows_clipboard() -> Result<WindowsClipboardGuard, Error> {
    for attempt in 0..WINDOWS_CLIPBOARD_OPEN_RETRY_COUNT {
        if unsafe { windows_sys::Win32::System::DataExchange::OpenClipboard(std::ptr::null_mut()) }
            != 0
        {
            return Ok(WindowsClipboardGuard);
        }

        if attempt + 1 < WINDOWS_CLIPBOARD_OPEN_RETRY_COUNT {
            std::thread::sleep(WINDOWS_CLIPBOARD_OPEN_RETRY_DELAY);
        }
    }

    Err(last_windows_clipboard_error("open clipboard"))
}

#[cfg(windows)]
fn build_windows_file_drop_list(path: &Path) -> Result<Vec<u8>, Error> {
    use std::os::windows::ffi::OsStrExt;

    const DROPFILES_HEADER_SIZE: usize = 20;

    let wide_path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    if wide_path.len() <= 1 {
        return Err(Error::Custom("empty clipboard file path".into()));
    }

    let mut data = Vec::with_capacity(DROPFILES_HEADER_SIZE + (wide_path.len() + 1) * 2);
    data.extend_from_slice(&(DROPFILES_HEADER_SIZE as u32).to_le_bytes());
    data.extend_from_slice(&0i32.to_le_bytes());
    data.extend_from_slice(&0i32.to_le_bytes());
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&1u32.to_le_bytes());

    for code_unit in wide_path {
        data.extend_from_slice(&code_unit.to_le_bytes());
    }
    data.extend_from_slice(&0u16.to_le_bytes());

    Ok(data)
}

#[cfg(windows)]
fn set_windows_file_drop_list(path: &Path) -> Result<(), Error> {
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };

    let data = build_windows_file_drop_list(path)?;
    let _clipboard = open_windows_clipboard()?;

    if unsafe { EmptyClipboard() } == 0 {
        return Err(last_windows_clipboard_error("empty clipboard"));
    }

    let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, data.len()) };
    if handle.is_null() {
        return Err(last_windows_clipboard_error("allocate file drop list"));
    }

    let data_ptr = unsafe { GlobalLock(handle) };
    if data_ptr.is_null() {
        unsafe {
            GlobalFree(handle);
        }
        return Err(last_windows_clipboard_error("lock file drop list"));
    }

    unsafe {
        std::ptr::copy_nonoverlapping(data.as_ptr(), data_ptr.cast::<u8>(), data.len());
        GlobalUnlock(handle);
    }

    if unsafe { SetClipboardData(windows_sys::Win32::System::Ole::CF_HDROP as u32, handle) }
        .is_null()
    {
        unsafe {
            GlobalFree(handle);
        }
        return Err(last_windows_clipboard_error("set file drop list"));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn copy_image_with_xclip(path: &Path) -> Result<(), Error> {
    let output = Command::new("xclip")
        .args(["-selection", "clipboard", "-t", "image/png", "-i"])
        .arg(path)
        .output()
        .map_err(|e| Error::Custom(format!("run xclip: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(Error::Custom(format!(
            "xclip failed with status {}{}{}",
            output.status,
            if stderr.is_empty() { "" } else { ": " },
            if stderr.is_empty() { stdout } else { stderr }
        )));
    }

    Ok(())
}

pub fn copy_image_to_clipboard(path: &str) -> Result<(), Error> {
    let path = Path::new(path);
    validate_image_path(path)?;

    #[cfg(windows)]
    {
        set_windows_file_drop_list(path)?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        copy_image_with_xclip(path)?;
        return Ok(());
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    Err(Error::Custom(
        "copy image to clipboard is unsupported on this platform".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_image_paths_used_by_screenshot_copy() {
        assert!(is_supported_image_path(Path::new("VRChat_2026-05-08.png")));
        assert!(is_supported_image_path(Path::new("VRChat_2026-05-08.JPG")));
        assert!(!is_supported_image_path(Path::new("VRChat_2026-05-08.txt")));
    }

    #[test]
    #[cfg(windows)]
    fn windows_file_drop_list_encodes_screenshot_path_for_paste_targets() -> Result<(), Error> {
        let path = Path::new(r"C:\Users\about\Pictures\VRChat\VRChat_2026-05-08.png");
        let data = build_windows_file_drop_list(path)?;

        assert_eq!(u32::from_le_bytes(data[0..4].try_into().unwrap()), 20);
        assert_eq!(u32::from_le_bytes(data[16..20].try_into().unwrap()), 1);

        let wide_path: Vec<u16> = data[20..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes(chunk.try_into().unwrap()))
            .collect();
        let first_nul = wide_path.iter().position(|value| *value == 0).unwrap();
        let decoded_path = String::from_utf16(&wide_path[..first_nul])
            .map_err(|e| Error::Custom(format!("decode path: {e}")))?;

        assert_eq!(decoded_path, path.to_string_lossy());
        assert_eq!(wide_path[first_nul + 1], 0);
        Ok(())
    }
}
