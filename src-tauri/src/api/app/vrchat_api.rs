#![allow(non_snake_case)]

use std::collections::HashMap;

use reqwest::Url;
use serde_json::{json, Value};
use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

use super::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};

const DEFAULT_VRCHAT_API_ENDPOINT: &str = "https://api.vrchat.cloud/api/1";
const STATUS_API_ORIGIN: &str = "https://status.vrchat.com";
const YOUTUBE_API_ORIGIN: &str = "https://www.googleapis.com";
const GITHUB_API_ORIGIN: &str = "https://api.github.com";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ApiScope {
    Vrchat,
    VrchatMedia,
    External(ExternalApiScope),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExternalApiScope {
    AvatarSearch,
    Translation,
    Youtube,
    VrcStatus,
    UpdateRelease,
    Image,
}

fn normalize_endpoint(endpoint: Option<&str>) -> String {
    let endpoint = endpoint.unwrap_or("").trim().trim_end_matches('/');
    if endpoint.is_empty() {
        DEFAULT_VRCHAT_API_ENDPOINT.to_string()
    } else {
        endpoint.to_string()
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

fn parse_http_url(url: &str) -> Result<Url, AppError> {
    let url = Url::parse(url).map_err(|error| AppError::Custom(format!("bad API URL: {error}")))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(AppError::Custom("unsupported API URL scheme".into()));
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
        ExternalApiScope::UpdateRelease => origin == GITHUB_API_ORIGIN,
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

fn validate_upload_scope(input: &HttpApiRequestInput, scope: ApiScope) -> Result<(), AppError> {
    if is_upload_request(input) && !matches!(scope, ApiScope::VrchatMedia) {
        return Err(AppError::Custom(
            "upload options are only allowed for VRChat media requests".into(),
        ));
    }
    Ok(())
}

fn build_request_url(input: &HttpApiRequestInput, scope: ApiScope) -> Result<String, AppError> {
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
                return Err(AppError::Custom(
                    "VRChat API requests must use path and endpoint".into(),
                ));
            }
            ApiScope::External(external_scope) => {
                if !external_url_allowed(&url, external_scope) {
                    return Err(AppError::Custom(
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
        .ok_or_else(|| AppError::Custom("Missing API request path".into()))?;

    if let Ok(url) = Url::parse(path) {
        match scope {
            ApiScope::Vrchat | ApiScope::VrchatMedia => {
                if matches!(scope, ApiScope::VrchatMedia) && is_upload_request(input) {
                    return Ok(url.to_string());
                }
                return Err(AppError::Custom(
                    "VRChat API requests must use relative paths".into(),
                ));
            }
            ApiScope::External(external_scope) => {
                if !external_url_allowed(&url, external_scope) {
                    return Err(AppError::Custom(
                        "external API URL is not allowed for this command".into(),
                    ));
                }
                return Ok(url.to_string());
            }
        }
    }

    if !matches!(scope, ApiScope::Vrchat | ApiScope::VrchatMedia) {
        return Err(AppError::Custom(
            "external API requests must use absolute URLs".into(),
        ));
    }

    let base = format!("{}/", normalize_endpoint(input.endpoint.as_deref()));
    let mut url = Url::parse(&base)
        .map_err(|error| AppError::Custom(format!("bad API endpoint: {error}")))?
        .join(path.trim_start_matches('/'))
        .map_err(|error| AppError::Custom(format!("bad API path: {error}")))?;

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
) -> Result<Option<String>, AppError> {
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
        .map_err(|error| AppError::Custom(format!("serialize API body: {error}")))
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

fn build_web_execute_options(
    input: HttpApiRequestInput,
    scope: ApiScope,
) -> Result<HashMap<String, Value>, AppError> {
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

async fn execute_http_api(
    state: State<'_, AppState>,
    input: HttpApiRequestInput,
    scope: ApiScope,
) -> Result<HttpApiExecuteResponse, AppError> {
    let save_cookies = matches!(scope, ApiScope::Vrchat | ApiScope::VrchatMedia);
    let options = build_web_execute_options(input, scope)?;
    let (status, data) = state.web.execute(options).await?;
    if save_cookies {
        state.web.save_cookies(&state.db);
    }

    if status == -1 {
        return Err(AppError::Custom(data));
    }

    Ok(HttpApiExecuteResponse {
        status,
        data: data.clone(),
        raw: json!({
            "status": status,
            "data": data,
        }),
    })
}

macro_rules! api_execute_command {
    ($name:ident, $scope:expr) => {
        #[tauri::command]
        pub async fn $name(
            state: State<'_, AppState>,
            input: HttpApiRequestInput,
        ) -> Result<HttpApiExecuteResponse, AppError> {
            let command = stringify!($name);
            let diagnostics = state.backend_context.diagnostics.clone();
            let sync = state.backend_context.sync.clone();
            diagnostics.record_command(command, "running", "HTTP API request dispatched.");
            let result = execute_http_api(state, input, $scope).await;
            match &result {
                Ok(response) => {
                    diagnostics.record_command(
                        command,
                        "ok",
                        format!("status={}", response.status),
                    );
                    sync.record(
                        "api",
                        "ready",
                        format!("{command} completed with status {}.", response.status),
                        0,
                    );
                }
                Err(error) => {
                    diagnostics.record_command(command, "error", error.to_string());
                    sync.record_failure("api", error.to_string());
                }
            }
            result
        }
    };
}

api_execute_command!(app__vrchat_auth_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_friend_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_favorite_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_search_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_avatar_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_world_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_group_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_instance_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_notification_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_moderation_execute, ApiScope::Vrchat);
api_execute_command!(app__vrchat_media_execute, ApiScope::VrchatMedia);
api_execute_command!(app__vrchat_tools_execute, ApiScope::Vrchat);
api_execute_command!(
    app__external_avatar_search_execute,
    ApiScope::External(ExternalApiScope::AvatarSearch)
);
api_execute_command!(
    app__external_translation_execute,
    ApiScope::External(ExternalApiScope::Translation)
);
api_execute_command!(
    app__external_youtube_execute,
    ApiScope::External(ExternalApiScope::Youtube)
);
api_execute_command!(
    app__external_vrc_status_execute,
    ApiScope::External(ExternalApiScope::VrcStatus)
);
api_execute_command!(
    app__external_update_release_execute,
    ApiScope::External(ExternalApiScope::UpdateRelease)
);
api_execute_command!(
    app__external_image_execute,
    ApiScope::External(ExternalApiScope::Image)
);

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
