use fast_image_resize::{FilterType, ResizeAlg, ResizeOptions, Resizer};
use image::{DynamicImage, RgbImage};
use jpeg_encoder::{ColorType, Encoder, SamplingFactor};
use vrcx_0_core::screenshots::ScreenshotShareCompression;

use crate::error::Error;

const JPEG_LONG_EDGES: [Option<u32>; 4] = [None, Some(3840), Some(2560), Some(1920)];
const JPEG_QUALITY: u8 = 92;
const HIGH_QUALITY_MAX_BYTES: usize = 9_500_000;
const STANDARD_MAX_BYTES: usize = 4_750_000;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const METADATA_CHUNKS: [&[u8; 4]; 5] = [b"tEXt", b"iTXt", b"zTXt", b"eXIf", b"tIME"];

#[derive(Debug)]
pub struct SharedImage {
    pub data: Vec<u8>,
    pub jpeg: bool,
}

pub fn screenshot_share_upload_limit(compression: ScreenshotShareCompression) -> Option<usize> {
    match compression {
        ScreenshotShareCompression::High => Some(HIGH_QUALITY_MAX_BYTES),
        ScreenshotShareCompression::Standard => Some(STANDARD_MAX_BYTES),
        ScreenshotShareCompression::Original => None,
    }
}

pub fn encode_screenshot_share(
    source: Vec<u8>,
    compression: ScreenshotShareCompression,
    keep_metadata: bool,
) -> Result<SharedImage, Error> {
    let limit_bytes = screenshot_share_upload_limit(compression).unwrap_or(usize::MAX);
    let keep_metadata = keep_metadata && compression == ScreenshotShareCompression::Original;
    let original = match split_png_metadata(&source) {
        Some((pixels, metadata)) => {
            with_metadata(&pixels, if keep_metadata { &metadata } else { &[] })
        }
        None => encode_png(&decode(&source)?)?,
    };
    if original.len() <= limit_bytes {
        return Ok(SharedImage {
            data: original,
            jpeg: false,
        });
    }
    Ok(SharedImage {
        data: encode_fitting_jpeg(&flatten_on_black(decode(&source)?), limit_bytes)?,
        jpeg: true,
    })
}

fn flatten_on_black(image: DynamicImage) -> RgbImage {
    if !image.color().has_alpha() {
        return image.to_rgb8();
    }
    let rgba = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let scale = |channel: u8| ((u16::from(channel) * u16::from(a) + 127) / 255) as u8;
        image::Rgb([scale(r), scale(g), scale(b)])
    })
}

fn decode(bytes: &[u8]) -> Result<DynamicImage, Error> {
    image::load_from_memory(bytes)
        .map_err(|error| Error::Custom(format!("decode screenshot: {error}")))
}

fn split_png_metadata(bytes: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut rest = bytes.strip_prefix(PNG_SIGNATURE)?;
    let mut pixels = Vec::with_capacity(bytes.len());
    let mut metadata = Vec::new();
    pixels.extend_from_slice(PNG_SIGNATURE);
    while !rest.is_empty() {
        let length = u32::from_be_bytes(rest.get(..4)?.try_into().ok()?) as usize;
        let end = length.checked_add(12)?;
        let chunk = rest.get(..end)?;
        let kind = &chunk[4..8];
        if METADATA_CHUNKS
            .iter()
            .any(|chunk_kind| kind == chunk_kind.as_slice())
        {
            metadata.extend_from_slice(chunk);
        } else {
            pixels.extend_from_slice(chunk);
        }
        rest = &rest[end..];
        if kind == b"IEND" {
            return Some((pixels, metadata));
        }
    }
    None
}

fn with_metadata(png: &[u8], metadata: &[u8]) -> Vec<u8> {
    let after_ihdr = PNG_SIGNATURE.len() + 25;
    if metadata.is_empty() || png.len() < after_ihdr {
        return png.to_vec();
    }
    let mut out = Vec::with_capacity(png.len() + metadata.len());
    out.extend_from_slice(&png[..after_ihdr]);
    out.extend_from_slice(metadata);
    out.extend_from_slice(&png[after_ihdr..]);
    out
}

fn encode_png(image: &DynamicImage) -> Result<Vec<u8>, Error> {
    let mut out = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|error| Error::Custom(format!("encode screenshot png: {error}")))?;
    Ok(out.into_inner())
}

fn encode_fitting_jpeg(image: &RgbImage, limit_bytes: usize) -> Result<Vec<u8>, Error> {
    let long_edge = image.width().max(image.height());
    let mut last = None;
    for edge in JPEG_LONG_EDGES {
        let data = match edge {
            None => encode_jpeg(image)?,
            Some(edge) if long_edge > edge => encode_jpeg(&resize_long_edge(image, edge)?)?,
            Some(_) => continue,
        };
        if data.len() <= limit_bytes {
            return Ok(data);
        }
        last = Some(data);
    }
    last.ok_or_else(|| Error::Custom("encode screenshot jpeg: no output".into()))
}

fn encode_jpeg(image: &RgbImage) -> Result<Vec<u8>, Error> {
    let width = u16::try_from(image.width())
        .map_err(|_| Error::Custom("Screenshot is too wide for JPEG.".into()))?;
    let height = u16::try_from(image.height())
        .map_err(|_| Error::Custom("Screenshot is too tall for JPEG.".into()))?;
    let mut out = Vec::new();
    let mut encoder = Encoder::new(&mut out, JPEG_QUALITY);
    encoder.set_sampling_factor(SamplingFactor::R_4_4_4);
    encoder.set_optimized_huffman_tables(true);
    encoder
        .encode(image.as_raw(), width, height, ColorType::Rgb)
        .map_err(|error| Error::Custom(format!("encode screenshot jpeg: {error}")))?;
    Ok(out)
}

fn resize_long_edge(image: &RgbImage, edge: u32) -> Result<RgbImage, Error> {
    let scale = f64::from(edge) / f64::from(image.width().max(image.height()));
    let width = ((f64::from(image.width()) * scale).round() as u32).max(1);
    let height = ((f64::from(image.height()) * scale).round() as u32).max(1);
    let mut resized = RgbImage::new(width, height);
    Resizer::new()
        .resize(
            image,
            &mut resized,
            Some(&ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3))),
        )
        .map_err(|error| Error::Custom(format!("resize screenshot: {error}")))?;
    Ok(resized)
}

#[cfg(test)]
mod tests;
