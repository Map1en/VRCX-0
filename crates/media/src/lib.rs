//! Image, screenshot, upload-file, and metadata processing.
//!
//! This crate owns media transformations and file-format logic. It must not
//! depend on Tauri, SQLite repositories, VRChat HTTP transport, or runtime
//! orchestration.

pub mod error;
pub mod image_cache;
pub mod image_processing;
pub mod media_files;
pub mod png;
pub mod screenshot_metadata;
pub mod screenshot_thumbnail;
pub mod ugc_image_files;

pub use error::Error;
