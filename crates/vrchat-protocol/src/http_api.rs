use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use url::Url;
pub use vrcx_0_contracts::vrchat_api::{
    classify_vrchat_auth_failure, vrchat_auth_error_message, VrchatAuthFailureKind,
};
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatRequestBody, VrchatScope, VrchatUpload};
pub use vrcx_0_core::text::normalize_text;
pub use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;
use vrcx_0_core::vrchat_endpoints::{
    VRCHAT_API_DEFAULT_ENDPOINT, VRCHAT_API_HOST, VRCHAT_FILES_HOST, VRCHAT_FILES_S3_HOST,
    VRCHAT_FILES_S3_HOST_PREFIX,
};

use vrcx_0_contracts::{WebExecuteRequest, WebUploadMode};

#[derive(Debug, thiserror::Error)]
pub enum HttpApiError {
    #[error("{0}")]
    Custom(String),
}

impl vrcx_0_contracts::ApplicationErrorSource for HttpApiError {
    fn into_application_error(self) -> vrcx_0_contracts::ApplicationErrorPayload {
        match self {
            Self::Custom(message) => vrcx_0_contracts::ApplicationErrorPayload::Custom(message),
        }
    }
}

pub fn require_text(value: impl AsRef<str>, message: &str) -> Result<String, HttpApiError> {
    let value = normalize_text(value);
    if value.is_empty() {
        return Err(HttpApiError::Custom(message.to_string()));
    }
    Ok(value)
}

pub fn encode_path_segment(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

pub fn json_headers() -> HashMap<String, String> {
    HashMap::from([(
        "Content-Type".to_string(),
        "application/json;charset=utf-8".to_string(),
    )])
}

pub fn object_body(value: Option<Value>) -> Value {
    match value {
        Some(value @ Value::Object(_)) => value,
        _ => json!({}),
    }
}

pub fn api_input(
    endpoint: String,
    method: &str,
    path: impl Into<String>,
    body: Option<Value>,
) -> VrchatRequest {
    VrchatRequest {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path.into()),
        headers: body.as_ref().map(|_| json_headers()),
        body: body
            .map(VrchatRequestBody::Json)
            .unwrap_or(VrchatRequestBody::Empty),
        ..Default::default()
    }
}

pub fn get_input(
    endpoint: String,
    path: impl Into<String>,
    query_params: HashMap<String, Value>,
) -> VrchatRequest {
    VrchatRequest {
        endpoint: Some(endpoint),
        method: Some("GET".into()),
        path: Some(path.into()),
        query_params: Some(query_params),
        ..Default::default()
    }
}

pub fn query_input(
    endpoint: String,
    method: &str,
    path: impl Into<String>,
    query_params: HashMap<String, Value>,
) -> VrchatRequest {
    VrchatRequest {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path.into()),
        query_params: Some(query_params),
        ..Default::default()
    }
}

pub fn api_input_skip_empty_query_string(
    endpoint: String,
    method: &str,
    path: impl Into<String>,
    body: Value,
) -> VrchatRequest {
    VrchatRequest {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path.into()),
        headers: Some(json_headers()),
        body: VrchatRequestBody::Json(body),
        skip_empty_query_string: Some(true),
        ..Default::default()
    }
}

pub fn get_input_skip_empty_query_string(
    endpoint: String,
    path: impl Into<String>,
    query_params: HashMap<String, Value>,
) -> VrchatRequest {
    VrchatRequest {
        endpoint: Some(endpoint),
        method: Some("GET".into()),
        path: Some(path.into()),
        query_params: Some(query_params),
        skip_empty_query_string: Some(true),
        ..Default::default()
    }
}

pub fn build_web_execute_request(
    input: VrchatRequest,
    scope: VrchatScope,
) -> Result<WebExecuteRequest, HttpApiError> {
    let method = input
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase();
    let mut request = WebExecuteRequest::new(build_request_url(&input, scope)?, method.clone());

    if let Some(headers) = input.headers.as_ref().filter(|headers| !headers.is_empty()) {
        request.headers = headers
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
    }

    if let Some(body) = request_body_text(&input, &method)? {
        request.body = Some(body);
    }

    request.upload = match input.body {
        VrchatRequestBody::Upload(VrchatUpload::FilePut {
            file_data,
            file_mime,
            file_md5,
        }) => WebUploadMode::FilePut {
            file_data,
            file_mime,
            file_md5,
        },
        VrchatRequestBody::Upload(VrchatUpload::Image {
            image_data,
            post_data,
            ..
        }) => WebUploadMode::Image {
            image_data,
            post_data,
        },
        VrchatRequestBody::Upload(VrchatUpload::PrintImage {
            image_data,
            post_data,
            ..
        }) => WebUploadMode::PrintImage {
            image_data,
            post_data,
        },
        VrchatRequestBody::Upload(VrchatUpload::LegacyImage {
            image_data,
            post_data,
            ..
        }) => WebUploadMode::LegacyImage {
            image_data,
            post_data,
        },
        VrchatRequestBody::Empty | VrchatRequestBody::Json(_) => WebUploadMode::None,
    };

    Ok(request)
}

fn validated_vrchat_api_endpoint(endpoint: Option<&str>) -> Result<String, HttpApiError> {
    let endpoint = normalize_vrchat_api_endpoint(endpoint);
    let url = parse_http_url(&endpoint)?;
    if url.scheme() != "https"
        || url.host_str() != Some(VRCHAT_API_HOST)
        || url.path().trim_end_matches('/') != "/api/1"
    {
        return Err(HttpApiError::Custom(format!(
            "VRChat API endpoint must be {VRCHAT_API_DEFAULT_ENDPOINT}."
        )));
    }
    Ok(endpoint)
}

fn value_as_query_strings(value: &Value, skip_empty_string: bool) -> Vec<String> {
    match value {
        Value::Null => Vec::new(),
        Value::String(value) => {
            if skip_empty_string && value.is_empty() {
                Vec::new()
            } else {
                vec![value.to_string()]
            }
        }
        Value::Bool(value) => vec![value.to_string()],
        Value::Number(value) => vec![value.to_string()],
        other => vec![other.to_string()],
    }
}

fn append_query_params(url: &mut Url, params: &HashMap<String, Value>, skip_empty_string: bool) {
    for (key, value) in params {
        if let Value::Array(values) = value {
            for item in values {
                for text in value_as_query_strings(item, skip_empty_string) {
                    url.query_pairs_mut().append_pair(key, &text);
                }
            }
            continue;
        }

        let values = value_as_query_strings(value, skip_empty_string);
        if values.len() == 1 {
            url.query_pairs_mut().append_pair(key, &values[0]);
        }
    }
}

fn parse_http_url(url: &str) -> Result<Url, HttpApiError> {
    let url =
        Url::parse(url).map_err(|error| HttpApiError::Custom(format!("bad API URL: {error}")))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(HttpApiError::Custom("unsupported API URL scheme".into()));
    }
    Ok(url)
}

fn is_allowed_vrchat_media_upload_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str().map(|host| host.to_ascii_lowercase()) else {
        return false;
    };

    if host == VRCHAT_FILES_HOST {
        return true;
    }
    if host == VRCHAT_API_HOST {
        return url.path().starts_with("/api/1/file/");
    }
    if host == VRCHAT_FILES_S3_HOST
        || (host.starts_with(VRCHAT_FILES_S3_HOST_PREFIX) && host.ends_with(".amazonaws.com"))
    {
        return true;
    }
    if host.starts_with("s3.") && host.ends_with(".amazonaws.com") {
        return url
            .path_segments()
            .and_then(|segments| segments.into_iter().next())
            == Some(VRCHAT_FILES_HOST);
    }
    false
}

fn validate_vrchat_media_upload_url(url: &Url) -> Result<(), HttpApiError> {
    if is_allowed_vrchat_media_upload_url(url) {
        return Ok(());
    }
    Err(HttpApiError::Custom(
        "VRChat media upload URL must be an official VRChat HTTPS upload target.".into(),
    ))
}

fn is_upload_request(input: &VrchatRequest) -> bool {
    matches!(input.body, VrchatRequestBody::Upload(_))
}

fn validate_upload_scope(input: &VrchatRequest, scope: VrchatScope) -> Result<(), HttpApiError> {
    if is_upload_request(input) && !matches!(scope, VrchatScope::VrchatMedia) {
        return Err(HttpApiError::Custom(
            "upload options are only allowed for VRChat media requests".into(),
        ));
    }
    Ok(())
}

fn build_request_url(input: &VrchatRequest, scope: VrchatScope) -> Result<String, HttpApiError> {
    validate_upload_scope(input, scope)?;

    if let Some(url) = input
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
    {
        let url = parse_http_url(url)?;
        match scope {
            VrchatScope::Vrchat | VrchatScope::VrchatMedia => {
                if matches!(scope, VrchatScope::VrchatMedia) && is_upload_request(input) {
                    validate_vrchat_media_upload_url(&url)?;
                    return Ok(url.to_string());
                }
                return Err(HttpApiError::Custom(
                    "VRChat API requests must use path and endpoint".into(),
                ));
            }
        }
    }

    let path = input
        .path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| HttpApiError::Custom("Missing API request path".into()))?;

    if let Ok(url) = Url::parse(path) {
        match scope {
            VrchatScope::Vrchat | VrchatScope::VrchatMedia => {
                if matches!(scope, VrchatScope::VrchatMedia) && is_upload_request(input) {
                    validate_vrchat_media_upload_url(&url)?;
                    return Ok(url.to_string());
                }
                return Err(HttpApiError::Custom(
                    "VRChat API requests must use relative paths".into(),
                ));
            }
        }
    }

    let base = format!(
        "{}/",
        validated_vrchat_api_endpoint(input.endpoint.as_deref())?
    );
    let mut url = Url::parse(&base)
        .map_err(|error| HttpApiError::Custom(format!("bad API endpoint: {error}")))?
        .join(path.trim_start_matches('/'))
        .map_err(|error| HttpApiError::Custom(format!("bad API path: {error}")))?;

    if let Some(params) = input.query_params.as_ref() {
        append_query_params(
            &mut url,
            params,
            input.skip_empty_query_string.unwrap_or(false),
        );
    }

    Ok(url.to_string())
}

fn normalize_json_body(value: &Value) -> Value {
    if value.is_object() {
        value.clone()
    } else {
        json!({})
    }
}

fn request_body_text(input: &VrchatRequest, method: &str) -> Result<Option<String>, HttpApiError> {
    if method == "GET" {
        return Ok(None);
    }

    let VrchatRequestBody::Json(body) = &input.body else {
        return Ok(None);
    };
    serde_json::to_string(&normalize_json_body(body))
        .map(Some)
        .map_err(|error| HttpApiError::Custom(format!("serialize API body: {error}")))
}

#[cfg(test)]
mod tests;
