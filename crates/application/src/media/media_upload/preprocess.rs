use vrcx_0_media::image_processing;
use vrcx_0_vrchat_client::http_api::{HttpApiRequestInput, HttpApiUpload};

use crate::{Error, Result};

pub fn prepare_media_upload_request(mut input: HttpApiRequestInput) -> Result<HttpApiRequestInput> {
    match input.body.as_upload_mut() {
        Some(HttpApiUpload::Image {
            image_data,
            matching_dimensions,
            ..
        }) => {
            *image_data =
                image_processing::resize_upload_image_base64(image_data, *matching_dimensions)?;
        }
        Some(HttpApiUpload::LegacyImage { image_data, .. }) => {
            *image_data = image_processing::resize_upload_image_base64(image_data, false)?;
        }
        Some(HttpApiUpload::PrintImage {
            image_data,
            crop_white_border,
            ..
        }) => {
            let prepared = if *crop_white_border {
                image_processing::crop_print_base64(image_data)?
            } else {
                std::mem::take(image_data)
            };
            *image_data = image_processing::resize_print_image_base64(&prepared)?;
        }
        Some(HttpApiUpload::FilePut { .. }) | None => {}
    }
    Ok(input)
}

pub fn require_prepared_image_data(input: &HttpApiRequestInput) -> Result<&str> {
    let image_data = match input.body.as_upload() {
        Some(
            HttpApiUpload::Image { image_data, .. }
            | HttpApiUpload::PrintImage { image_data, .. }
            | HttpApiUpload::LegacyImage { image_data, .. },
        ) => Some(image_data.as_str()),
        Some(HttpApiUpload::FilePut { .. }) | None => None,
    };
    image_data
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| Error::Custom("media upload requires prepared imageData".into()))
}

#[cfg(test)]
mod tests;
