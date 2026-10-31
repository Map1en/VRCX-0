use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application::media::{
    LegacyEntityImageKind, LegacyMediaUploadFuture, LegacyMediaUploadGate, LegacyMediaUploadPort,
    LegacyMediaUploadRequest, LegacyMediaUploadResult, MediaUploadPreprocessor,
};
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatScope};
use vrcx_0_application_core::WebClient;
use vrcx_0_contracts::vrchat_api::{VrchatJsonResponse, VrchatUpload};
use vrcx_0_vrchat_client::media::{
    avatar_image_set_input, file_put_input, file_upload_finish_input, file_upload_stage_path,
    file_upload_start_input, file_version_create_input, normalize_media_endpoint,
    world_image_set_input, FileUploadStageKind,
};

#[derive(Clone)]
pub struct LocalMediaUploadAdapter {
    web: Arc<WebClient>,
}

impl LocalMediaUploadAdapter {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }

    fn prepare_request(mut input: VrchatApiRequest) -> crate::Result<VrchatApiRequest> {
        match input.body.as_upload_mut() {
            Some(VrchatUpload::Image {
                image_data,
                matching_dimensions,
                ..
            }) => {
                *image_data = vrcx_0_media::image_processing::resize_upload_image_base64(
                    image_data,
                    *matching_dimensions,
                )
                .map_err(map_media_error)?;
            }
            Some(VrchatUpload::LegacyImage { image_data, .. }) => {
                *image_data =
                    vrcx_0_media::image_processing::resize_upload_image_base64(image_data, false)
                        .map_err(map_media_error)?;
            }
            Some(VrchatUpload::PrintImage {
                image_data,
                crop_white_border,
                ..
            }) => {
                let prepared = if *crop_white_border {
                    vrcx_0_media::image_processing::crop_print_base64(image_data)
                        .map_err(map_media_error)?
                } else {
                    std::mem::take(image_data)
                };
                *image_data = vrcx_0_media::image_processing::resize_print_image_base64(&prepared)
                    .map_err(map_media_error)?;
            }
            Some(VrchatUpload::FilePut { .. }) | None => {}
        }
        Ok(input)
    }

    async fn upload_legacy(
        &self,
        request: LegacyMediaUploadRequest,
        gate: &dyn LegacyMediaUploadGate,
    ) -> crate::Result<LegacyMediaUploadResult> {
        let target_label = request.kind.label();
        let endpoint = normalize_media_endpoint(&request.endpoint);
        let file_data = vrcx_0_media::media_files::decode_file_base64(&request.base64_file)
            .map_err(map_media_error)?;
        let file_md5 = vrcx_0_media::media_files::md5_base64(&file_data);
        let file_size_in_bytes = request
            .file_size_in_bytes
            .filter(|value| *value > 0)
            .unwrap_or(file_data.len() as i64);
        let signature_file = vrcx_0_media::media_files::sign_file(&file_data);
        let signature_md5 = vrcx_0_media::media_files::md5_base64(&signature_file);
        let signature_size_in_bytes = signature_file.len() as i64;

        let upload = self
            .execute_json(
                gate,
                file_version_create_input(
                    endpoint.clone(),
                    request.source_file_id,
                    file_md5.clone(),
                    file_size_in_bytes,
                    signature_md5.clone(),
                    signature_size_in_bytes,
                )?,
                &format!("{target_label} image upload failed"),
            )
            .await?;
        let uploaded_file_id = json_field_string(&upload, "id");
        let file_version = latest_file_version(&upload).ok_or_else(|| {
            crate::Error::Custom(format!(
                "{target_label} image upload did not return a file version."
            ))
        })?;
        if uploaded_file_id.is_empty() {
            return Err(crate::Error::Custom(format!(
                "{target_label} image upload did not return a file id."
            )));
        }

        for (kind, file_data, file_mime, file_md5) in [
            (FileUploadStageKind::File, file_data, "image/png", file_md5),
            (
                FileUploadStageKind::Signature,
                signature_file,
                "application/x-rsync-signature",
                signature_md5,
            ),
        ] {
            let stage_path = file_upload_stage_path(uploaded_file_id.clone(), file_version, kind)?;
            let start = self
                .execute_json(
                    gate,
                    file_upload_start_input(endpoint.clone(), stage_path.clone()),
                    &format!("{target_label} image upload failed"),
                )
                .await?;
            let upload_url = json_field_string(&start, "url");
            if upload_url.is_empty() {
                return Err(crate::Error::Custom(format!(
                    "{target_label} image upload did not return a {kind} upload URL."
                )));
            }
            self.execute_success(
                gate,
                file_put_input(upload_url, file_data, file_mime.to_string(), file_md5),
                &format!("{target_label} image file PUT failed"),
            )
            .await?;
            self.execute_json(
                gate,
                file_upload_finish_input(endpoint.clone(), stage_path),
                &format!("{target_label} image upload failed"),
            )
            .await?;
        }

        let image_url = format!("{endpoint}/file/{uploaded_file_id}/{file_version}/file");
        let entity_request = match request.kind {
            LegacyEntityImageKind::Avatar => {
                avatar_image_set_input(endpoint, request.entity_id, image_url.clone())
            }
            LegacyEntityImageKind::World => {
                world_image_set_input(endpoint, request.entity_id, image_url.clone())
            }
        }?;
        let entity = self
            .execute_json(
                gate,
                entity_request,
                &format!("{target_label} image change failed"),
            )
            .await?;

        Ok(LegacyMediaUploadResult {
            entity: entity.into(),
            image_url,
            file_id: uploaded_file_id,
            file_version,
        })
    }

    async fn execute_json(
        &self,
        gate: &dyn LegacyMediaUploadGate,
        input: VrchatApiRequest,
        fallback_message: &str,
    ) -> crate::Result<Value> {
        let response = self.execute_gated(gate, input).await?;
        let response = VrchatJsonResponse::from(&response);
        if response.is_failure() {
            return Err(crate::Error::Custom(
                response.error_message_or(fallback_message),
            ));
        }
        Ok(response.json)
    }

    async fn execute_success(
        &self,
        gate: &dyn LegacyMediaUploadGate,
        input: VrchatApiRequest,
        fallback_message: &str,
    ) -> crate::Result<()> {
        let response = self.execute_gated(gate, input).await?;
        if !(200..300).contains(&response.status) {
            return Err(crate::Error::Custom(format!(
                "{fallback_message} ({})",
                response.status
            )));
        }
        Ok(())
    }

    async fn execute_gated(
        &self,
        gate: &dyn LegacyMediaUploadGate,
        input: VrchatApiRequest,
    ) -> crate::Result<vrcx_0_application_core::vrchat_api::VrchatApiResponse> {
        gate.before_request().await?;
        let response = self
            .web
            .execute_api(input, VrchatScope::VrchatMedia)
            .await?;
        gate.after_request()?;
        Ok(response)
    }
}

impl MediaUploadPreprocessor for LocalMediaUploadAdapter {
    fn prepare(&self, input: VrchatApiRequest) -> crate::Result<VrchatApiRequest> {
        Self::prepare_request(input)
    }
}

impl LegacyMediaUploadPort for LocalMediaUploadAdapter {
    fn upload<'a>(
        &'a self,
        request: LegacyMediaUploadRequest,
        gate: &'a dyn LegacyMediaUploadGate,
    ) -> LegacyMediaUploadFuture<'a> {
        Box::pin(self.upload_legacy(request, gate))
    }
}

fn map_media_error(error: vrcx_0_media::Error) -> crate::Error {
    match error {
        vrcx_0_media::Error::Io(error) => crate::Error::Io(error),
        vrcx_0_media::Error::Custom(message) => crate::Error::Custom(message),
    }
}

fn json_field_string(value: &Value, field: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(field))
        .and_then(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .or_else(|| (!value.is_null()).then(|| value.to_string()))
        })
        .unwrap_or_default()
}

fn value_as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_str().and_then(|value| value.parse::<i64>().ok()))
}

fn latest_file_version(upload: &Value) -> Option<i64> {
    upload
        .as_object()
        .and_then(|object| object.get("versions"))
        .and_then(Value::as_array)
        .and_then(|versions| versions.last())
        .and_then(|version| version.as_object().and_then(|object| object.get("version")))
        .and_then(value_as_i64)
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    use image::GenericImageView;
    use vrcx_0_contracts::vrchat_api::{VrchatRequestBody, VrchatUpload};

    use super::*;

    fn encode_png(image: image::RgbaImage) -> crate::Result<String> {
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_with_encoder(image::codecs::png::PngEncoder::new(&mut bytes))
            .map_err(|error| crate::Error::Custom(format!("png encode: {error}")))?;
        Ok(B64.encode(bytes))
    }

    fn solid_png(width: u32, height: u32) -> crate::Result<String> {
        encode_png(image::RgbaImage::from_pixel(
            width,
            height,
            image::Rgba([12, 34, 56, 255]),
        ))
    }

    fn decode_image(data: &str) -> crate::Result<image::DynamicImage> {
        let bytes = B64
            .decode(data)
            .map_err(|error| crate::Error::Custom(format!("base64 decode: {error}")))?;
        image::load_from_memory(&bytes)
            .map_err(|error| crate::Error::Custom(format!("load image: {error}")))
    }

    fn print_canvas_png() -> crate::Result<String> {
        let mut image = image::RgbaImage::from_pixel(2048, 1440, image::Rgba([200, 10, 20, 255]));
        for y in 69..1149 {
            for x in 64..1984 {
                image.put_pixel(x, y, image::Rgba([10, 20, 200, 255]));
            }
        }
        encode_png(image)
    }

    fn prepared_data(input: &VrchatApiRequest) -> &str {
        match input.body.as_upload() {
            Some(
                VrchatUpload::Image { image_data, .. }
                | VrchatUpload::PrintImage { image_data, .. }
                | VrchatUpload::LegacyImage { image_data, .. },
            ) => image_data,
            Some(VrchatUpload::FilePut { .. }) | None => panic!("expected image upload"),
        }
    }

    #[test]
    fn preprocessing_preserves_non_upload_requests() {
        let input = VrchatApiRequest {
            path: Some("file/image".into()),
            ..Default::default()
        };
        let output = LocalMediaUploadAdapter::prepare_request(input).unwrap();
        assert_eq!(output.path.as_deref(), Some("file/image"));
        assert_eq!(output.body, VrchatRequestBody::Empty);
    }

    #[test]
    fn regular_legacy_and_print_preprocessing_preserve_image_behavior() {
        let regular = LocalMediaUploadAdapter::prepare_request(VrchatApiRequest {
            body: VrchatRequestBody::Upload(VrchatUpload::Image {
                image_data: solid_png(3, 2).unwrap(),
                post_data: None,
                matching_dimensions: false,
            }),
            ..Default::default()
        })
        .unwrap();
        let legacy = LocalMediaUploadAdapter::prepare_request(VrchatApiRequest {
            body: VrchatRequestBody::Upload(VrchatUpload::LegacyImage {
                image_data: solid_png(3, 2).unwrap(),
                post_data: None,
            }),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            decode_image(prepared_data(&regular)).unwrap().dimensions(),
            (3, 2)
        );
        assert_eq!(
            decode_image(prepared_data(&legacy)).unwrap().dimensions(),
            (3, 2)
        );

        let cropped = LocalMediaUploadAdapter::prepare_request(VrchatApiRequest {
            body: VrchatRequestBody::Upload(VrchatUpload::PrintImage {
                image_data: print_canvas_png().unwrap(),
                post_data: None,
                crop_white_border: true,
            }),
            ..Default::default()
        })
        .unwrap();
        let cropped = decode_image(prepared_data(&cropped)).unwrap().to_rgba8();
        assert_eq!(cropped.dimensions(), (2048, 1440));
        assert_eq!(*cropped.get_pixel(74, 79), image::Rgba([10, 20, 200, 255]));
    }
}
