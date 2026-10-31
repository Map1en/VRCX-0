use std::time::Duration;

use serde_json::Value;
use url::Url;
use vrcx_0_core::json::JsonExt;

use crate::vrchat_api::{vrchat_auth_error_message, VrchatResponse};

const VERIFICATION_HOST: &str = "vrchat.com";
const VERIFICATION_PATH: &str = "/home/device";
const DEFAULT_INTERVAL_SECS: u64 = 5;
const MIN_INTERVAL_SECS: u64 = 5;
const MAX_INTERVAL_SECS: u64 = 60;
const SLOW_DOWN_STEP_SECS: u64 = 5;
const MAX_EXPIRES_IN_SECS: u64 = 300;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VrchatDeviceAuthorization {
    pub device_code: String,
    pub verification_url: String,
    pub interval: Duration,
    pub expires_in: Duration,
}

impl VrchatDeviceAuthorization {
    pub fn expires_at_unix_millis(&self, now_millis: i64) -> i64 {
        now_millis.saturating_add(i64::try_from(self.expires_in.as_millis()).unwrap_or(0))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VrchatDeviceStatus {
    Approved,
    Pending,
    SlowDown,
    Expired,
    Denied,
    Failed { reason: String },
}

pub fn interpret_device_code_response(
    response: &VrchatResponse,
) -> Result<VrchatDeviceAuthorization, String> {
    if response.status != 200 {
        return Err(vrchat_auth_error_message(response).unwrap_or_else(|| {
            format!(
                "VRChat device login request failed with HTTP {}.",
                response.status
            )
        }));
    }
    let json = serde_json::from_str::<Value>(&response.data)
        .map_err(|error| format!("parse device login response: {error}"))?;
    let device_code = json.scalar_field("deviceCode").unwrap_or_default();
    if device_code.is_empty() {
        return Err("VRChat did not return a device code.".into());
    }
    let verification_url = json
        .scalar_field("verificationUrlComplete")
        .unwrap_or_default();
    if !is_trusted_verification_url(&verification_url) {
        return Err("VRChat returned an unexpected device verification address.".into());
    }
    let interval_secs = json
        .get("interval")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_INTERVAL_SECS)
        .clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS);
    let expires_in_secs = json
        .get("expiresIn")
        .and_then(Value::as_u64)
        .unwrap_or(MAX_EXPIRES_IN_SECS)
        .clamp(1, MAX_EXPIRES_IN_SECS);
    Ok(VrchatDeviceAuthorization {
        device_code,
        verification_url,
        interval: Duration::from_secs(interval_secs),
        expires_in: Duration::from_secs(expires_in_secs),
    })
}

pub fn interpret_device_status_response(response: &VrchatResponse) -> VrchatDeviceStatus {
    if response.status == 429 {
        return VrchatDeviceStatus::SlowDown;
    }
    let json = serde_json::from_str::<Value>(&response.data).ok();
    if response.status == 200 && json.as_ref().is_some_and(|json| json.get("user").is_some()) {
        return VrchatDeviceStatus::Approved;
    }
    let message = vrchat_auth_error_message(response).unwrap_or_default();
    match message.as_str() {
        "authorization_pending" => VrchatDeviceStatus::Pending,
        "slow_down" => VrchatDeviceStatus::SlowDown,
        "expired_token" => VrchatDeviceStatus::Expired,
        "access_denied" => VrchatDeviceStatus::Denied,
        _ if response.status == 200 => VrchatDeviceStatus::Pending,
        "" => VrchatDeviceStatus::Failed {
            reason: format!(
                "VRChat device login status failed with HTTP {}.",
                response.status
            ),
        },
        _ => VrchatDeviceStatus::Failed { reason: message },
    }
}

pub fn slowed_device_poll_interval(interval: Duration) -> Duration {
    (interval + Duration::from_secs(SLOW_DOWN_STEP_SECS))
        .min(Duration::from_secs(MAX_INTERVAL_SECS))
}

fn is_trusted_verification_url(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some(VERIFICATION_HOST)
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == VERIFICATION_PATH
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::vrchat_api::vrchat_response;

    fn response(status: i32, data: Value) -> VrchatResponse {
        vrchat_response(status, data.to_string())
    }

    #[test]
    fn device_code_response_clamps_timing_and_keeps_the_verification_link() {
        let authorization = interpret_device_code_response(&response(
            200,
            json!({
                "deviceCode": "dev_1",
                "verificationUrlComplete": "https://vrchat.com/home/device?code=ABCD",
                "interval": 1,
                "expiresIn": 9000
            }),
        ))
        .unwrap();

        assert_eq!(
            authorization,
            VrchatDeviceAuthorization {
                device_code: "dev_1".into(),
                verification_url: "https://vrchat.com/home/device?code=ABCD".into(),
                interval: Duration::from_secs(5),
                expires_in: Duration::from_secs(300),
            }
        );
    }

    #[test]
    fn device_code_response_rejects_verification_links_outside_vrchat() {
        for url in [
            "http://vrchat.com/home/device?code=A",
            "https://vrchat.com.evil.example/home/device?code=A",
            "https://evil.example/home/device?code=A",
            "https://vrchat.com/home/login?code=A",
            "https://user@vrchat.com/home/device?code=A",
        ] {
            let result = interpret_device_code_response(&response(
                200,
                json!({ "deviceCode": "dev_1", "verificationUrlComplete": url }),
            ));
            assert!(result.is_err(), "{url} must be rejected");
        }
    }

    #[test]
    fn device_status_response_classifies_the_polling_outcomes() {
        let error = |message: &str| response(400, json!({ "error": { "message": message } }));

        assert_eq!(
            interpret_device_status_response(&response(200, json!({ "user": { "id": "usr_1" } }))),
            VrchatDeviceStatus::Approved
        );
        assert_eq!(
            interpret_device_status_response(&error("authorization_pending")),
            VrchatDeviceStatus::Pending
        );
        assert_eq!(
            interpret_device_status_response(&error("slow_down")),
            VrchatDeviceStatus::SlowDown
        );
        assert_eq!(
            interpret_device_status_response(&response(429, json!({}))),
            VrchatDeviceStatus::SlowDown
        );
        assert_eq!(
            interpret_device_status_response(&error("expired_token")),
            VrchatDeviceStatus::Expired
        );
        assert_eq!(
            interpret_device_status_response(&error("access_denied")),
            VrchatDeviceStatus::Denied
        );
        assert_eq!(
            interpret_device_status_response(&error("Something broke")),
            VrchatDeviceStatus::Failed {
                reason: "Something broke".into()
            }
        );
    }

    #[test]
    fn slow_down_backs_off_without_exceeding_the_ceiling() {
        assert_eq!(
            slowed_device_poll_interval(Duration::from_secs(5)),
            Duration::from_secs(10)
        );
        assert_eq!(
            slowed_device_poll_interval(Duration::from_secs(58)),
            Duration::from_secs(60)
        );
    }
}
