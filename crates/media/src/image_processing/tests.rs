use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};

use crate::error::Error;
use crate::png as png_mod;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn encode_test_png(width: u32, height: u32) -> Result<String, Error> {
    let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        width,
        height,
        image::Rgba([12, 34, 56, 255]),
    ));
    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    img.write_with_encoder(encoder)
        .map_err(|e| Error::Custom(format!("png encode: {e}")))?;
    Ok(B64.encode(buf))
}

fn decode_b64(value: &str) -> Result<Vec<u8>, Error> {
    B64.decode(value)
        .map_err(|e| Error::Custom(format!("base64 decode: {e}")))
}

fn decoded_dimensions(bytes: &[u8]) -> Result<(u32, u32), Error> {
    let img =
        image::load_from_memory(bytes).map_err(|e| Error::Custom(format!("load image: {e}")))?;
    Ok((img.width(), img.height()))
}

#[test]
fn resize_image_to_fit_limits_base64_returns_png_base64() -> Result<(), Error> {
    let input = encode_test_png(16, 12)?;
    let output = super::resize_image_to_fit_limits_base64(&input)?;
    let bytes = decode_b64(&output)?;

    assert!(matches!(
        image::guess_format(&bytes),
        Ok(image::ImageFormat::Png)
    ));
    assert_eq!(decoded_dimensions(&bytes)?, (16, 12));
    Ok(())
}

#[test]
fn resize_upload_image_bytes_pads_matching_dimensions_to_square() -> Result<(), Error> {
    let input = encode_test_png(10, 20)?;
    let output = super::resize_upload_image_bytes(&input, true)?;
    let (width, height) = decoded_dimensions(&output)?;

    assert_eq!(width, height);
    assert_eq!((width, height), (20, 20));
    Ok(())
}

#[test]
fn resize_print_image_bytes_outputs_print_canvas() -> Result<(), Error> {
    let input = encode_test_png(64, 64)?;
    let output = super::resize_print_image_bytes(&input)?;

    assert_eq!(decoded_dimensions(&output)?, (2048, 1440));
    Ok(())
}

#[test]
fn resize_print_image_bytes_handles_wide_images_without_overflow() -> Result<(), Error> {
    let input = encode_test_png(4000, 300)?;
    let output = super::resize_print_image_bytes(&input)?;

    assert_eq!(decoded_dimensions(&output)?, (2048, 1440));
    Ok(())
}

#[test]
fn crop_print_base64_crops_only_2048x1440() -> Result<(), Error> {
    let printable = encode_test_png(2048, 1440)?;
    let cropped = super::crop_print_base64(&printable)?;
    let cropped_bytes = decode_b64(&cropped)?;

    assert_eq!(decoded_dimensions(&cropped_bytes)?, (1920, 1080));

    let untouched = encode_test_png(320, 240)?;
    assert_eq!(super::crop_print_base64(&untouched)?, untouched);
    Ok(())
}

#[test]
fn resize_image_to_fit_limits_base64_downscales_when_over_max_dimensions() -> Result<(), Error> {
    let input = encode_test_png(2500, 2000)?;
    let output = super::resize_image_to_fit_limits_base64(&input)?;
    let (width, height) = decoded_dimensions(&decode_b64(&output)?)?;
    assert_eq!(width, 2000);
    assert_eq!(height, 1600);
    Ok(())
}

#[test]
fn resize_upload_image_bytes_returns_raw_bytes_unchanged_when_already_compliant(
) -> Result<(), Error> {
    let input = encode_test_png(32, 32)?;
    let raw = decode_b64(&input)?;

    let output = super::resize_upload_image_bytes(&input, true)?;

    assert_eq!(output, raw);
    Ok(())
}

#[test]
fn resize_upload_image_bytes_does_not_pad_when_matching_dimensions_is_false() -> Result<(), Error> {
    let input = encode_test_png(10, 20)?;
    let output = super::resize_upload_image_bytes(&input, false)?;
    let (width, height) = decoded_dimensions(&output)?;

    assert_eq!((width, height), (10, 20));
    Ok(())
}

#[test]
fn resize_upload_image_bytes_downscales_oversized_image_preserving_aspect_ratio(
) -> Result<(), Error> {
    let input = encode_test_png(4000, 1000)?;
    let output = super::resize_upload_image_bytes(&input, false)?;
    let (width, height) = decoded_dimensions(&output)?;

    assert_eq!(width, 2000);
    assert_eq!(height, 500);
    Ok(())
}

#[test]
fn crop_print_file_leaves_non_canvas_sized_files_untouched() -> Result<(), Error> {
    let dir = TestDir::new("crop-print-skip");
    let path = dir.path.join("not-a-print.png");
    let input = decode_b64(&encode_test_png(320, 240)?)?;
    std::fs::write(&path, &input)?;

    let cropped = super::crop_print_file(&path)?;

    assert!(!cropped);
    assert_eq!(std::fs::read(&path)?, input);
    Ok(())
}

#[test]
fn crop_all_prints_is_a_no_op_when_the_prints_folder_is_missing() -> Result<(), Error> {
    let dir = TestDir::new("crop-all-missing-folder");

    super::crop_all_prints(&dir.path.to_string_lossy())?;

    Ok(())
}

#[test]
fn crop_all_prints_crops_every_png_under_the_prints_folder() -> Result<(), Error> {
    let dir = TestDir::new("crop-all-prints");
    let prints_folder = dir
        .path
        .join(crate::ugc_image_files::UgcCategory::Prints.folder_name());
    std::fs::create_dir_all(&prints_folder)?;
    let printable_path = prints_folder.join("print.png");
    let input = decode_b64(&encode_test_png(2048, 1440)?)?;
    std::fs::write(&printable_path, input)?;
    std::fs::write(prints_folder.join("notes.txt"), b"not an image")?;

    super::crop_all_prints(&dir.path.to_string_lossy())?;

    let bytes = std::fs::read(&printable_path)?;
    assert_eq!(decoded_dimensions(&bytes)?, (1920, 1080));
    Ok(())
}

#[test]
fn crop_print_file_preserves_itxt_chunks() -> Result<(), Error> {
    let dir = TestDir::new("crop-print-itxt");
    let path = dir.path.join("print.png");
    let input = B64
        .decode(encode_test_png(2048, 1440)?)
        .map_err(|e| Error::Custom(format!("base64 decode: {e}")))?;
    std::fs::write(&path, input)?;

    let path_str = path.to_string_lossy();
    {
        let mut png = png_mod::PngFile::open_rw(&path_str)
            .map_err(|e| Error::Custom(format!("png open: {e}")))?;
        let chunk = png_mod::generate_text_chunk("Description", "{\"source\":\"vrcx\"}");
        assert!(png.write_chunk(&chunk)?);
    }

    assert!(super::crop_print_file(&path)?);

    let bytes = std::fs::read(&path)?;
    assert_eq!(decoded_dimensions(&bytes)?, (1920, 1080));

    let mut png = png_mod::PngFile::open_read(&path_str)
        .map_err(|e| Error::Custom(format!("png read: {e}")))?;
    let metadata = png_mod::read_text_chunk("Description", &mut png, false)
        .ok_or_else(|| Error::Custom("missing png metadata".into()))?;
    assert_eq!(metadata, "{\"source\":\"vrcx\"}");
    Ok(())
}
