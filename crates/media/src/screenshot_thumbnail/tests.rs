use std::path::{Path, PathBuf};

use image::{GenericImageView, ImageFormat, Rgba, RgbaImage};

use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-screenshot-thumbnail-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn write_png(path: &Path, width: u32, height: u32) {
    RgbaImage::from_pixel(width, height, Rgba([30, 90, 180, 255]))
        .save(path)
        .unwrap();
}

fn write_bmp_header(path: &Path, width: i32, height: i32) {
    let mut bytes = Vec::with_capacity(54);
    bytes.extend_from_slice(b"BM");
    bytes.extend_from_slice(&54_u32.to_le_bytes());
    bytes.extend_from_slice(&[0; 4]);
    bytes.extend_from_slice(&54_u32.to_le_bytes());
    bytes.extend_from_slice(&40_u32.to_le_bytes());
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&24_u16.to_le_bytes());
    bytes.extend_from_slice(&[0; 24]);
    std::fs::write(path, bytes).unwrap();
}

#[test]
fn thumbnail_encoding_produces_a_320_by_180_webp() {
    let dir = TestDir::new("encode");
    let source = dir.path.join("source.png");
    write_png(&source, 64, 32);

    let encoded = encode_screenshot_thumbnail_webp(&source).unwrap();
    let decoded = image::load_from_memory_with_format(&encoded, ImageFormat::WebP).unwrap();

    assert!(matches!(
        image::guess_format(&encoded),
        Ok(ImageFormat::WebP)
    ));
    assert_eq!(decoded.dimensions(), (THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT));
}

#[test]
fn thumbnail_validation_rejects_byte_pixel_and_decode_limits() {
    let dir = TestDir::new("limits");
    let valid = dir.path.join("valid.png");
    write_png(&valid, 2, 3);
    assert_eq!(
        validate_screenshot_thumbnail_source(
            &valid,
            std::fs::metadata(&valid).unwrap().len() as i64
        )
        .unwrap(),
        (2, 3)
    );
    assert!(validate_screenshot_thumbnail_source(&valid, THUMBNAIL_MAX_SOURCE_BYTES + 1).is_err());

    let oversized = dir.path.join("oversized.bmp");
    write_bmp_header(&oversized, 10_001, 10_000);
    assert!(validate_screenshot_thumbnail_source(
        &oversized,
        std::fs::metadata(&oversized).unwrap().len() as i64
    )
    .is_err());

    let corrupt = dir.path.join("corrupt.png");
    std::fs::write(&corrupt, b"not an image").unwrap();
    assert!(validate_screenshot_thumbnail_source(
        &corrupt,
        std::fs::metadata(&corrupt).unwrap().len() as i64
    )
    .is_err());
}

#[test]
fn thumbnail_cache_inventory_only_counts_webp_files() {
    let dir = TestDir::new("inventory");
    std::fs::write(dir.path.join("a.webp"), b"one").unwrap();
    std::fs::write(dir.path.join("b.WEBP"), b"three").unwrap();
    std::fs::write(dir.path.join("ignored.png"), b"png").unwrap();
    std::fs::write(dir.path.join("a.webp.1.tmp"), b"temp").unwrap();
    std::fs::create_dir(dir.path.join("directory.webp")).unwrap();

    let mut names = screenshot_thumbnail_files(&dir.path)
        .into_iter()
        .map(|file| {
            file.path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
    names.sort();

    assert_eq!(names, vec!["a.webp", "b.WEBP"]);
    assert_eq!(screenshot_thumbnail_cache_size(&dir.path), 8);
}

#[test]
fn atomic_thumbnail_write_preserves_existing_destination_and_cleans_temp_files() {
    let dir = TestDir::new("atomic");
    let destination = dir.path.join("thumb.webp");

    write_thumbnail_atomically(&destination, b"first").unwrap();
    write_thumbnail_atomically(&destination, b"second").unwrap();

    assert_eq!(std::fs::read(&destination).unwrap(), b"first");
    assert_eq!(std::fs::read_dir(&dir.path).unwrap().count(), 1);
}

#[test]
fn concurrent_atomic_thumbnail_writes_leave_one_complete_file_and_no_temps() {
    let dir = TestDir::new("concurrent-atomic");
    let destination = dir.path.join("thumb.webp");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(8));
    let handles = (0..8)
        .map(|index| {
            let destination = destination.clone();
            let barrier = std::sync::Arc::clone(&barrier);
            std::thread::spawn(move || {
                let bytes = format!("complete-thumbnail-{index}").into_bytes();
                barrier.wait();
                write_thumbnail_atomically(&destination, &bytes).unwrap();
                bytes
            })
        })
        .collect::<Vec<_>>();
    let candidates = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();

    let written = std::fs::read(&destination).unwrap();
    assert!(candidates.contains(&written));
    assert_eq!(std::fs::read_dir(&dir.path).unwrap().count(), 1);
}
