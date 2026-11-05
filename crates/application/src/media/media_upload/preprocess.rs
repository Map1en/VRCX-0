use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_contracts::vrchat_api::VrchatUpload;

use super::MediaUploadPreprocessor;

pub fn prepare_media_upload_request(
    preprocessor: &dyn MediaUploadPreprocessor,
    input: VrchatRequest,
) -> Result<VrchatRequest> {
    preprocessor.prepare(input)
}

pub fn require_prepared_image_data(input: &VrchatRequest) -> Result<&str> {
    let image_data = match input.body.as_upload() {
        Some(
            VrchatUpload::Image { image_data, .. }
            | VrchatUpload::PrintImage { image_data, .. }
            | VrchatUpload::LegacyImage { image_data, .. },
        ) => Some(image_data.as_str()),
        Some(VrchatUpload::FilePut { .. }) | None => None,
    };
    image_data
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| Error::Custom("media upload requires prepared imageData".into()))
}

#[cfg(test)]
mod tests;
