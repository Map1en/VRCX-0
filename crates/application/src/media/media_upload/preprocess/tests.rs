use vrcx_0_contracts::vrchat_api::{VrchatRequestBody, VrchatUpload};

use super::*;

fn image_request(image_data: String) -> VrchatRequest {
    VrchatRequest {
        body: VrchatRequestBody::Upload(VrchatUpload::Image {
            image_data,
            post_data: None,
            matching_dimensions: false,
        }),
        ..Default::default()
    }
}

#[test]
fn require_prepared_image_data_rejects_non_image_and_blank_uploads() {
    let missing = VrchatRequest::default();
    let blank = image_request(" \t\r\n ".into());
    let valid = image_request(" prepared ".into());

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
