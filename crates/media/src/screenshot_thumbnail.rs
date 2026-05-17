use std::path::{Path, PathBuf};

use fast_image_resize::{FilterType as FirFilterType, ResizeAlg, ResizeOptions, Resizer};
use sha2::{Digest, Sha256};

use crate::error::Error;

const THUMBNAIL_WIDTH: u32 = 320;
const THUMBNAIL_HEIGHT: u32 = 180;
const THUMBNAIL_DIMENSION_KEY: &str = "cover_16x9";
const THUMBNAIL_RESIZE_FILTER_KEY: &str = "fir_hamming";
const THUMBNAIL_SHARPEN_KEY: &str = "unsharpen_0_35_8";
const THUMBNAIL_SHARPEN_SIGMA: f32 = 0.35;
const THUMBNAIL_SHARPEN_THRESHOLD: i32 = 8;
const THUMBNAIL_WEBP_QUALITY: f32 = 90.0;
const THUMBNAIL_MAX_SOURCE_BYTES: i64 = 128 * 1024 * 1024;
const THUMBNAIL_MAX_SOURCE_PIXELS: u64 = 100_000_000;

#[derive(Clone, Debug)]
pub struct ScreenshotThumbnailFile {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub modified_at: i64,
}

pub fn unix_time_millis(time: std::time::SystemTime) -> i64 {
    time.duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn screenshot_thumbnail_cache_key(path: &str, size_bytes: i64, modified_at: i64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(b"\0");
    hasher.update(size_bytes.to_le_bytes());
    hasher.update(modified_at.to_le_bytes());
    hasher.update(THUMBNAIL_DIMENSION_KEY.as_bytes());
    hasher.update(THUMBNAIL_WIDTH.to_le_bytes());
    hasher.update(THUMBNAIL_HEIGHT.to_le_bytes());
    hasher.update(THUMBNAIL_RESIZE_FILTER_KEY.as_bytes());
    hasher.update(THUMBNAIL_SHARPEN_KEY.as_bytes());
    hasher.update(THUMBNAIL_WEBP_QUALITY.to_le_bytes());
    hasher.update(b"webp");
    hex::encode(hasher.finalize())
}

pub fn screenshot_thumbnail_source_state(path: &Path) -> Result<(i64, i64), Error> {
    let metadata = std::fs::metadata(path)?;
    let modified_at = metadata
        .modified()
        .map(unix_time_millis)
        .unwrap_or_default();
    Ok((metadata.len() as i64, modified_at))
}

pub fn screenshot_thumbnail_files(cache_dir: &Path) -> Vec<ScreenshotThumbnailFile> {
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("webp"))
        })
        .filter_map(|path| {
            let metadata = std::fs::metadata(&path).ok()?;
            let modified_at = metadata
                .modified()
                .map(unix_time_millis)
                .unwrap_or_default();
            Some(ScreenshotThumbnailFile {
                path,
                size_bytes: metadata.len(),
                modified_at,
            })
        })
        .collect()
}

pub fn screenshot_thumbnail_cache_size(cache_dir: &Path) -> u64 {
    screenshot_thumbnail_files(cache_dir)
        .into_iter()
        .map(|file| file.size_bytes)
        .sum()
}

pub fn validate_screenshot_thumbnail_source(
    path: &Path,
    size_bytes: i64,
) -> Result<(u32, u32), Error> {
    if size_bytes > THUMBNAIL_MAX_SOURCE_BYTES {
        return Err(Error::Custom(
            "Screenshot image is too large for thumbnailing.".into(),
        ));
    }

    let (width, height) = image::image_dimensions(path)
        .map_err(|error| Error::Custom(format!("read screenshot dimensions: {error}")))?;
    let pixels = u64::from(width) * u64::from(height);
    if pixels > THUMBNAIL_MAX_SOURCE_PIXELS {
        return Err(Error::Custom(
            "Screenshot image is too large for thumbnailing.".into(),
        ));
    }

    Ok((width, height))
}

pub fn encode_screenshot_thumbnail_webp(source_path: &Path) -> Result<Vec<u8>, Error> {
    let image = image::open(source_path)
        .map_err(|error| Error::Custom(format!("decode screenshot thumbnail: {error}")))?;

    let rgba_image = image.into_rgba8();
    let mut thumbnail_rgba = image::RgbaImage::new(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    let mut resizer = Resizer::new();
    let resize_options = ResizeOptions::new()
        .resize_alg(ResizeAlg::Convolution(FirFilterType::Hamming))
        .fit_into_destination(Some((0.5, 0.5)));
    resizer
        .resize(&rgba_image, &mut thumbnail_rgba, Some(&resize_options))
        .map_err(|error| Error::Custom(format!("resize screenshot thumbnail: {error}")))?;

    let thumbnail = image::DynamicImage::ImageRgba8(thumbnail_rgba)
        .unsharpen(THUMBNAIL_SHARPEN_SIGMA, THUMBNAIL_SHARPEN_THRESHOLD);

    let encoder = webp::Encoder::from_image(&thumbnail)
        .map_err(|error| Error::Custom(format!("prepare WebP thumbnail: {error}")))?;
    Ok(encoder.encode(THUMBNAIL_WEBP_QUALITY).as_ref().to_vec())
}

pub fn write_thumbnail_atomically(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| Error::Custom("Invalid thumbnail cache path.".into()))?;
    let temp_path = path.with_file_name(format!(
        "{file_name}.{}.{}.tmp",
        std::process::id(),
        unix_time_millis(std::time::SystemTime::now())
    ));
    std::fs::write(&temp_path, bytes)?;
    if path.is_file() {
        let _ = std::fs::remove_file(&temp_path);
        return Ok(());
    }
    match std::fs::rename(&temp_path, path) {
        Ok(()) => Ok(()),
        Err(_) if path.is_file() => {
            let _ = std::fs::remove_file(&temp_path);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(Error::Io(error))
        }
    }
}
