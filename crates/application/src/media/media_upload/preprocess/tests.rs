use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::GenericImageView;
use vrcx_0_vrchat_client::http_api::{HttpApiRequestBody, HttpApiRequestInput, HttpApiUpload};

use super::*;

fn encode_png(image: image::RgbaImage) -> Result<String> {
    let mut bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut bytes);
    image::DynamicImage::ImageRgba8(image)
        .write_with_encoder(encoder)
        .map_err(|error| Error::Custom(format!("png encode: {error}")))?;
    Ok(B64.encode(bytes))
}

fn solid_png(width: u32, height: u32) -> Result<String> {
    encode_png(image::RgbaImage::from_pixel(
        width,
        height,
        image::Rgba([12, 34, 56, 255]),
    ))
}

fn decode_image(data: &str) -> Result<image::DynamicImage> {
    let bytes = B64
        .decode(data)
        .map_err(|error| Error::Custom(format!("base64 decode: {error}")))?;
    image::load_from_memory(&bytes).map_err(|error| Error::Custom(format!("load image: {error}")))
}

fn print_canvas_png() -> Result<String> {
    let mut image = image::RgbaImage::from_pixel(2048, 1440, image::Rgba([200, 10, 20, 255]));
    for y in 69..1149 {
        for x in 64..1984 {
            image.put_pixel(x, y, image::Rgba([10, 20, 200, 255]));
        }
    }
    encode_png(image)
}

fn image_request(image_data: String, matching_dimensions: bool) -> HttpApiRequestInput {
    HttpApiRequestInput {
        body: HttpApiRequestBody::Upload(HttpApiUpload::Image {
            image_data,
            post_data: None,
            matching_dimensions,
        }),
        ..Default::default()
    }
}

fn legacy_image_request(image_data: String) -> HttpApiRequestInput {
    HttpApiRequestInput {
        body: HttpApiRequestBody::Upload(HttpApiUpload::LegacyImage {
            image_data,
            post_data: None,
        }),
        ..Default::default()
    }
}

fn print_request(image_data: String, crop_white_border: bool) -> HttpApiRequestInput {
    HttpApiRequestInput {
        body: HttpApiRequestBody::Upload(HttpApiUpload::PrintImage {
            image_data,
            post_data: None,
            crop_white_border,
        }),
        ..Default::default()
    }
}

#[test]
fn request_without_image_upload_is_unchanged() -> Result<()> {
    let input = HttpApiRequestInput {
        path: Some("file/image".into()),
        ..Default::default()
    };

    let output = prepare_media_upload_request(input)?;

    assert_eq!(output.path.as_deref(), Some("file/image"));
    assert_eq!(output.body, HttpApiRequestBody::Empty);
    Ok(())
}

#[test]
fn regular_and_legacy_images_use_their_matching_dimension_mode() -> Result<()> {
    let image_data = solid_png(3, 2)?;
    let regular = prepare_media_upload_request(image_request(image_data.clone(), false))?;
    let legacy = prepare_media_upload_request(legacy_image_request(image_data))?;

    assert_eq!(
        decode_image(require_prepared_image_data(&regular)?)?.dimensions(),
        (3, 2)
    );
    assert_eq!(
        decode_image(require_prepared_image_data(&legacy)?)?.dimensions(),
        (3, 2)
    );
    Ok(())
}

#[test]
fn print_upload_applies_crop_before_resize() -> Result<()> {
    let cropped = prepare_media_upload_request(print_request(print_canvas_png()?, true))?;
    let uncropped = prepare_media_upload_request(print_request(solid_png(320, 180)?, false))?;

    let cropped = decode_image(require_prepared_image_data(&cropped)?)?.to_rgba8();
    let uncropped = decode_image(require_prepared_image_data(&uncropped)?)?.to_rgba8();
    assert_eq!(cropped.dimensions(), (2048, 1440));
    assert_eq!(uncropped.dimensions(), (2048, 1440));
    assert_eq!(*cropped.get_pixel(74, 79), image::Rgba([10, 20, 200, 255]));
    assert_eq!(*uncropped.get_pixel(74, 79), image::Rgba([12, 34, 56, 255]));
    Ok(())
}

#[test]
fn require_prepared_image_data_rejects_non_image_and_blank_uploads() {
    let missing = HttpApiRequestInput::default();
    let blank = image_request(" \t\r\n ".into(), false);
    let valid = image_request(" prepared ".into(), false);

    assert_eq!(
        require_prepared_image_data(&missing)
            .unwrap_err()
            .to_string(),
        "media upload requires prepared imageData"
    );
    assert_eq!(
        require_prepared_image_data(&blank).unwrap_err().to_string(),
        "media upload requires prepared imageData"
    );
    assert_eq!(require_prepared_image_data(&valid).unwrap(), " prepared ");
}
