use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine};

use crate::error::Error;
use crate::png::{self as png_mod, ChunkType};

const MAX_IMAGE_WIDTH: u32 = 2000;
const MAX_IMAGE_HEIGHT: u32 = 2000;
const MAX_IMAGE_SIZE: usize = 10_000_000;
const PRINT_CONTENT_WIDTH: u32 = 1920;
const PRINT_CONTENT_HEIGHT: u32 = 1080;
const PRINT_CANVAS_WIDTH: u32 = 2048;
const PRINT_CANVAS_HEIGHT: u32 = 1440;
const PRINT_OFFSET_X: u32 = 64;
const PRINT_OFFSET_Y: u32 = 69;

pub fn resize_image_to_fit_limits_base64(base64data: &str) -> Result<String, Error> {
    let raw = B64
        .decode(base64data)
        .map_err(|e| Error::Custom(format!("base64 decode: {e}")))?;
    let mut img =
        image::load_from_memory(&raw).map_err(|e| Error::Custom(format!("load image: {e}")))?;

    if img.width() > MAX_IMAGE_WIDTH {
        let factor = img.width() as f64 / MAX_IMAGE_WIDTH as f64;
        let new_h = (img.height() as f64 / factor).round() as u32;
        img = img.resize_exact(
            MAX_IMAGE_WIDTH,
            new_h,
            image::imageops::FilterType::Lanczos3,
        );
    }
    if img.height() > MAX_IMAGE_HEIGHT {
        let factor = img.height() as f64 / MAX_IMAGE_HEIGHT as f64;
        let new_w = (img.width() as f64 / factor).round() as u32;
        img = img.resize_exact(
            new_w,
            MAX_IMAGE_HEIGHT,
            image::imageops::FilterType::Lanczos3,
        );
    }

    let mut buf = encode_png(&img)?;

    for _ in 0..250 {
        if buf.len() < MAX_IMAGE_SIZE {
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
        if buf.len() < MAX_IMAGE_SIZE {
            break;
        }
    }

    if buf.len() >= MAX_IMAGE_SIZE {
        return Err(Error::Custom(
            "Failed to get image into target filesize.".into(),
        ));
    }

    Ok(B64.encode(&buf))
}

pub fn resize_upload_image_bytes(
    base64data: &str,
    matching_dimensions: bool,
) -> Result<Vec<u8>, Error> {
    resize_image_to_limits(
        base64data,
        matching_dimensions,
        MAX_IMAGE_WIDTH,
        MAX_IMAGE_HEIGHT,
        MAX_IMAGE_SIZE,
    )
}

pub fn resize_print_image_bytes(base64data: &str) -> Result<Vec<u8>, Error> {
    let input = resize_image_to_limits(
        base64data,
        false,
        PRINT_CONTENT_WIDTH,
        PRINT_CONTENT_HEIGHT,
        MAX_IMAGE_SIZE,
    )?;
    let mut img = image::load_from_memory(&input)
        .map_err(|e| Error::Custom(format!("load print image: {e}")))?;

    if img.width() < PRINT_CONTENT_WIDTH || img.height() < PRINT_CONTENT_HEIGHT {
        let mut new_width = img.width();
        let mut new_height = img.height();
        if img.width() < PRINT_CONTENT_WIDTH {
            new_width = PRINT_CONTENT_WIDTH;
            new_height =
                (img.height() as f64 / (img.width() as f64 / new_width as f64)).round() as u32;
        }
        if img.height() < PRINT_CONTENT_HEIGHT {
            new_height = PRINT_CONTENT_HEIGHT;
            new_width =
                (img.width() as f64 / (img.height() as f64 / new_height as f64)).round() as u32;
        }

        let resized =
            img.resize_exact(new_width, new_height, image::imageops::FilterType::Lanczos3);
        let mut canvas = image::RgbaImage::from_pixel(
            PRINT_CONTENT_WIDTH,
            PRINT_CONTENT_HEIGHT,
            image::Rgba([255, 255, 255, 255]),
        );
        let x = i64::from((PRINT_CONTENT_WIDTH - new_width) / 2);
        let y = i64::from((PRINT_CONTENT_HEIGHT - new_height) / 2);
        image::imageops::overlay(&mut canvas, &resized.to_rgba8(), x, y);
        img = image::DynamicImage::ImageRgba8(canvas);
    }

    let mut bordered = image::RgbaImage::from_pixel(
        PRINT_CANVAS_WIDTH,
        PRINT_CANVAS_HEIGHT,
        image::Rgba([255, 255, 255, 255]),
    );
    image::imageops::overlay(
        &mut bordered,
        &img.to_rgba8(),
        i64::from(PRINT_OFFSET_X),
        i64::from(PRINT_OFFSET_Y),
    );
    encode_png(&image::DynamicImage::ImageRgba8(bordered))
}

pub fn crop_print_base64(base64data: &str) -> Result<String, Error> {
    let raw = B64
        .decode(base64data)
        .map_err(|e| Error::Custom(format!("base64 decode: {e}")))?;
    let img =
        image::load_from_memory(&raw).map_err(|e| Error::Custom(format!("load image: {e}")))?;
    if img.width() != PRINT_CANVAS_WIDTH || img.height() != PRINT_CANVAS_HEIGHT {
        return Ok(base64data.to_string());
    }
    let cropped = img.crop_imm(
        PRINT_OFFSET_X,
        PRINT_OFFSET_Y,
        PRINT_CONTENT_WIDTH,
        PRINT_CONTENT_HEIGHT,
    );
    Ok(B64.encode(encode_png(&cropped)?))
}

pub fn crop_all_prints(ugc_folder_path: &str) -> Result<(), Error> {
    let folder = PathBuf::from(ugc_folder_path).join("Prints");
    if !folder.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(&folder) {
        let entry = entry.map_err(|e| Error::Custom(format!("walk dir: {e}")))?;
        let p = entry.path();
        if p.extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("png"))
        {
            crop_print_file(p).map_err(|e| Error::Custom(format!("{}: {e}", p.display())))?;
        }
    }
    Ok(())
}

pub fn crop_print_file(path: &Path) -> Result<bool, Error> {
    let img = image::open(path).map_err(|e| Error::Custom(e.to_string()))?;
    if img.width() != PRINT_CANVAS_WIDTH || img.height() != PRINT_CANVAS_HEIGHT {
        return Ok(false);
    }
    let cropped = img.crop_imm(
        PRINT_OFFSET_X,
        PRINT_OFFSET_Y,
        PRINT_CONTENT_WIDTH,
        PRINT_CONTENT_HEIGHT,
    );

    let temp_path = {
        let mut t = path.as_os_str().to_owned();
        t.push(".temp");
        PathBuf::from(t)
    };
    cropped
        .save_with_format(&temp_path, image::ImageFormat::Png)
        .map_err(|e| Error::Custom(e.to_string()))?;

    {
        let old_path_str = path.to_string_lossy();
        let mut old_png = png_mod::PngFile::open_read(&old_path_str).map_err(Error::Custom)?;
        let text_chunks = old_png.get_chunks_of_type(&ChunkType::ITXT);
        if !text_chunks.is_empty() {
            let temp_str = temp_path.to_string_lossy();
            let mut new_png = png_mod::PngFile::open_rw(&temp_str).map_err(Error::Custom)?;
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

fn resize_image_to_limits(
    base64data: &str,
    matching_dimensions: bool,
    max_width: u32,
    max_height: u32,
    max_size: usize,
) -> Result<Vec<u8>, Error> {
    let raw = B64
        .decode(base64data)
        .map_err(|e| Error::Custom(format!("base64 decode: {e}")))?;
    let format = image::guess_format(&raw).ok();
    let mut img =
        image::load_from_memory(&raw).map_err(|e| Error::Custom(format!("load image: {e}")))?;

    if (!matching_dimensions || img.width() == img.height())
        && matches!(format, Some(image::ImageFormat::Png))
        && raw.len() < max_size
        && img.width() <= max_width
        && img.height() <= max_height
    {
        return Ok(raw);
    }

    if img.width() > max_width {
        let factor = img.width() as f64 / max_width as f64;
        let new_height = (img.height() as f64 / factor).round() as u32;
        img = img.resize_exact(max_width, new_height, image::imageops::FilterType::Lanczos3);
    }
    if img.height() > max_height {
        let factor = img.height() as f64 / max_height as f64;
        let new_width = (img.width() as f64 / factor).round() as u32;
        img = img.resize_exact(new_width, max_height, image::imageops::FilterType::Lanczos3);
    }
    if matching_dimensions && img.width() != img.height() {
        let new_size = img.width().max(img.height());
        let x = (new_size - img.width()) / 2;
        let y = (new_size - img.height()) / 2;
        let rgba = img.to_rgba8();
        let mut padded = image::RgbaImage::new(new_size, new_size);
        image::imageops::overlay(&mut padded, &rgba, i64::from(x), i64::from(y));
        img = image::DynamicImage::ImageRgba8(padded);
    }

    let mut output = encode_png(&img)?;
    for _ in 0..250 {
        if output.len() < max_size {
            break;
        }
        let (w, h) = (img.width(), img.height());
        let (new_w, new_h) = if w > h {
            let new_w = w.saturating_sub(25);
            let new_h = (h as f64 / (w as f64 / new_w as f64)).round() as u32;
            (new_w, new_h)
        } else {
            let new_h = h.saturating_sub(25);
            let new_w = (w as f64 / (h as f64 / new_h as f64)).round() as u32;
            (new_w, new_h)
        };
        img = img.resize_exact(
            new_w.max(1),
            new_h.max(1),
            image::imageops::FilterType::Lanczos3,
        );
        output = encode_png(&img)?;
    }

    if output.len() >= max_size {
        return Err(Error::Custom(
            "Failed to get image into target filesize.".into(),
        ));
    }

    Ok(output)
}

fn encode_png(img: &image::DynamicImage) -> Result<Vec<u8>, Error> {
    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    img.write_with_encoder(encoder)
        .map_err(|e| Error::Custom(format!("png encode: {e}")))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
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

    fn decoded_dimensions(bytes: &[u8]) -> Result<(u32, u32), Error> {
        let img = image::load_from_memory(bytes)
            .map_err(|e| Error::Custom(format!("load image: {e}")))?;
        Ok((img.width(), img.height()))
    }

    #[test]
    fn resize_image_to_fit_limits_base64_returns_png_base64() -> Result<(), Error> {
        let input = encode_test_png(16, 12)?;
        let output = super::resize_image_to_fit_limits_base64(&input)?;
        let bytes = B64
            .decode(output)
            .map_err(|e| Error::Custom(format!("base64 decode: {e}")))?;

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
    fn crop_print_base64_crops_only_2048x1440() -> Result<(), Error> {
        let printable = encode_test_png(2048, 1440)?;
        let cropped = super::crop_print_base64(&printable)?;
        let cropped_bytes = B64
            .decode(cropped)
            .map_err(|e| Error::Custom(format!("base64 decode: {e}")))?;

        assert_eq!(decoded_dimensions(&cropped_bytes)?, (1920, 1080));

        let untouched = encode_test_png(320, 240)?;
        assert_eq!(super::crop_print_base64(&untouched)?, untouched);
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
            assert!(png.write_chunk(&chunk));
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
}
