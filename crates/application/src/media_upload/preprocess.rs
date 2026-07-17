use vrcx_0_media::image_processing;
use vrcx_0_vrchat_client::http_api::HttpApiRequestInput;

use crate::{Error, Result};

pub fn prepare_media_upload_request(mut input: HttpApiRequestInput) -> Result<HttpApiRequestInput> {
    let Some(image_data) = input.image_data.take() else {
        return Ok(input);
    };

    let upload_image = input.upload_image.unwrap_or(false);
    let upload_image_print = input.upload_image_print.unwrap_or(false);
    let upload_image_legacy = input.upload_image_legacy.unwrap_or(false);

    if upload_image || (!upload_image_print && upload_image_legacy) {
        let matching_dimensions = input.matching_dimensions.unwrap_or(false);
        input.image_data = Some(image_processing::resize_upload_image_base64(
            &image_data,
            matching_dimensions,
        )?);
        input.matching_dimensions = None;
        return Ok(input);
    }

    if upload_image_print {
        let image_data = if input.crop_white_border.unwrap_or(false) {
            image_processing::crop_print_base64(&image_data)?
        } else {
            image_data
        };
        input.image_data = Some(image_processing::resize_print_image_base64(&image_data)?);
        input.crop_white_border = None;
        return Ok(input);
    }

    input.image_data = Some(image_data);
    Ok(input)
}

pub fn require_prepared_image_data(input: &HttpApiRequestInput) -> Result<&str> {
    input
        .image_data
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| Error::Custom("media upload requires prepared imageData".into()))
}

#[cfg(test)]
mod tests;
