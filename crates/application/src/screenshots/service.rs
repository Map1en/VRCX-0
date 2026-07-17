use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use crate::{Error, Result};
pub use vrcx_0_core::screenshots::{
    ScreenshotFolderTree, ScreenshotLibraryImage, ScreenshotLibraryScanStatus, ScreenshotMetadata,
    ScreenshotSearchType,
};
use vrcx_0_media::png;
pub use vrcx_0_media::screenshot_metadata::{
    can_decode_image, delete_text_metadata, get_screenshot_metadata, has_vrcx_metadata,
    is_png_file, read_png_dimensions, write_vrcx_metadata,
};
use vrcx_0_media::screenshot_thumbnail::{
    encode_screenshot_thumbnail_webp, screenshot_thumbnail_cache_key,
    screenshot_thumbnail_cache_size, screenshot_thumbnail_files, screenshot_thumbnail_source_state,
    validate_screenshot_thumbnail_source as validate_thumbnail_media_source,
    write_thumbnail_atomically,
};
pub use vrcx_0_persistence::screenshot_cache::MetadataCacheDb;
use vrcx_0_persistence::screenshot_cache::{
    ScreenshotLibraryEntry, SCREENSHOT_LIBRARY_INDEX_VERSION,
};

mod library;
mod metadata;
mod paths;
mod thumbnail;

pub use library::{
    find_screenshots, list_screenshot_folder_images, list_world_screenshots,
    screenshot_folder_tree, start_screenshot_library_scan,
};
pub use metadata::{
    add_screenshot_metadata, delete_all_screenshot_metadata, extra_screenshot_data,
    find_screenshots_json, last_screenshot, screenshot_metadata_json,
};
pub use thumbnail::ensure_screenshot_thumbnail;

pub fn is_vrchat_screenshot_file_path(path: impl AsRef<Path>) -> bool {
    paths::is_vrchat_screenshot_path(path.as_ref())
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
