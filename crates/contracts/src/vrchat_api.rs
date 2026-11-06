use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VrchatScope {
    Vrchat,
    VrchatMedia,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VrchatResponsePolicy {
    pub class: VrchatResponseClass,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VrchatResponseClass {
    Ok,
    Auth,
    RateLimited,
    ClientError,
    ServerError,
    Unknown,
}

impl VrchatResponseClass {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Auth => "auth",
            Self::RateLimited => "rateLimited",
            Self::ClientError => "clientError",
            Self::ServerError => "serverError",
            Self::Unknown => "unknown",
        }
    }
}

impl std::fmt::Display for VrchatResponseClass {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub enum VrchatRequestBody {
    #[default]
    Empty,
    Json(Value),
    Upload(VrchatUpload),
}

#[derive(Clone, Debug, PartialEq)]
pub enum VrchatUpload {
    FilePut {
        file_data: Vec<u8>,
        file_mime: String,
        file_md5: Option<String>,
    },
    Image {
        image_data: String,
        post_data: Option<String>,
        matching_dimensions: bool,
    },
    PrintImage {
        image_data: String,
        post_data: Option<String>,
        crop_white_border: bool,
    },
    LegacyImage {
        image_data: String,
        post_data: Option<String>,
    },
}

impl VrchatRequestBody {
    pub fn as_json(&self) -> Option<&Value> {
        match self {
            Self::Json(value) => Some(value),
            Self::Empty | Self::Upload(_) => None,
        }
    }

    pub fn as_upload(&self) -> Option<&VrchatUpload> {
        match self {
            Self::Upload(upload) => Some(upload),
            Self::Empty | Self::Json(_) => None,
        }
    }

    pub fn as_upload_mut(&mut self) -> Option<&mut VrchatUpload> {
        match self {
            Self::Upload(upload) => Some(upload),
            Self::Empty | Self::Json(_) => None,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct VrchatRequest {
    pub url: Option<String>,
    pub path: Option<String>,
    pub endpoint: Option<String>,
    pub method: Option<String>,
    pub query_params: Option<HashMap<String, Value>>,
    pub headers: Option<HashMap<String, String>>,
    pub body: VrchatRequestBody,
    pub skip_empty_query_string: Option<bool>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename = "HttpApiExecuteResponse")]
pub struct VrchatResponse {
    pub status: i32,
    pub data: String,
}

#[derive(Clone, Debug)]
pub struct VrchatJsonResponse {
    pub status: i32,
    pub json: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct VrchatFailure {
    pub status_code: i32,
    pub message: String,
}

impl crate::ApplicationErrorSource for VrchatFailure {
    fn into_application_error(self) -> crate::ApplicationErrorPayload {
        crate::ApplicationErrorPayload::VrchatApi {
            status_code: self.status_code,
            message: self.message,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VrchatAuthFailureKind {
    InvalidCredentials,
    MissingCredentials,
    SessionInvalidated,
    Other,
}

impl VrchatJsonResponse {
    pub fn parse(status: i32, data: &str) -> Self {
        Self {
            status,
            json: parse_vrchat_json(data),
        }
    }

    pub fn has_error_field(&self) -> bool {
        self.json
            .as_object()
            .is_some_and(|object| object.contains_key("error"))
    }

    pub fn is_failure(&self) -> bool {
        self.status >= 400 || self.has_error_field()
    }

    pub fn error_message(&self) -> Option<String> {
        let object = self.json.as_object();
        api_message_text(Some(&self.json))
            .or_else(|| api_message_text(object.and_then(|record| record.get("error"))))
            .or_else(|| {
                api_message_text(
                    object
                        .and_then(|record| record.get("error"))
                        .and_then(Value::as_object)
                        .and_then(|error| error.get("message")),
                )
            })
            .or_else(|| api_message_text(object.and_then(|record| record.get("message"))))
    }

    pub fn error_message_or(&self, fallback: &str) -> String {
        self.error_message()
            .unwrap_or_else(|| format!("{fallback} ({})", self.status))
    }

    pub fn error_message_with_http_status(&self, fallback: &str) -> String {
        let message = self.error_message().unwrap_or_else(|| fallback.to_string());
        format!("{message} (HTTP {})", self.status)
    }

    pub fn failure_or(&self, fallback: &str) -> Option<VrchatFailure> {
        if !self.is_failure() {
            return None;
        }
        Some(self.to_failure(fallback))
    }

    pub fn to_failure(&self, fallback: &str) -> VrchatFailure {
        VrchatFailure {
            status_code: self.status,
            message: self.error_message().unwrap_or_else(|| fallback.to_string()),
        }
    }
}

impl From<&VrchatResponse> for VrchatJsonResponse {
    fn from(response: &VrchatResponse) -> Self {
        Self::parse(response.status, &response.data)
    }
}

pub fn vrchat_auth_error_message(response: &VrchatResponse) -> Option<String> {
    let json = serde_json::from_str::<Value>(&response.data).ok()?;
    let object = json.as_object();
    let error = object.and_then(|record| record.get("error"));
    json.as_str()
        .map(ToOwned::to_owned)
        .or_else(|| auth_scalar_text(object.and_then(|record| record.get("message"))))
        .or_else(|| {
            auth_scalar_text(
                error
                    .and_then(Value::as_object)
                    .and_then(|record| record.get("message")),
            )
        })
        .or_else(|| error.and_then(Value::as_str).map(ToOwned::to_owned))
}

pub fn classify_vrchat_auth_failure(response: &VrchatResponse) -> VrchatAuthFailureKind {
    if response.status == 401 {
        let message = vrchat_auth_error_message(response).unwrap_or_default();
        if message.contains("Invalid Username/Email or Password") {
            return VrchatAuthFailureKind::InvalidCredentials;
        }
        if message.contains("Missing Credentials") {
            return VrchatAuthFailureKind::MissingCredentials;
        }
        return VrchatAuthFailureKind::SessionInvalidated;
    }
    if response.status == 403 {
        return VrchatAuthFailureKind::SessionInvalidated;
    }
    VrchatAuthFailureKind::Other
}

pub fn parse_vrchat_json(data: &str) -> Value {
    serde_json::from_str(data).unwrap_or_else(|_| Value::String(data.to_string()))
}

pub fn classify_vrchat_response(status: i32) -> VrchatResponsePolicy {
    let class = match status {
        200..=299 => VrchatResponseClass::Ok,
        401 => VrchatResponseClass::Auth,
        429 => VrchatResponseClass::RateLimited,
        400..=499 => VrchatResponseClass::ClientError,
        500..=599 => VrchatResponseClass::ServerError,
        _ => VrchatResponseClass::Unknown,
    };
    VrchatResponsePolicy { class }
}

pub fn vrchat_response(status: i32, data: String) -> VrchatResponse {
    VrchatResponse { status, data }
}

fn auth_scalar_text(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => Some(text.trim().to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::Bool(flag)) => Some(flag.to_string()),
        _ => None,
    }
    .filter(|text| !text.is_empty())
}

fn api_message_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(|message| message.trim_matches('"').to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn response_policy_and_json_fallback_preserve_the_protocol_contract() {
        assert_eq!(
            classify_vrchat_response(429).class,
            VrchatResponseClass::RateLimited
        );
        assert_eq!(parse_vrchat_json("not-json"), json!("not-json"));
        assert_eq!(
            VrchatJsonResponse::parse(400, r#"{"error":{"message":"failed"}}"#)
                .to_failure("fallback"),
            VrchatFailure {
                status_code: 400,
                message: "failed".into(),
            }
        );
    }
}
