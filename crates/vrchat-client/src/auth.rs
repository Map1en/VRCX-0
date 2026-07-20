use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::json;

use crate::http_api::{
    api_input, encode_path_segment, get_input, normalize_text, require_text, HttpApiError,
    HttpApiRequestInput,
};

pub fn encode_uri_component(value: &str) -> String {
    let mut output = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => output.push(char::from(*byte)),
            _ => output.push_str(&format!("%{byte:02X}")),
        }
    }
    output
}

pub fn config_get_input(endpoint: String) -> HttpApiRequestInput {
    get_input(endpoint, "config", HashMap::new())
}

pub fn current_user_get_input(endpoint: String) -> HttpApiRequestInput {
    get_input(endpoint, "auth/user", HashMap::new())
}

pub fn session_get_input(endpoint: String) -> HttpApiRequestInput {
    get_input(endpoint, "auth", HashMap::new())
}

pub fn login_basic_input(
    endpoint: String,
    username: String,
    password: String,
    username_message: &str,
    password_message: &str,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let username = require_text(username, username_message)?;
    let password = require_text(password, password_message)?;
    let credentials = format!(
        "{}:{}",
        encode_uri_component(&username),
        encode_uri_component(&password)
    );
    let authorization = format!("Basic {}", B64.encode(credentials.as_bytes()));
    Ok((
        username.clone(),
        HttpApiRequestInput {
            headers: Some(HashMap::from([(
                "Authorization".to_string(),
                authorization,
            )])),
            ..get_input(endpoint, "auth/user", HashMap::new())
        },
    ))
}

pub fn totp_verify_input(endpoint: String, code: String) -> HttpApiRequestInput {
    api_input(
        endpoint,
        "POST",
        "auth/twofactorauth/totp/verify",
        Some(json!({ "code": normalize_text(code) })),
    )
}

pub fn otp_verify_input(endpoint: String, code: String) -> HttpApiRequestInput {
    let normalized_code = normalize_text(code).replace(char::is_whitespace, "");
    let formatted_code = if normalized_code.len() > 4 && !normalized_code.contains('-') {
        format!("{}-{}", &normalized_code[..4], &normalized_code[4..])
    } else {
        normalized_code
    };
    api_input(
        endpoint,
        "POST",
        "auth/twofactorauth/otp/verify",
        Some(json!({ "code": formatted_code })),
    )
}

pub fn email_otp_verify_input(endpoint: String, code: String) -> HttpApiRequestInput {
    api_input(
        endpoint,
        "POST",
        "auth/twofactorauth/emailotp/verify",
        Some(json!({ "code": normalize_text(code) })),
    )
}

pub fn visits_get_input(endpoint: String) -> HttpApiRequestInput {
    get_input(endpoint, "visits", HashMap::new())
}

pub fn file_analysis_get_input(
    endpoint: String,
    file_id: String,
    version: i64,
    variant: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let file_id = require_text(file_id, "VrchatAuthFileAnalysisGet requires fileId.")?;
    let variant = require_text(variant, "VrchatAuthFileAnalysisGet requires variant.")?;
    Ok((
        file_id.clone(),
        get_input(
            endpoint,
            format!(
                "analysis/{}/{}/{}",
                encode_path_segment(&file_id),
                version,
                encode_path_segment(&variant)
            ),
            HashMap::new(),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http_api::{build_web_execute_request, ApiScope};

    const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

    fn request(input: HttpApiRequestInput) -> crate::web_client::WebExecuteRequest {
        build_web_execute_request(input, ApiScope::Vrchat).unwrap()
    }

    fn header<'a>(request: &'a crate::web_client::WebExecuteRequest, name: &str) -> &'a str {
        request
            .headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
            .unwrap()
    }

    #[test]
    fn login_basic_builds_auth_user_get_with_encoded_basic_authorization() {
        let (username, input) = login_basic_input(
            ENDPOINT.into(),
            " user@example.com ".into(),
            " p@ ss ".into(),
            "username required",
            "password required",
        )
        .unwrap();

        let request = request(input);

        assert_eq!(username, "user@example.com");
        assert_eq!(request.method, "GET");
        assert_eq!(request.url, format!("{ENDPOINT}/auth/user"));
        assert_eq!(
            header(&request, "Authorization"),
            &format!("Basic {}", B64.encode("user%40example.com:p%40%20ss"))
        );
        assert!(request.body.is_none());
    }

    #[test]
    fn login_basic_rejects_empty_credentials_before_building_headers() {
        assert!(login_basic_input(
            ENDPOINT.into(),
            " ".into(),
            "password".into(),
            "username required",
            "password required",
        )
        .is_err());
        assert!(login_basic_input(
            ENDPOINT.into(),
            "user".into(),
            " ".into(),
            "username required",
            "password required",
        )
        .is_err());
    }

    #[test]
    fn auth_refresh_requests_use_cookie_backed_get_paths() {
        let current_user = request(current_user_get_input(ENDPOINT.into()));
        let session = request(session_get_input(ENDPOINT.into()));
        let config = request(config_get_input(ENDPOINT.into()));

        assert_eq!(current_user.method, "GET");
        assert_eq!(current_user.url, format!("{ENDPOINT}/auth/user"));
        assert_eq!(session.method, "GET");
        assert_eq!(session.url, format!("{ENDPOINT}/auth"));
        assert_eq!(config.method, "GET");
        assert_eq!(config.url, format!("{ENDPOINT}/config"));
    }

    #[test]
    fn two_factor_verify_requests_normalize_codes_and_json_body() {
        let totp = request(totp_verify_input(ENDPOINT.into(), " 123456 ".into()));
        let otp = request(otp_verify_input(ENDPOINT.into(), " 1234 56 ".into()));
        let email = request(email_otp_verify_input(ENDPOINT.into(), " abc123 ".into()));

        assert_eq!(totp.method, "POST");
        assert_eq!(
            totp.url,
            format!("{ENDPOINT}/auth/twofactorauth/totp/verify")
        );
        assert_eq!(totp.body.as_deref(), Some(r#"{"code":"123456"}"#));
        assert_eq!(
            header(&totp, "Content-Type"),
            "application/json;charset=utf-8"
        );

        assert_eq!(otp.url, format!("{ENDPOINT}/auth/twofactorauth/otp/verify"));
        assert_eq!(otp.body.as_deref(), Some(r#"{"code":"1234-56"}"#));
        assert_eq!(
            email.url,
            format!("{ENDPOINT}/auth/twofactorauth/emailotp/verify")
        );
        assert_eq!(email.body.as_deref(), Some(r#"{"code":"abc123"}"#));
    }

    #[test]
    fn file_analysis_request_encodes_path_segments_and_rejects_empty_parts() {
        let (file_id, input) = file_analysis_get_input(
            ENDPOINT.into(),
            " file_abc/unsafe ".into(),
            7,
            " print variant ".into(),
        )
        .unwrap();
        let request = request(input);

        assert_eq!(file_id, "file_abc/unsafe");
        assert_eq!(
            request.url,
            format!("{ENDPOINT}/analysis/file%5Fabc%2Funsafe/7/print%20variant")
        );
        assert!(file_analysis_get_input(ENDPOINT.into(), " ".into(), 1, "v".into()).is_err());
        assert!(file_analysis_get_input(ENDPOINT.into(), "file_1".into(), 1, " ".into()).is_err());
    }
}
