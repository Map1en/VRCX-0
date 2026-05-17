use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;

const DEFAULT_VRCHAT_API_ENDPOINT: &str = "https://api.vrchat.cloud/api/1";
const STATUS_API_ORIGIN: &str = "https://status.vrchat.com";
const YOUTUBE_API_ORIGIN: &str = "https://www.googleapis.com";
const GITHUB_API_ORIGIN: &str = "https://api.github.com";

#[derive(Debug, thiserror::Error)]
pub enum HttpApiError {
    #[error("{0}")]
    Custom(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiScope {
    Vrchat,
    VrchatMedia,
    External(ExternalApiScope),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalApiScope {
    AvatarSearch,
    Translation,
    Youtube,
    VrcStatus,
    UpdateRelease,
    Image,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponsePolicy {
    pub class: String,
    pub endpoint_scope: String,
    pub retryable: bool,
    pub rate_limited: bool,
    pub session_recovery_required: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpApiRequestInput {
    pub url: Option<String>,
    pub path: Option<String>,
    pub endpoint: Option<String>,
    pub method: Option<String>,
    pub params: Option<HashMap<String, Value>>,
    pub query_params: Option<HashMap<String, Value>>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<Value>,
    pub json_body: Option<bool>,
    pub skip_empty_query_string: Option<bool>,

    #[serde(rename = "uploadFilePUT")]
    pub upload_file_put: Option<bool>,
    #[serde(rename = "uploadImage")]
    pub upload_image: Option<bool>,
    #[serde(rename = "uploadImagePrint")]
    pub upload_image_print: Option<bool>,
    #[serde(rename = "uploadImageLegacy")]
    pub upload_image_legacy: Option<bool>,
    pub matching_dimensions: Option<bool>,
    pub crop_white_border: Option<bool>,
    pub post_data: Option<String>,
    pub image_data: Option<String>,
    pub file_data: Option<String>,
    #[serde(rename = "fileMIME")]
    pub file_mime: Option<String>,
    #[serde(rename = "fileMD5")]
    pub file_md5: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HttpApiExecuteResponse {
    pub status: i32,
    pub data: String,
    pub raw: Value,
}

pub fn scope_saves_cookies(scope: ApiScope) -> bool {
    matches!(scope, ApiScope::Vrchat | ApiScope::VrchatMedia)
}

pub fn classify_api_response(status: i32, scope: ApiScope) -> ApiResponsePolicy {
    let class = match status {
        200..=399 => "ok",
        401 | 403 => "auth",
        429 => "rateLimited",
        400..=499 => "clientError",
        500..=599 => "serverError",
        _ => "unknown",
    };
    ApiResponsePolicy {
        class: class.to_string(),
        endpoint_scope: api_scope_name(scope).to_string(),
        retryable: matches!(status, 408 | 409 | 425 | 429 | 500..=599),
        rate_limited: status == 429,
        session_recovery_required: matches!(scope, ApiScope::Vrchat | ApiScope::VrchatMedia)
            && status == 401,
    }
}

pub fn execute_response(status: i32, data: String, scope: ApiScope) -> HttpApiExecuteResponse {
    let policy = classify_api_response(status, scope);
    HttpApiExecuteResponse {
        status,
        data: data.clone(),
        raw: json!({
            "status": status,
            "data": data,
            "policy": policy,
        }),
    }
}

pub fn build_web_execute_options(
    input: HttpApiRequestInput,
    scope: ApiScope,
) -> Result<HashMap<String, Value>, HttpApiError> {
    let method = input
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase();
    let mut options = HashMap::new();
    options.insert(
        "url".to_string(),
        Value::String(build_request_url(&input, scope)?),
    );
    options.insert("method".to_string(), Value::String(method.clone()));

    if let Some(headers) = input.headers.as_ref().filter(|headers| !headers.is_empty()) {
        options.insert(
            "headers".to_string(),
            serde_json::to_value(headers).unwrap_or(Value::Null),
        );
    }

    if let Some(body) = request_body_text(&input, &method)? {
        options.insert("body".to_string(), Value::String(body));
    }

    if input.upload_file_put.unwrap_or(false) {
        options.insert("uploadFilePUT".to_string(), Value::Bool(true));
    }
    if input.upload_image.unwrap_or(false) {
        options.insert("uploadImage".to_string(), Value::Bool(true));
    }
    if input.upload_image_print.unwrap_or(false) {
        options.insert("uploadImagePrint".to_string(), Value::Bool(true));
    }
    if input.upload_image_legacy.unwrap_or(false) {
        options.insert("uploadImageLegacy".to_string(), Value::Bool(true));
    }
    insert_bool_option(
        &mut options,
        "matchingDimensions",
        input.matching_dimensions,
    );
    insert_bool_option(&mut options, "cropWhiteBorder", input.crop_white_border);
    insert_string_option(&mut options, "postData", &input.post_data);
    insert_string_option(&mut options, "imageData", &input.image_data);
    insert_string_option(&mut options, "fileData", &input.file_data);
    insert_string_option(&mut options, "fileMIME", &input.file_mime);
    insert_string_option(&mut options, "fileMD5", &input.file_md5);

    Ok(options)
}

pub fn normalize_vrchat_api_endpoint(endpoint: Option<&str>) -> String {
    let endpoint = endpoint.unwrap_or("").trim().trim_end_matches('/');
    if endpoint.is_empty() {
        DEFAULT_VRCHAT_API_ENDPOINT.to_string()
    } else {
        endpoint.to_string()
    }
}

fn api_scope_name(scope: ApiScope) -> &'static str {
    match scope {
        ApiScope::Vrchat => "vrchat",
        ApiScope::VrchatMedia => "vrchatMedia",
        ApiScope::External(ExternalApiScope::AvatarSearch) => "externalAvatarSearch",
        ApiScope::External(ExternalApiScope::Translation) => "externalTranslation",
        ApiScope::External(ExternalApiScope::Youtube) => "externalYoutube",
        ApiScope::External(ExternalApiScope::VrcStatus) => "externalVrcStatus",
        ApiScope::External(ExternalApiScope::UpdateRelease) => "externalUpdateRelease",
        ApiScope::External(ExternalApiScope::Image) => "externalImage",
    }
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

fn url_origin(url: &Url) -> String {
    match url.port() {
        Some(port) => format!(
            "{}://{}:{}",
            url.scheme(),
            url.host_str().unwrap_or(""),
            port
        ),
        None => format!("{}://{}", url.scheme(), url.host_str().unwrap_or("")),
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

fn external_url_allowed(url: &Url, scope: ExternalApiScope) -> bool {
    let origin = url_origin(url);
    match scope {
        ExternalApiScope::AvatarSearch | ExternalApiScope::Translation => {
            matches!(url.scheme(), "https" | "http")
        }
        ExternalApiScope::Youtube => {
            origin == YOUTUBE_API_ORIGIN && url.path().starts_with("/youtube/v3/videos")
        }
        ExternalApiScope::VrcStatus => origin == STATUS_API_ORIGIN,
        ExternalApiScope::UpdateRelease => {
            origin == GITHUB_API_ORIGIN
                && url.path().starts_with("/repos/")
                && url.path().ends_with("/releases")
        }
        ExternalApiScope::Image => matches!(url.scheme(), "https" | "http"),
    }
}

fn is_upload_request(input: &HttpApiRequestInput) -> bool {
    input.upload_file_put.unwrap_or(false)
        || input.upload_image.unwrap_or(false)
        || input.upload_image_print.unwrap_or(false)
        || input.upload_image_legacy.unwrap_or(false)
        || input.image_data.is_some()
        || input.file_data.is_some()
        || input.file_md5.is_some()
        || input.file_mime.is_some()
        || input.post_data.is_some()
        || input.matching_dimensions.is_some()
        || input.crop_white_border.is_some()
}

fn validate_upload_scope(input: &HttpApiRequestInput, scope: ApiScope) -> Result<(), HttpApiError> {
    if is_upload_request(input) && !matches!(scope, ApiScope::VrchatMedia) {
        return Err(HttpApiError::Custom(
            "upload options are only allowed for VRChat media requests".into(),
        ));
    }
    Ok(())
}

fn build_request_url(input: &HttpApiRequestInput, scope: ApiScope) -> Result<String, HttpApiError> {
    validate_upload_scope(input, scope)?;

    if let Some(url) = input
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
    {
        let url = parse_http_url(url)?;
        match scope {
            ApiScope::Vrchat | ApiScope::VrchatMedia => {
                if matches!(scope, ApiScope::VrchatMedia) && is_upload_request(input) {
                    return Ok(url.to_string());
                }
                return Err(HttpApiError::Custom(
                    "VRChat API requests must use path and endpoint".into(),
                ));
            }
            ApiScope::External(external_scope) => {
                if !external_url_allowed(&url, external_scope) {
                    return Err(HttpApiError::Custom(
                        "external API URL is not allowed for this command".into(),
                    ));
                }
                return Ok(url.to_string());
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
            ApiScope::Vrchat | ApiScope::VrchatMedia => {
                if matches!(scope, ApiScope::VrchatMedia) && is_upload_request(input) {
                    return Ok(url.to_string());
                }
                return Err(HttpApiError::Custom(
                    "VRChat API requests must use relative paths".into(),
                ));
            }
            ApiScope::External(external_scope) => {
                if !external_url_allowed(&url, external_scope) {
                    return Err(HttpApiError::Custom(
                        "external API URL is not allowed for this command".into(),
                    ));
                }
                return Ok(url.to_string());
            }
        }
    }

    if !matches!(scope, ApiScope::Vrchat | ApiScope::VrchatMedia) {
        return Err(HttpApiError::Custom(
            "external API requests must use absolute URLs".into(),
        ));
    }

    let base = format!(
        "{}/",
        normalize_vrchat_api_endpoint(input.endpoint.as_deref())
    );
    let mut url = Url::parse(&base)
        .map_err(|error| HttpApiError::Custom(format!("bad API endpoint: {error}")))?
        .join(path.trim_start_matches('/'))
        .map_err(|error| HttpApiError::Custom(format!("bad API path: {error}")))?;

    let query_params = input.query_params.as_ref().or(input.params.as_ref());
    if let Some(params) = query_params {
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

fn request_body_text(
    input: &HttpApiRequestInput,
    method: &str,
) -> Result<Option<String>, HttpApiError> {
    if method == "GET" {
        return Ok(None);
    }

    let json_body = input.json_body.unwrap_or(true);
    if !json_body {
        return Ok(input.body.as_ref().and_then(|value| {
            value
                .as_str()
                .map(ToString::to_string)
                .or_else(|| (!value.is_null()).then(|| value.to_string()))
        }));
    }

    let body = input.body.as_ref().unwrap_or(&Value::Null);
    serde_json::to_string(&normalize_json_body(body))
        .map(Some)
        .map_err(|error| HttpApiError::Custom(format!("serialize API body: {error}")))
}

fn insert_bool_option(options: &mut HashMap<String, Value>, key: &str, value: Option<bool>) {
    if let Some(value) = value {
        options.insert(key.to_string(), Value::Bool(value));
    }
}

fn insert_string_option(options: &mut HashMap<String, Value>, key: &str, value: &Option<String>) {
    if let Some(value) = value.as_deref() {
        options.insert(key.to_string(), Value::String(value.to_string()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(path: &str) -> HttpApiRequestInput {
        HttpApiRequestInput {
            path: Some(path.to_string()),
            ..Default::default()
        }
    }

    #[test]
    fn builds_vrchat_url_with_query_arrays_and_skipped_values() {
        let mut request = input("worlds");
        request.endpoint = Some("https://api.example.test/api/1/".to_string());
        request.query_params = Some(HashMap::from([
            ("tag".to_string(), json!(["featured", null, "labs", ""])),
            ("n".to_string(), json!(50)),
            ("ignored".to_string(), Value::Null),
        ]));
        request.skip_empty_query_string = Some(true);

        let url = Url::parse(&build_request_url(&request, ApiScope::Vrchat).unwrap()).unwrap();
        assert_eq!(
            format!("{}{}", url.origin().unicode_serialization(), url.path()),
            "https://api.example.test/api/1/worlds"
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
    fn rejects_absolute_urls_for_vrchat_scopes() {
        let request = HttpApiRequestInput {
            url: Some("https://example.com/".to_string()),
            ..Default::default()
        };
        assert!(build_request_url(&request, ApiScope::Vrchat).is_err());

        let request = input("https://example.com/");
        assert!(build_request_url(&request, ApiScope::VrchatMedia).is_err());
    }

    #[test]
    fn rejects_upload_options_outside_media_scope() {
        let mut request = input("auth/user");
        request.upload_image = Some(true);
        assert!(build_request_url(&request, ApiScope::Vrchat).is_err());

        request.path = Some("file/image".to_string());
        assert!(build_request_url(&request, ApiScope::VrchatMedia).is_ok());
    }

    #[test]
    fn allows_signed_absolute_upload_urls_for_media_scope() {
        let mut request = HttpApiRequestInput {
            url: Some("https://signed-upload.example.test/file".to_string()),
            ..Default::default()
        };
        assert!(build_request_url(&request, ApiScope::VrchatMedia).is_err());

        request.upload_file_put = Some(true);
        let url = build_request_url(&request, ApiScope::VrchatMedia).unwrap();
        assert_eq!(url, "https://signed-upload.example.test/file");
    }

    #[test]
    fn allows_only_expected_external_urls_for_scopes() {
        let mut request = HttpApiRequestInput {
            url: Some("https://status.vrchat.com/api/v2/status.json".to_string()),
            ..Default::default()
        };
        assert!(
            build_request_url(&request, ApiScope::External(ExternalApiScope::VrcStatus)).is_ok()
        );
        assert!(
            build_request_url(&request, ApiScope::External(ExternalApiScope::Youtube)).is_err()
        );

        request.url = Some("https://www.googleapis.com/youtube/v3/videos?id=abc".to_string());
        assert!(build_request_url(&request, ApiScope::External(ExternalApiScope::Youtube)).is_ok());

        request.url = Some("https://avatars.example.test/search?search=robot".to_string());
        assert!(
            build_request_url(&request, ApiScope::External(ExternalApiScope::AvatarSearch)).is_ok()
        );

        request.url = Some("https://llm.example.test/v1/chat/completions".to_string());
        assert!(
            build_request_url(&request, ApiScope::External(ExternalApiScope::Translation)).is_ok()
        );

        request.url = Some("https://api.github.com/repos/Map1en/VRCX-0/releases".to_string());
        assert!(build_request_url(
            &request,
            ApiScope::External(ExternalApiScope::UpdateRelease)
        )
        .is_ok());

        request.url = Some("https://api.github.com/rate_limit".to_string());
        assert!(build_request_url(
            &request,
            ApiScope::External(ExternalApiScope::UpdateRelease)
        )
        .is_err());
    }

    #[test]
    fn classifies_auth_and_rate_limit_statuses_for_backend_policy() {
        let auth = classify_api_response(401, ApiScope::Vrchat);
        assert_eq!(auth.class, "auth");
        assert!(auth.session_recovery_required);
        assert!(!auth.rate_limited);
        assert!(!auth.retryable);

        let forbidden = classify_api_response(403, ApiScope::Vrchat);
        assert_eq!(forbidden.class, "auth");
        assert!(!forbidden.session_recovery_required);
        assert!(!forbidden.retryable);

        let rate_limited = classify_api_response(429, ApiScope::Vrchat);
        assert_eq!(rate_limited.class, "rateLimited");
        assert!(rate_limited.rate_limited);
        assert!(rate_limited.retryable);
        assert!(!rate_limited.session_recovery_required);

        let external_auth =
            classify_api_response(401, ApiScope::External(ExternalApiScope::Translation));
        assert_eq!(external_auth.class, "auth");
        assert!(!external_auth.session_recovery_required);
    }

    #[test]
    fn json_body_false_without_body_does_not_emit_body_option() {
        let mut request = input("favorites/fav_1");
        request.method = Some("DELETE".to_string());
        request.json_body = Some(false);
        request.params = Some(HashMap::from([("objectId".to_string(), json!("fav_1"))]));

        let options = build_web_execute_options(request, ApiScope::Vrchat).unwrap();
        assert!(!options.contains_key("body"));
        assert_eq!(
            options.get("method").and_then(Value::as_str),
            Some("DELETE")
        );
    }
}
