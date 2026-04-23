#![allow(non_snake_case)]

use std::path::{Component, Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use fast_rsync::{Signature, SignatureOptions};
use tauri::{AppHandle, State};

use crate::domain::png::{self as png_mod, ChunkType};
use crate::error::AppError;
use crate::state::AppState;

const MAX_IMAGE_SAVE_BYTES: usize = 100 * 1024 * 1024;

#[tauri::command]
pub async fn app__save_image_file(
    app_handle: AppHandle,
    default_name: String,
    base64_data: String,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let file_name = normalize_image_save_file_name(&default_name)?;
    let bytes = B64
        .decode(base64_data.trim())
        .map_err(|e| AppError::Custom(format!("image base64 decode: {e}")))?;

    if bytes.is_empty() {
        return Err(AppError::Custom("image data is empty".into()));
    }

    if bytes.len() > MAX_IMAGE_SAVE_BYTES {
        return Err(AppError::Custom("image data is too large".into()));
    }

    let result = app_handle
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("Image Files", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_save_file();

    match result {
        Some(file_path) => {
            let mut path = match file_path {
                tauri_plugin_dialog::FilePath::Path(p) => p,
                other => PathBuf::from(other.to_string()),
            };

            if path.extension().is_none() {
                path.set_extension(default_image_extension(&file_name));
            }

            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            std::fs::write(&path, bytes)?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Ok(String::new()),
    }
}

#[tauri::command]
pub async fn app__get_image(
    state: State<'_, AppState>,
    url: String,
    file_id: String,
    version: String,
) -> Result<String, AppError> {
    state.image_cache.get_image(&url, &file_id, &version).await
}

#[tauri::command]
pub fn app__resize_image_to_fit_limits(base64data: String) -> Result<String, AppError> {
    const MAX_WIDTH: u32 = 2000;
    const MAX_HEIGHT: u32 = 2000;
    const MAX_SIZE: usize = 10_000_000;

    let raw = B64
        .decode(&base64data)
        .map_err(|e| AppError::Custom(format!("base64 decode: {e}")))?;
    let mut img =
        image::load_from_memory(&raw).map_err(|e| AppError::Custom(format!("load image: {e}")))?;

    if img.width() > MAX_WIDTH {
        let factor = img.width() as f64 / MAX_WIDTH as f64;
        let new_h = (img.height() as f64 / factor).round() as u32;
        img = img.resize_exact(MAX_WIDTH, new_h, image::imageops::FilterType::Lanczos3);
    }
    if img.height() > MAX_HEIGHT {
        let factor = img.height() as f64 / MAX_HEIGHT as f64;
        let new_w = (img.width() as f64 / factor).round() as u32;
        img = img.resize_exact(new_w, MAX_HEIGHT, image::imageops::FilterType::Lanczos3);
    }

    let encode_png = |img: &image::DynamicImage| -> Result<Vec<u8>, AppError> {
        let mut buf = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut buf);
        img.write_with_encoder(encoder)
            .map_err(|e| AppError::Custom(format!("png encode: {e}")))?;
        Ok(buf)
    };

    let mut buf = encode_png(&img)?;

    for _ in 0..250 {
        if buf.len() < MAX_SIZE {
            break;
        }
        let (w, h) = (img.width(), img.height());
        let (new_w, new_h) = if w > h {
            let nw = w - 25;
            let nh = (h as f64 / (w as f64 / nw as f64)).round() as u32;
            (nw, nh)
        } else {
            let nh = h - 25;
            let nw = (w as f64 / (h as f64 / nh as f64)).round() as u32;
            (nw, nh)
        };
        img = img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3);
        buf = encode_png(&img)?;
        if buf.len() < MAX_SIZE {
            break;
        }
    }

    if buf.len() >= MAX_SIZE {
        return Err(AppError::Custom(
            "Failed to get image into target filesize.".into(),
        ));
    }

    Ok(B64.encode(&buf))
}

#[tauri::command]
pub fn app__sign_file(blob: String) -> Result<String, AppError> {
    let data = B64
        .decode(&blob)
        .map_err(|e| AppError::Custom(format!("base64 decode: {e}")))?;
    let sig = Signature::calculate(
        &data,
        SignatureOptions {
            block_size: 2048,
            crypto_hash_size: 8,
        },
    );
    Ok(B64.encode(sig.serialized()))
}

#[tauri::command]
pub fn app__crop_all_prints(ugc_folder_path: String) -> Result<(), AppError> {
    let folder = PathBuf::from(&ugc_folder_path).join("Prints");
    if !folder.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(&folder) {
        let entry = entry.map_err(|e| AppError::Custom(format!("walk dir: {e}")))?;
        let p = entry.path();
        if p.extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("png"))
        {
            crop_print_impl(p).map_err(|e| AppError::Custom(format!("{}: {e}", p.display())))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn app__crop_print_image(path: String) -> Result<bool, AppError> {
    crop_print_impl(std::path::Path::new(&path))
        .map_err(|e| AppError::Custom(format!("{path}: {e}")))
}

fn crop_print_impl(path: &std::path::Path) -> Result<bool, Box<dyn std::error::Error>> {
    let img = image::open(path)?;
    if img.width() != 2048 || img.height() != 1440 {
        return Ok(false);
    }
    let cropped = img.crop_imm(64, 69, 1920, 1080);

    let temp_path = {
        let mut t = path.as_os_str().to_owned();
        t.push(".temp");
        PathBuf::from(t)
    };
    cropped.save_with_format(&temp_path, image::ImageFormat::Png)?;

    {
        let old_path_str = path.to_string_lossy();
        let mut old_png = png_mod::PngFile::open_read(&old_path_str)?;
        let text_chunks = old_png.get_chunks_of_type(&ChunkType::ITXT);
        if !text_chunks.is_empty() {
            let temp_str = temp_path.to_string_lossy();
            let mut new_png = png_mod::PngFile::open_rw(&temp_str)?;
            for chunk in &text_chunks {
                new_png.write_chunk(chunk);
            }
        }
    }

    for _ in 0..10 {
        match std::fs::copy(&temp_path, path) {
            Ok(_) => {
                let _ = std::fs::remove_file(&temp_path);
                return Ok(true);
            }
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
    }
    let _ = std::fs::remove_file(&temp_path);
    Ok(false)
}

fn sanitize_ugc_component(value: &str, label: &str) -> Result<String, AppError> {
    let mut sanitized = String::with_capacity(value.len());
    for ch in value.trim().chars() {
        if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            sanitized.push('_');
        } else {
            sanitized.push(ch);
        }
    }

    while sanitized.ends_with(' ') || sanitized.ends_with('.') {
        sanitized.pop();
    }

    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        sanitized = "_".into();
    }

    if is_windows_reserved_name(&sanitized) {
        sanitized.insert(0, '_');
    }

    if !is_single_path_component(&sanitized) {
        return Err(AppError::Custom(format!("invalid {label} path component")));
    }

    Ok(sanitized)
}

fn is_single_path_component(value: &str) -> bool {
    let mut components = Path::new(value).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(component)), None) => component == std::ffi::OsStr::new(value),
        _ => false,
    }
}

fn is_windows_reserved_name(value: &str) -> bool {
    let upper = value
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn normalize_image_save_file_name(default_name: &str) -> Result<String, AppError> {
    let candidate = if default_name.trim().is_empty() {
        "image.png"
    } else {
        default_name.trim()
    };
    let mut file_name = sanitize_ugc_component(candidate, "file_name")?;
    if Path::new(&file_name).extension().is_none() {
        file_name.push_str(".png");
    }
    Ok(file_name)
}

fn default_image_extension(file_name: &str) -> &str {
    match Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" => "jpg",
        "jpeg" => "jpeg",
        "gif" => "gif",
        "webp" => "webp",
        "bmp" => "bmp",
        _ => "png",
    }
}

fn build_ugc_image_path(
    ugc_folder_path: &str,
    month_folder: &str,
    file_name: &str,
) -> Result<PathBuf, AppError> {
    if ugc_folder_path.trim().is_empty() {
        return Err(AppError::Custom("UGC folder path is empty".into()));
    }

    let month_folder = sanitize_ugc_component(month_folder, "month_folder")?;
    let file_name = sanitize_ugc_component(file_name, "file_name")?;
    Ok(PathBuf::from(ugc_folder_path)
        .join(month_folder)
        .join(file_name))
}

async fn save_ugc_image_to_file(
    state: &AppState,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    let out = build_ugc_image_path(&ugc_folder_path, &month_folder, &file_name)?;
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let out_str = out.to_string_lossy().into_owned();
    state.image_cache.save_image_to_file(&url, &out_str).await?;
    Ok(out_str)
}

#[tauri::command]
pub async fn app__save_print_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    save_ugc_image_to_file(state.inner(), url, ugc_folder_path, month_folder, file_name).await
}

#[tauri::command]
pub async fn app__save_sticker_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    save_ugc_image_to_file(state.inner(), url, ugc_folder_path, month_folder, file_name).await
}

#[tauri::command]
pub async fn app__save_emoji_to_file(
    state: State<'_, AppState>,
    url: String,
    ugc_folder_path: String,
    month_folder: String,
    file_name: String,
) -> Result<String, AppError> {
    save_ugc_image_to_file(state.inner(), url, ugc_folder_path, month_folder, file_name).await
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_image_file_names() -> Result<(), AppError> {
        assert_eq!(normalize_image_save_file_name("")?, "image.png");
        assert_eq!(normalize_image_save_file_name("avatar")?, "avatar.png");
        assert_eq!(normalize_image_save_file_name("photo.webp")?, "photo.webp");
        assert_eq!(normalize_image_save_file_name("CON")?, "_CON.png");
        assert_eq!(
            normalize_image_save_file_name(" CON <bad>:name?. ")?.as_str(),
            "CON _bad__name_.png"
        );
        Ok(())
    }

    #[test]
    fn builds_ugc_image_paths_from_single_components() -> Result<(), AppError> {
        let path = build_ugc_image_path(r"C:\VRCX\UGC", "2026/04", r"..\avatar:name?.png")?;

        assert_eq!(
            path,
            PathBuf::from(r"C:\VRCX\UGC")
                .join("2026_04")
                .join(".._avatar_name_.png")
        );
        Ok(())
    }
}
