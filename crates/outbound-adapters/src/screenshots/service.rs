use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use crate::{Error, Result};
pub use vrcx_0_core::screenshots::{
    ScreenshotFolderTree, ScreenshotLibraryImage, ScreenshotLibraryScanStatus, ScreenshotMetadata,
    ScreenshotSearchResult, ScreenshotSearchType, ScreenshotTimeWindow, ScreenshotWindowImages,
};
use vrcx_0_media::png;
use vrcx_0_media::screenshot_metadata as media_metadata;
use vrcx_0_media::screenshot_metadata::PngDimensions;
use vrcx_0_media::screenshot_thumbnail::{
    encode_screenshot_thumbnail_webp, screenshot_thumbnail_cache_key,
    screenshot_thumbnail_cache_size, screenshot_thumbnail_files, screenshot_thumbnail_source_state,
    validate_screenshot_thumbnail_source as validate_thumbnail_media_source,
    write_thumbnail_atomically,
};
use vrcx_0_persistence::screenshot_cache::MetadataCacheDb;
use vrcx_0_persistence::screenshot_cache::{
    ScreenshotLibraryEntry, SCREENSHOT_LIBRARY_INDEX_VERSION,
};

mod export;
mod favorites;
mod library;
mod metadata;
mod paths;
mod thumbnail;

pub use export::{total_screenshot_export_bytes, write_screenshots_zip, ScreenshotExportOutcome};
pub use favorites::{LocalScreenshotFavoriteStore, LocalScreenshotLibraryAdapter};
pub use library::{
    find_screenshots, forget_screenshot_file, list_screenshot_folder_images,
    list_screenshots_in_windows, list_world_screenshots, random_screenshot_path_in_folder_tree,
    screenshot_folder_tree, start_screenshot_library_scan,
};
pub use metadata::{
    add_screenshot_metadata, delete_all_screenshot_metadata, extra_screenshot_data,
    find_screenshot_search_results, last_screenshot, screenshot_metadata_json,
};
pub use thumbnail::ensure_screenshot_thumbnail;

pub fn can_decode_image(path: &Path) -> bool {
    media_metadata::can_decode_image(path)
}

pub fn delete_text_metadata(path: &str, delete_vrchat_metadata: bool) -> bool {
    media_metadata::delete_text_metadata(path, delete_vrchat_metadata)
}

pub fn get_screenshot_metadata(path: &str) -> Option<ScreenshotMetadata> {
    media_metadata::get_screenshot_metadata(path)
}

pub fn has_vrcx_metadata(path: &str) -> bool {
    media_metadata::has_vrcx_metadata(path)
}

pub fn is_png_file(path: &str) -> bool {
    media_metadata::is_png_file(path)
}

pub fn read_png_dimensions(path: &str) -> PngDimensions {
    media_metadata::read_png_dimensions(path)
}

pub fn write_vrcx_metadata(text: &str, path: &str) -> bool {
    media_metadata::write_vrcx_metadata(text, path)
}

pub fn is_vrchat_screenshot_file_path(path: impl AsRef<Path>) -> bool {
    paths::is_vrchat_screenshot_path(path.as_ref())
}

pub fn is_screenshot_library_file_path(
    path: impl AsRef<Path>,
    root_path: impl AsRef<Path>,
) -> bool {
    let path = path.as_ref();
    paths::is_png_path(path)
        && is_path_inside_directory(path, root_path.as_ref())
        && !metadata::is_screenshot_content_asset_path(path)
}

pub fn is_managed_screenshot_file_path(
    path: impl AsRef<Path>,
    root_path: impl AsRef<Path>,
) -> bool {
    let path = path.as_ref();
    is_vrchat_screenshot_file_path(path) || is_screenshot_library_file_path(path, root_path)
}

pub fn is_path_inside_directory(path: &Path, directory: &Path) -> bool {
    let Ok(path) = path.canonicalize() else {
        return false;
    };
    let Ok(directory) = directory.canonicalize() else {
        return false;
    };
    path.starts_with(directory)
}
