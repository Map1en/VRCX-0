use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::GenericImageView;
use vrcx_0_vrchat_client::http_api::HttpApiRequestInput;

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

#[test]
fn request_without_image_data_is_unchanged() -> Result<()> {
    let input = HttpApiRequestInput {
        path: Some("file/image".into()),
        upload_image: Some(true),
        matching_dimensions: Some(true),
        crop_white_border: Some(true),
        post_data: Some("payload".into()),
        ..Default::default()
    };

    let output = prepare_media_upload_request(input)?;

    assert_eq!(output.path.as_deref(), Some("file/image"));
    assert_eq!(output.upload_image, Some(true));
    assert_eq!(output.matching_dimensions, Some(true));
    assert_eq!(output.crop_white_border, Some(true));
    assert_eq!(output.post_data.as_deref(), Some("payload"));
    assert!(output.image_data.is_none());
    Ok(())
}

#[test]
fn upload_image_and_legacy_consume_matching_dimensions() -> Result<()> {
    let image_data = solid_png(3, 2)?;
    let regular = prepare_media_upload_request(HttpApiRequestInput {
        upload_image: Some(true),
        matching_dimensions: Some(false),
        image_data: Some(image_data.clone()),
        ..Default::default()
    })?;
    let legacy = prepare_media_upload_request(HttpApiRequestInput {
        upload_image_legacy: Some(true),
        matching_dimensions: Some(true),
        image_data: Some(image_data),
        ..Default::default()
    })?;

    assert_eq!(regular.matching_dimensions, None);
    assert_eq!(
        decode_image(require_prepared_image_data(&regular)?)?.dimensions(),
        (3, 2)
    );
    assert_eq!(legacy.matching_dimensions, None);
    assert_eq!(
        decode_image(require_prepared_image_data(&legacy)?)?.dimensions(),
        (3, 3)
    );
    Ok(())
}

#[test]
fn print_upload_routes_crop_flag_and_consumes_it() -> Result<()> {
    let cropped = prepare_media_upload_request(HttpApiRequestInput {
        upload_image_print: Some(true),
        crop_white_border: Some(true),
        image_data: Some(print_canvas_png()?),
        ..Default::default()
    })?;
    let uncropped = prepare_media_upload_request(HttpApiRequestInput {
        upload_image_print: Some(true),
        crop_white_border: Some(false),
        image_data: Some(solid_png(320, 180)?),
        ..Default::default()
    })?;

    assert_eq!(cropped.crop_white_border, None);
    assert_eq!(uncropped.crop_white_border, None);

    let cropped = decode_image(require_prepared_image_data(&cropped)?)?.to_rgba8();
    let uncropped = decode_image(require_prepared_image_data(&uncropped)?)?.to_rgba8();
    assert_eq!(cropped.dimensions(), (2048, 1440));
    assert_eq!(uncropped.dimensions(), (2048, 1440));
    assert_eq!(*cropped.get_pixel(74, 79), image::Rgba([10, 20, 200, 255]));
    assert_eq!(*uncropped.get_pixel(74, 79), image::Rgba([12, 34, 56, 255]));
    Ok(())
}

#[test]
fn upload_mode_priority_matches_web_request_builder() -> Result<()> {
    let regular = prepare_media_upload_request(HttpApiRequestInput {
        upload_image: Some(true),
        upload_image_legacy: Some(true),
        upload_image_print: Some(true),
        matching_dimensions: Some(true),
        crop_white_border: Some(true),
        image_data: Some(solid_png(3, 2)?),
        ..Default::default()
    })?;
    let print = prepare_media_upload_request(HttpApiRequestInput {
        upload_image_legacy: Some(true),
        upload_image_print: Some(true),
        matching_dimensions: Some(true),
        crop_white_border: Some(false),
        image_data: Some(solid_png(320, 180)?),
        ..Default::default()
    })?;

    assert_eq!(regular.matching_dimensions, None);
    assert_eq!(regular.crop_white_border, Some(true));
    assert_eq!(
        decode_image(require_prepared_image_data(&regular)?)?.dimensions(),
        (3, 3)
    );
    assert_eq!(print.matching_dimensions, Some(true));
    assert_eq!(print.crop_white_border, None);
    assert_eq!(
        decode_image(require_prepared_image_data(&print)?)?.dimensions(),
        (2048, 1440)
    );
    Ok(())
}

#[test]
fn request_without_upload_flag_preserves_image_data() -> Result<()> {
    let input = HttpApiRequestInput {
        image_data: Some("not processed".into()),
        matching_dimensions: Some(true),
        crop_white_border: Some(true),
        ..Default::default()
    };

    let output = prepare_media_upload_request(input)?;

    assert_eq!(output.image_data.as_deref(), Some("not processed"));
    assert_eq!(output.matching_dimensions, Some(true));
    assert_eq!(output.crop_white_border, Some(true));
    Ok(())
}

#[test]
fn require_prepared_image_data_rejects_missing_and_blank_values() {
    let missing = HttpApiRequestInput::default();
    let blank = HttpApiRequestInput {
        image_data: Some(" \t\r\n ".into()),
        ..Default::default()
    };
    let valid = HttpApiRequestInput {
        image_data: Some(" prepared ".into()),
        ..Default::default()
    };

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
