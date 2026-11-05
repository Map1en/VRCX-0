use super::*;
use vrcx_0_contracts::vrchat_api::{
    classify_vrchat_response, vrchat_response, VrchatJsonResponse, VrchatResponseClass,
};

fn input(path: &str) -> VrchatRequest {
    VrchatRequest {
        path: Some(path.to_string()),
        ..Default::default()
    }
}

#[test]
fn api_json_response_keeps_unparsable_bodies_as_text() {
    let response = VrchatJsonResponse::parse(200, "not json");

    assert_eq!(response.json, Value::String("not json".into()));
    assert!(!response.is_failure());
    assert_eq!(response.error_message(), Some("not json".to_string()));
}

#[test]
fn api_json_response_detects_error_envelopes() {
    let nested = VrchatJsonResponse::parse(500, r#"{"error":{"message":"Application error."}}"#);
    assert!(nested.is_failure());
    assert_eq!(nested.error_message(), Some("Application error.".into()));

    let string_error = VrchatJsonResponse::parse(
        400,
        r#"{"error":"You cannot moderate this user","status_code":400}"#,
    );
    assert!(string_error.is_failure());
    assert_eq!(
        string_error.error_message(),
        Some("You cannot moderate this user".into())
    );

    let flat = VrchatJsonResponse::parse(400, r#"{"message":"\"Bad request\""}"#);
    assert!(flat.is_failure());
    assert_eq!(flat.error_message(), Some("Bad request".into()));

    let ok = VrchatJsonResponse::parse(200, r#"{"id":"usr_1"}"#);
    assert!(!ok.is_failure());
    assert_eq!(ok.error_message(), None);
}

#[test]
fn classifies_vrchat_auth_failures_without_broadening_credential_matches() {
    let invalid_credentials = vrchat_response(
        401,
        r#"{"error":{"message":"Invalid Username/Email or Password"}}"#.into(),
    );
    let missing_credentials =
        vrchat_response(401, r#"{"error":{"message":"Missing Credentials"}}"#.into());
    let generic_unauthorized =
        vrchat_response(401, r#"{"error":{"message":"Unauthorized"}}"#.into());
    let forbidden = vrchat_response(403, r#"{"error":{"message":"Forbidden"}}"#.into());
    let conflicting_messages = vrchat_response(
        401,
        r#"{"message":"Missing Credentials","error":{"message":"Invalid Username/Email or Password"}}"#.into(),
    );

    assert_eq!(
        classify_vrchat_auth_failure(&invalid_credentials),
        VrchatAuthFailureKind::InvalidCredentials
    );
    assert_eq!(
        classify_vrchat_auth_failure(&missing_credentials),
        VrchatAuthFailureKind::MissingCredentials
    );
    assert_eq!(
        classify_vrchat_auth_failure(&generic_unauthorized),
        VrchatAuthFailureKind::SessionInvalidated
    );
    assert_eq!(
        classify_vrchat_auth_failure(&forbidden),
        VrchatAuthFailureKind::SessionInvalidated
    );
    assert_eq!(
        classify_vrchat_auth_failure(&conflicting_messages),
        VrchatAuthFailureKind::MissingCredentials
    );
}

#[test]
fn auth_error_message_preserves_scalar_field_compatibility() {
    let padded_nested = vrchat_response(
        401,
        r#"{"error":{"message":"  Missing Credentials  "}}"#.into(),
    );
    let numeric_top_level = vrchat_response(401, r#"{"message":401}"#.into());

    assert_eq!(
        vrchat_auth_error_message(&padded_nested).as_deref(),
        Some("Missing Credentials")
    );
    assert_eq!(
        vrchat_auth_error_message(&numeric_top_level).as_deref(),
        Some("401")
    );
}

#[test]
fn creates_typed_api_failure_without_encoding_status_in_message() {
    let response = VrchatJsonResponse::parse(
        404,
        r#"{"error":{"message":"The specified friend request was not found."}}"#,
    );

    let failure = response
        .failure_or("VRChat request failed")
        .expect("failure response");

    assert_eq!(failure.status_code, 404);
    assert_eq!(
        failure.message,
        "The specified friend request was not found."
    );
}

#[test]
fn typed_api_failure_preserves_existing_redirect_classification() {
    let response = VrchatJsonResponse::parse(302, "{}");

    assert_eq!(response.failure_or("VRChat request failed"), None);
}

#[test]
fn api_json_response_flags_error_field_even_on_success_status() {
    let response = VrchatJsonResponse::parse(200, r#"{"error":{"message":"nope"}}"#);

    assert!(response.has_error_field());
    assert!(response.is_failure());
}

#[test]
fn builds_vrchat_url_with_query_arrays_and_skipped_values() {
    let mut request = input("worlds");
    request.endpoint = Some("https://api.vrchat.cloud/api/1/".to_string());
    request.query_params = Some(HashMap::from([
        ("tag".to_string(), json!(["featured", null, "labs", ""])),
        ("n".to_string(), json!(50)),
        ("ignored".to_string(), Value::Null),
    ]));
    request.skip_empty_query_string = Some(true);

    let url = Url::parse(&build_request_url(&request, VrchatScope::Vrchat).unwrap()).unwrap();
    assert_eq!(
        format!("{}{}", url.origin().unicode_serialization(), url.path()),
        "https://api.vrchat.cloud/api/1/worlds"
    );
    assert_eq!(
        url.query_pairs()
            .filter(|(key, _)| key == "tag")
            .map(|(_, value)| value.to_string())
            .collect::<Vec<_>>(),
        vec!["featured".to_string(), "labs".to_string()]
    );
    assert_eq!(
        url.query_pairs()
            .find(|(key, _)| key == "n")
            .map(|(_, value)| value.to_string())
            .as_deref(),
        Some("50")
    );
    assert!(url.query_pairs().all(|(key, _)| key != "ignored"));
}

#[test]
fn rejects_non_vrchat_api_endpoint() {
    let mut request = input("worlds");
    request.endpoint = Some("https://api.example.test/api/1/".to_string());
    assert!(build_request_url(&request, VrchatScope::Vrchat).is_err());
}

#[test]
fn rejects_absolute_urls_for_vrchat_scopes() {
    let request = VrchatRequest {
        url: Some("https://example.com/".to_string()),
        ..Default::default()
    };
    assert!(build_request_url(&request, VrchatScope::Vrchat).is_err());

    let request = input("https://example.com/");
    assert!(build_request_url(&request, VrchatScope::VrchatMedia).is_err());
}

#[test]
fn rejects_upload_options_outside_media_scope() {
    let mut request = input("auth/user");
    request.body = VrchatRequestBody::Upload(VrchatUpload::Image {
        image_data: String::new(),
        post_data: None,
        matching_dimensions: false,
    });
    assert!(build_request_url(&request, VrchatScope::Vrchat).is_err());

    request.path = Some("file/image".to_string());
    assert!(build_request_url(&request, VrchatScope::VrchatMedia).is_ok());
}

#[test]
fn allows_signed_absolute_upload_urls_for_media_scope() {
    let mut request = VrchatRequest {
        url: Some("https://signed-upload.example.test/file".to_string()),
        ..Default::default()
    };
    assert!(build_request_url(&request, VrchatScope::VrchatMedia).is_err());

    request.body = VrchatRequestBody::Upload(VrchatUpload::FilePut {
        file_data: Vec::new(),
        file_mime: "application/octet-stream".into(),
        file_md5: None,
    });
    assert!(build_request_url(&request, VrchatScope::VrchatMedia).is_err());

    request.url = Some("https://files.vrchat.cloud/file".to_string());
    let url = build_request_url(&request, VrchatScope::VrchatMedia).unwrap();
    assert_eq!(url, "https://files.vrchat.cloud/file");

    request.url = Some("https://api.vrchat.cloud/api/1/auth/user".to_string());
    assert!(build_request_url(&request, VrchatScope::VrchatMedia).is_err());

    request.url = Some("https://api.vrchat.cloud/api/1/file/file_1/1/file".to_string());
    assert!(build_request_url(&request, VrchatScope::VrchatMedia).is_ok());
}

#[test]
fn classifies_success_redirect_auth_and_rate_limit_statuses_for_http_policy() {
    for status in [200, 204, 299] {
        assert_eq!(
            classify_vrchat_response(status).class,
            VrchatResponseClass::Ok
        );
    }
    for status in [300, 302, 399] {
        assert_eq!(
            classify_vrchat_response(status).class,
            VrchatResponseClass::Unknown
        );
    }

    let auth = classify_vrchat_response(401);
    assert_eq!(auth.class, VrchatResponseClass::Auth);

    let forbidden = classify_vrchat_response(403);
    assert_eq!(forbidden.class, VrchatResponseClass::ClientError);

    let classified = classify_vrchat_response(429);
    assert_eq!(classified.class, VrchatResponseClass::RateLimited);
    assert_eq!(
        serde_json::to_value(classified).unwrap(),
        json!({ "class": "rateLimited" })
    );
}

#[test]
fn query_request_without_body_does_not_emit_body_option() {
    let mut request = input("favorites/fav_1");
    request.method = Some("DELETE".to_string());
    request.query_params = Some(HashMap::from([("objectId".to_string(), json!("fav_1"))]));

    let request = build_web_execute_request(request, VrchatScope::Vrchat).unwrap();
    assert!(request.body.is_none());
    assert_eq!(request.method, "DELETE");
}
