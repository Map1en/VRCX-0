use std::path::Path;
#[cfg(target_os = "linux")]
use std::process::Command;
#[cfg(windows)]
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};
use serde::Serialize;
use vrcx_0_platform::Error;

#[cfg(windows)]
const WINDOWS_CLIPBOARD_OPEN_RETRY_COUNT: usize = 5;
#[cfg(windows)]
const WINDOWS_CLIPBOARD_OPEN_RETRY_DELAY: Duration = Duration::from_millis(5);

const CLIPBOARD_IMAGE_FILE_NAME: &str = "clipboard.png";
const MAX_CLIPBOARD_IMAGE_FILE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImage {
    pub file_name: String,
    pub mime_type: String,
    pub data_base64: String,
}

pub fn get_clipboard_text() -> Result<String, Error> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| Error::Custom(format!("clipboard: {e}")))?;
    Ok(clipboard.get_text().unwrap_or_default())
}

pub fn read_clipboard_image() -> Result<Option<ClipboardImage>, Error> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| Error::Custom(format!("clipboard: {e}")))?;

    let image_path = clipboard
        .get()
        .file_list()
        .unwrap_or_default()
        .into_iter()
        .find(|path| path.is_file() && image_mime_type(path).is_some());
    if let Some(path) = image_path {
        return read_clipboard_image_file(&path).map(Some);
    }

    let image = match clipboard.get().image() {
        Ok(image) => image,
        Err(arboard::Error::ContentNotAvailable) => return Ok(None),
        Err(e) => return Err(Error::Custom(format!("clipboard image: {e}"))),
    };
    let png = encode_rgba_png(image.width, image.height, &image.bytes)?;
    Ok(Some(ClipboardImage {
        file_name: CLIPBOARD_IMAGE_FILE_NAME.into(),
        mime_type: "image/png".into(),
        data_base64: B64.encode(png),
    }))
}

fn read_clipboard_image_file(path: &Path) -> Result<ClipboardImage, Error> {
    let size = std::fs::metadata(path)
        .map_err(|e| Error::Custom(format!("read clipboard image {}: {e}", path.display())))?
        .len();
    if size > MAX_CLIPBOARD_IMAGE_FILE_BYTES {
        return Err(Error::Custom(format!(
            "clipboard image is larger than {} MB: {}",
            MAX_CLIPBOARD_IMAGE_FILE_BYTES / (1024 * 1024),
            path.display()
        )));
    }
    let bytes = std::fs::read(path)
        .map_err(|e| Error::Custom(format!("read clipboard image {}: {e}", path.display())))?;
    let mime_type = vrcx_0_core::image_sniff::sniff_image_mime(&bytes)
        .filter(|mime| *mime != "image/tiff")
        .ok_or_else(|| Error::Custom(format!("unsupported image format: {}", path.display())))?;
    Ok(ClipboardImage {
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| CLIPBOARD_IMAGE_FILE_NAME.into()),
        mime_type: mime_type.into(),
        data_base64: B64.encode(bytes),
    })
}

fn encode_rgba_png(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>, Error> {
    let width =
        u32::try_from(width).map_err(|_| Error::Custom("clipboard image too wide".into()))?;
    let height =
        u32::try_from(height).map_err(|_| Error::Custom("clipboard image too tall".into()))?;
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(rgba, width, height, ExtendedColorType::Rgba8)
        .map_err(|e| Error::Custom(format!("encode clipboard image: {e}")))?;
    Ok(png)
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "bmp" => Some("image/bmp"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn is_supported_image_path(path: &Path) -> bool {
    image_mime_type(path).is_some()
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
        Ok(())
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
    fn clipboard_bitmap_is_encoded_as_png_with_original_size() -> Result<(), Error> {
        let rgba = [255u8, 0, 0, 255].repeat(6);
        let png = encode_rgba_png(3, 2, &rgba)?;
        let decoded = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
            .map_err(|e| Error::Custom(format!("decode png: {e}")))?;

        assert_eq!((decoded.width(), decoded.height()), (3, 2));
        assert_eq!(decoded.to_rgba8().into_raw(), rgba);
        Ok(())
    }

    const JPEG_BYTES: &[u8] = b"\xFF\xD8\xFF\xE0jpeg-bytes";

    fn clipboard_test_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("vrcx-0-clipboard-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copied_image_file_keeps_its_name_and_type() -> Result<(), Error> {
        let dir = clipboard_test_dir("name");
        let path = dir.join("sea.JPG");
        std::fs::write(&path, JPEG_BYTES).map_err(|e| Error::Custom(e.to_string()))?;

        let image = read_clipboard_image_file(&path)?;
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(image.file_name, "sea.JPG");
        assert_eq!(image.mime_type, "image/jpeg");
        assert_eq!(image.data_base64, B64.encode(JPEG_BYTES));
        Ok(())
    }

    #[test]
    fn a_copied_file_reports_the_type_of_its_content() -> Result<(), Error> {
        let dir = clipboard_test_dir("content-type");
        let path = dir.join("renamed.png");
        std::fs::write(&path, JPEG_BYTES).map_err(|e| Error::Custom(e.to_string()))?;

        let image = read_clipboard_image_file(&path)?;
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(image.mime_type, "image/jpeg");
        Ok(())
    }

    #[test]
    fn a_copied_file_that_is_not_an_image_is_rejected() {
        let dir = clipboard_test_dir("not-image");
        let path = dir.join("clip.png");
        std::fs::write(&path, b"not an image").unwrap();

        let result = read_clipboard_image_file(&path);
        let _ = std::fs::remove_dir_all(&dir);

        assert!(result.is_err());
    }

    #[test]
    fn an_oversized_copied_file_is_rejected_without_reading_it() {
        let dir = clipboard_test_dir("oversized");
        let path = dir.join("huge.png");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_CLIPBOARD_IMAGE_FILE_BYTES + 1).unwrap();
        drop(file);

        let result = read_clipboard_image_file(&path);
        let _ = std::fs::remove_dir_all(&dir);

        assert!(result.is_err());
    }

    #[test]
    #[cfg(windows)]
    fn windows_file_drop_list_encodes_screenshot_path_for_paste_targets() -> Result<(), Error> {
        let path = Path::new(r"C:\Users\Example\Pictures\VRChat\VRChat_2026-05-08.png");
        let data = build_windows_file_drop_list(path)?;

        assert_eq!(u32::from_le_bytes(data[0..4].try_into().unwrap()), 20);
        assert_eq!(u32::from_le_bytes(data[16..20].try_into().unwrap()), 1);

        let wide_path: Vec<u16> = data[20..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|chunk| u16::from_le_bytes(*chunk))
            .collect();
        let first_nul = wide_path.iter().position(|value| *value == 0).unwrap();
        let decoded_path = String::from_utf16(&wide_path[..first_nul])
            .map_err(|e| Error::Custom(format!("decode path: {e}")))?;

        assert_eq!(decoded_path, path.to_string_lossy());
        assert_eq!(wide_path[first_nul + 1], 0);
        Ok(())
    }
}
