use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;

const STATUS_API_ORIGIN: &str = "https://status.vrchat.com";
const YOUTUBE_API_ORIGIN: &str = "https://www.googleapis.com";
const GITHUB_API_ORIGIN: &str = "https://api.github.com";
const TRANSLATION_GOOGLE_ORIGIN: &str = "https://translation.googleapis.com";
const TRANSLATION_DEEPL_FREE_ORIGIN: &str = "https://api-free.deepl.com";
const TRANSLATION_DEEPL_PRO_ORIGIN: &str = "https://api.deepl.com";
const BACKGROUND_IMAGE_EPIC_ORIGIN: &str = "https://epic.gsfc.nasa.gov";
const BACKGROUND_IMAGE_AIC_ORIGIN: &str = "https://api.artic.edu";
const BACKGROUND_IMAGE_APOD_ORIGIN: &str = "https://api.nasa.gov";
const COMMUNITY_THEME_CATALOG_ORIGIN: &str = "https://raw.githubusercontent.com";
const COMMUNITY_THEME_STATS_ORIGIN: &str = "https://theme.vrcx-0.dev";
const COMMUNITY_THEME_CATALOG_PATH_PREFIX: &str = "/Map1en/VRCX-0-Community-Themes/master/themes/";

#[derive(Debug, thiserror::Error)]
pub enum ExternalApiError {
    #[error("{0}")]
    Custom(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalApiScope {
    AvatarSearch,
    Translation,
    Youtube,
    VrcStatus,
    UpdateRelease,
    GithubContributors,
    Image,
    BackgroundImage,
    CommunityTheme,
}

#[derive(Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalApiResponsePolicy {
    pub class: String,
    pub endpoint_scope: String,
    pub retryable: bool,
    pub rate_limited: bool,
    pub session_recovery_required: bool,
}

#[derive(Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExternalHttpRequestInput {
    pub url: Option<String>,
    pub path: Option<String>,
    pub method: Option<String>,
    pub params: Option<HashMap<String, Value>>,
    pub query_params: Option<HashMap<String, Value>>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<Value>,
    pub json_body: Option<bool>,
    pub skip_empty_query_string: Option<bool>,
}

#[derive(Clone, Debug, Default)]
pub struct ExternalApiPolicy;

impl ExternalApiPolicy {
    pub fn with_allowed_origins<I, S>(origins: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        for origin in origins {
            let _ = normalize_origin(origin.as_ref());
        }
        Self
    }
}

#[derive(Debug, Serialize, specta::Type)]
pub struct ExternalApiExecuteResponse {
    pub status: i32,
    pub data: String,
    pub raw: Value,
}

pub struct ExternalWebExecuteRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub response_body_limit: Option<usize>,
    pub follow_redirects: bool,
}

impl ExternalWebExecuteRequest {
    pub fn new(url: impl Into<String>, method: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: method.into(),
            headers: Vec::new(),
            body: None,
            response_body_limit: None,
            follow_redirects: true,
        }
    }
}

fn external_get_input(url: String, headers: HashMap<String, String>) -> ExternalHttpRequestInput {
    ExternalHttpRequestInput {
        url: Some(url),
        method: Some("GET".into()),
        headers: Some(headers),
        ..Default::default()
    }
}

pub fn avatar_search_get_input(url: &str, vrcx_id: &str) -> ExternalHttpRequestInput {
    external_get_input(
        url.to_string(),
        HashMap::from([("VRCX-ID".to_string(), vrcx_id.to_string())]),
    )
}

pub fn normalize_translation_method(value: &str) -> Result<String, ExternalApiError> {
    let method = value.trim().to_ascii_uppercase();
    let method = if method.is_empty() {
        "GET".to_string()
    } else {
        method
    };
    match method.as_str() {
        "GET" | "POST" => Ok(method),
        _ => Err(ExternalApiError::Custom(
            "ExternalApiTranslationRequest supports only GET or POST.".into(),
        )),
    }
}

pub fn translation_request_input(
    url: &str,
    method: &str,
    headers: HashMap<String, String>,
    body: Value,
) -> Result<ExternalHttpRequestInput, ExternalApiError> {
    Ok(ExternalHttpRequestInput {
        url: Some(url.to_string()),
        method: Some(normalize_translation_method(method)?),
        headers: Some(headers),
        body: (!body.is_null()).then_some(body),
        json_body: Some(false),
        ..Default::default()
    })
}

pub fn youtube_video_metadata_get_input(
    youtube_id: &str,
    api_key: &str,
) -> ExternalHttpRequestInput {
    let mut request = ExternalHttpRequestInput {
        url: Some("https://www.googleapis.com/youtube/v3/videos".into()),
        method: Some("GET".into()),
        query_params: Some(HashMap::from([
            ("id".to_string(), Value::String(youtube_id.to_string())),
            (
                "part".to_string(),
                Value::String("snippet,contentDetails".to_string()),
            ),
            ("key".to_string(), Value::String(api_key.to_string())),
        ])),
        ..Default::default()
    };
    request.params = request.query_params.clone();
    request
}

pub fn vrc_status_json_get_input(path: &str) -> ExternalHttpRequestInput {
    external_get_input(
        format!(
            "{STATUS_API_ORIGIN}/api/v2/{}",
            path.trim_start_matches('/')
        ),
        HashMap::new(),
    )
}

pub fn github_releases_get_input(
    url: &str,
    headers: HashMap<String, String>,
) -> ExternalHttpRequestInput {
    external_get_input(url.to_string(), headers)
}

pub fn github_contributors_get_input(
    url: &str,
    headers: HashMap<String, String>,
) -> ExternalHttpRequestInput {
    external_get_input(url.to_string(), headers)
}

pub fn image_data_url_get_input(url: &str) -> ExternalHttpRequestInput {
    external_get_input(url.to_string(), HashMap::new())
}

pub fn background_image_get_input(url: &str) -> ExternalHttpRequestInput {
    external_get_input(url.to_string(), HashMap::new())
}

pub fn build_web_execute_request(
    input: ExternalHttpRequestInput,
    scope: ExternalApiScope,
) -> Result<ExternalWebExecuteRequest, ExternalApiError> {
    build_web_execute_request_with_policy(input, scope, &ExternalApiPolicy)
}

pub fn build_web_execute_request_with_policy(
    input: ExternalHttpRequestInput,
    scope: ExternalApiScope,
    policy: &ExternalApiPolicy,
) -> Result<ExternalWebExecuteRequest, ExternalApiError> {
    let method = input
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase();
    let mut request =
        ExternalWebExecuteRequest::new(build_request_url(&input, scope, policy)?, method.clone());
    request.follow_redirects = scope != ExternalApiScope::CommunityTheme;

    let headers = sanitize_headers(input.headers.as_ref(), scope)?;
    request.headers = headers.into_iter().collect();

    if let Some(body) = request_body_text(&input, &method)? {
        request.body = Some(body);
    }

    Ok(request)
}

pub fn execute_response(
    status: i32,
    data: String,
    scope: ExternalApiScope,
) -> ExternalApiExecuteResponse {
    let policy = classify_response(status, scope);
    ExternalApiExecuteResponse {
        status,
        data: data.clone(),
        raw: json!({
            "status": status,
            "data": data,
            "policy": policy,
        }),
    }
}

fn classify_response(status: i32, scope: ExternalApiScope) -> ExternalApiResponsePolicy {
    let class = match status {
        200..=399 => "ok",
        401 | 403 => "auth",
        429 => "rateLimited",
        400..=499 => "clientError",
        500..=599 => "serverError",
        _ => "unknown",
    };
    ExternalApiResponsePolicy {
        class: class.to_string(),
        endpoint_scope: scope_name(scope).to_string(),
        retryable: matches!(status, 408 | 409 | 425 | 429 | 500..=599),
        rate_limited: status == 429,
        session_recovery_required: false,
    }
}

fn scope_name(scope: ExternalApiScope) -> &'static str {
    match scope {
        ExternalApiScope::AvatarSearch => "externalAvatarSearch",
        ExternalApiScope::Translation => "externalTranslation",
        ExternalApiScope::Youtube => "externalYoutube",
        ExternalApiScope::VrcStatus => "externalVrcStatus",
        ExternalApiScope::UpdateRelease => "externalUpdateRelease",
        ExternalApiScope::GithubContributors => "externalGithubContributors",
        ExternalApiScope::Image => "externalImage",
        ExternalApiScope::BackgroundImage => "externalBackgroundImage",
        ExternalApiScope::CommunityTheme => "externalCommunityTheme",
    }
}

fn build_request_url(
    input: &ExternalHttpRequestInput,
    scope: ExternalApiScope,
    policy: &ExternalApiPolicy,
) -> Result<String, ExternalApiError> {
    let url = input
        .url
        .as_deref()
        .or(input.path.as_deref())
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .ok_or_else(|| ExternalApiError::Custom("external API requests require url".into()))?;
    let mut url = parse_http_url(url)?;
    if !external_url_allowed(&url, scope, policy) {
        return Err(ExternalApiError::Custom(
            "external API URL is not allowed for this command".into(),
        ));
    }

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

fn parse_http_url(url: &str) -> Result<Url, ExternalApiError> {
    let url = Url::parse(url)
        .map_err(|error| ExternalApiError::Custom(format!("bad API URL: {error}")))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(ExternalApiError::Custom(
            "unsupported API URL scheme".into(),
        ));
    }
    Ok(url)
}

fn external_url_allowed(url: &Url, scope: ExternalApiScope, policy: &ExternalApiPolicy) -> bool {
    let _ = policy;
    let origin = url_origin(url);
    match scope {
        ExternalApiScope::AvatarSearch | ExternalApiScope::Image => true,
        ExternalApiScope::Translation => {
            (origin == TRANSLATION_GOOGLE_ORIGIN
                && url.path().starts_with("/language/translate/v2"))
                || ((origin == TRANSLATION_DEEPL_FREE_ORIGIN
                    || origin == TRANSLATION_DEEPL_PRO_ORIGIN)
                    && url.path().starts_with("/v2/translate"))
        }
        ExternalApiScope::Youtube => {
            origin == YOUTUBE_API_ORIGIN && url.path().starts_with("/youtube/v3/videos")
        }
        ExternalApiScope::VrcStatus => {
            origin == STATUS_API_ORIGIN && url.path().starts_with("/api/v2/")
        }
        ExternalApiScope::UpdateRelease => {
            origin == GITHUB_API_ORIGIN
                && url.path().starts_with("/repos/")
                && url.path().ends_with("/releases")
        }
        ExternalApiScope::GithubContributors => {
            origin == GITHUB_API_ORIGIN
                && url.path().starts_with("/repos/")
                && url.path().ends_with("/contributors")
        }
        ExternalApiScope::BackgroundImage => {
            (origin == BACKGROUND_IMAGE_EPIC_ORIGIN && url.path().starts_with("/api/natural"))
                || (origin == BACKGROUND_IMAGE_AIC_ORIGIN
                    && url.path().starts_with("/api/v1/artworks/search"))
                || (origin == BACKGROUND_IMAGE_APOD_ORIGIN
                    && url.path().starts_with("/planetary/apod"))
        }
        ExternalApiScope::CommunityTheme => {
            (origin == COMMUNITY_THEME_CATALOG_ORIGIN
                && url.path().starts_with(COMMUNITY_THEME_CATALOG_PATH_PREFIX))
                || (origin == COMMUNITY_THEME_STATS_ORIGIN
                    && (url.path() == "/v1/themes/stats"
                        || (url.path().starts_with("/v1/themes/")
                            && url.path().ends_with("/install"))))
        }
    }
}

pub fn request_origin(value: &str) -> Option<String> {
    Url::parse(value)
        .ok()
        .and_then(|url| normalize_url_origin(&url))
}

fn normalize_origin(value: &str) -> Option<String> {
    Url::parse(value.trim())
        .ok()
        .and_then(|url| normalize_url_origin(&url))
}

fn normalize_url_origin(url: &Url) -> Option<String> {
    if url.scheme() != "https" && url.scheme() != "http" {
        return None;
    }
    Some(url_origin(url))
}

fn url_origin(url: &Url) -> String {
    url.origin().unicode_serialization()
}

fn sanitize_headers(
    headers: Option<&HashMap<String, String>>,
    scope: ExternalApiScope,
) -> Result<HashMap<String, String>, ExternalApiError> {
    let Some(headers) = headers else {
        return Ok(HashMap::new());
    };
    let mut sanitized = HashMap::new();
    for (name, value) in headers {
        let normalized = name.trim().to_ascii_lowercase();
        if matches!(
            normalized.as_str(),
            "host"
                | "cookie"
                | "proxy-authorization"
                | "connection"
                | "content-length"
                | "transfer-encoding"
        ) {
            return Err(ExternalApiError::Custom(format!(
                "external API header is not allowed: {name}"
            )));
        }
        if normalized == "authorization" && scope != ExternalApiScope::Translation {
            return Err(ExternalApiError::Custom(format!(
                "external API header is not allowed: {name}"
            )));
        }
        if normalized == "authorization" && !valid_translation_authorization(value) {
            return Err(ExternalApiError::Custom(
                "translation authorization must use Bearer or DeepL-Auth-Key syntax.".into(),
            ));
        }
        if name.chars().any(|ch| ch.is_control())
            || value.chars().any(|ch| matches!(ch, '\r' | '\n'))
        {
            return Err(ExternalApiError::Custom(format!(
                "external API header contains invalid characters: {name}"
            )));
        }
        if !name.trim().is_empty() {
            sanitized.insert(name.trim().to_string(), value.to_string());
        }
    }
    Ok(sanitized)
}

fn valid_translation_authorization(value: &str) -> bool {
    let normalized = value.trim_start().to_ascii_lowercase();
    normalized.starts_with("bearer ") || normalized.starts_with("deepl-auth-key ")
}

fn request_body_text(
    input: &ExternalHttpRequestInput,
    method: &str,
) -> Result<Option<String>, ExternalApiError> {
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
        .map_err(|error| ExternalApiError::Custom(format!("serialize API body: {error}")))
}

fn normalize_json_body(value: &Value) -> Value {
    if value.is_object() {
        value.clone()
    } else {
        json!({})
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

#[cfg(test)]
mod tests;
