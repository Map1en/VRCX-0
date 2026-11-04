use super::*;
use crate::png::generate_text_chunk;
use image::RgbImage;

const SECRET: &[u8] = b"secret players";

fn has_secret(bytes: &[u8]) -> bool {
    bytes.windows(SECRET.len()).any(|window| window == SECRET)
}

fn noisy(width: u32, height: u32) -> DynamicImage {
    let mut state = 0x9E37_79B9_u32;
    DynamicImage::ImageRgb8(RgbImage::from_fn(width, height, |_, _| {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        let [r, g, b, _] = state.to_be_bytes();
        image::Rgb([r, g, b])
    }))
}

struct TempPng(std::path::PathBuf);

impl Drop for TempPng {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn tagged_file(name: &str, image: &DynamicImage) -> (TempPng, Vec<u8>) {
    let plain = encode_png(image).unwrap();
    let chunk = generate_text_chunk("Description", "secret players").to_bytes();
    let path = std::env::temp_dir().join(format!("vrcx0-share-{}-{name}.png", std::process::id()));
    std::fs::write(&path, with_metadata(&plain, &chunk)).unwrap();
    (TempPng(path), plain)
}

fn dimensions(data: &[u8]) -> (u32, u32) {
    let decoded = image::load_from_memory(data).unwrap();
    (decoded.width(), decoded.height())
}

#[test]
fn fitting_png_is_sent_without_metadata_in_compressed_tiers() {
    let (file, plain) = tagged_file("fits", &noisy(64, 32));
    for compression in [
        ScreenshotShareCompression::High,
        ScreenshotShareCompression::Standard,
    ] {
        let shared =
            encode_screenshot_share(std::fs::read(&file.0).unwrap(), compression, true).unwrap();
        assert!(!shared.jpeg);
        assert_eq!(shared.data, plain);
    }
}

#[test]
fn original_keeps_metadata_only_when_asked() {
    let (file, plain) = tagged_file("keep", &noisy(64, 32));
    let stripped = encode_screenshot_share(
        std::fs::read(&file.0).unwrap(),
        ScreenshotShareCompression::Original,
        false,
    )
    .unwrap();
    assert_eq!(stripped.data, plain);
    let kept = encode_screenshot_share(
        std::fs::read(&file.0).unwrap(),
        ScreenshotShareCompression::Original,
        true,
    )
    .unwrap();
    assert!(has_secret(&kept.data));
    assert_eq!(
        image::load_from_memory(&kept.data).unwrap().to_rgb8(),
        image::load_from_memory(&plain).unwrap().to_rgb8()
    );
}

#[test]
fn oversized_png_becomes_jpeg_within_the_tier_without_metadata() {
    let (file, plain) = tagged_file("lossy", &noisy(4000, 2000));
    assert!(plain.len() > HIGH_QUALITY_MAX_BYTES);
    for (compression, limit) in [
        (ScreenshotShareCompression::High, HIGH_QUALITY_MAX_BYTES),
        (ScreenshotShareCompression::Standard, STANDARD_MAX_BYTES),
    ] {
        let shared =
            encode_screenshot_share(std::fs::read(&file.0).unwrap(), compression, true).unwrap();
        assert!(shared.jpeg);
        assert!(shared.data.len() <= limit);
        assert!(!has_secret(&shared.data));
        assert_eq!(
            image::guess_format(&shared.data).unwrap(),
            image::ImageFormat::Jpeg
        );
    }
}

#[test]
fn original_mode_never_recompresses() {
    let (file, plain) = tagged_file("original", &noisy(4000, 2000));
    let shared = encode_screenshot_share(
        std::fs::read(&file.0).unwrap(),
        ScreenshotShareCompression::Original,
        false,
    )
    .unwrap();
    assert!(!shared.jpeg);
    assert_eq!(shared.data, plain);
}

#[test]
fn jpeg_steps_down_the_long_edge_until_it_fits() {
    let image = noisy(4000, 2000).to_rgb8();
    let full = encode_jpeg(&image).unwrap();
    let shared = encode_fitting_jpeg(&image, full.len() - 1).unwrap();
    assert_eq!(dimensions(&shared), (3840, 1920));
}

#[test]
fn transparent_pixels_flatten_onto_black() {
    let image = DynamicImage::ImageRgba8(image::RgbaImage::from_fn(2, 1, |x, _| {
        if x == 0 {
            image::Rgba([200, 100, 50, 0])
        } else {
            image::Rgba([200, 100, 50, 255])
        }
    }));
    let flat = flatten_on_black(image);
    assert_eq!(flat.get_pixel(0, 0).0, [0, 0, 0]);
    assert_eq!(flat.get_pixel(1, 0).0, [200, 100, 50]);
}

#[test]
fn rejects_non_png_and_truncated_input() {
    assert!(split_png_metadata(b"not a png").is_none());
    let plain = encode_png(&noisy(8, 8)).unwrap();
    assert!(split_png_metadata(&plain[..plain.len() - 4]).is_none());
}
