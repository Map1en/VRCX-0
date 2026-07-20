use super::*;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::json;
use tokio::sync::Notify;
use vrcx_0_application_core::RuntimeRealtimeTransportEpoch;
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};
use vrcx_0_vrchat_client::http_api::{execute_response, ApiScope, HttpApiRequestInput};

use crate::WebClient;

use super::service::{
    respond_to_challenge, start_cookie_restore, start_gui_basic_login, start_login,
    start_saved_credential_login,
};
use super::test_support::{seed_saved_credential, test_env, user_json, FakeLoginApi};

async fn start(api: &dyn LoginApi, username: &str, password: &str) -> LoginSessionState {
    start_login(api, "", username.into(), password.into()).await
}

async fn respond(
    api: &dyn LoginApi,
    state: LoginSessionState,
    method: &str,
    code: &str,
) -> LoginSessionState {
    let LoginSessionState::Challenge { methods, mode, .. } = state else {
        panic!("expected Challenge before response");
    };
    respond_to_challenge(api, "", methods, mode, method.into(), code.into()).await
}

struct PausedLoginApi {
    responses: Mutex<VecDeque<(i32, serde_json::Value)>>,
    call_count: AtomicUsize,
    pause_on_call: usize,
    paused: AtomicBool,
    entered: Notify,
    release: Notify,
}

impl PausedLoginApi {
    fn new(responses: Vec<(i32, serde_json::Value)>, pause_on_call: usize) -> Self {
        Self {
            responses: Mutex::new(responses.into()),
            call_count: AtomicUsize::new(0),
            pause_on_call,
            paused: AtomicBool::new(false),
            entered: Notify::new(),
            release: Notify::new(),
        }
    }

    async fn wait_until_paused(&self) {
        while !self.paused.load(Ordering::SeqCst) {
            let notified = self.entered.notified();
            if self.paused.load(Ordering::SeqCst) {
                break;
            }
            notified.await;
        }
    }

    fn resume(&self) {
        self.release.notify_one();
    }
}

impl LoginApi for PausedLoginApi {
    fn execute<'a>(&'a self, _input: HttpApiRequestInput, _scope: ApiScope) -> LoginApiFuture<'a> {
        Box::pin(async move {
            let call = self.call_count.fetch_add(1, Ordering::SeqCst) + 1;
            let (status, body) = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("test queued too few paused responses");
            if call == self.pause_on_call {
                self.paused.store(true, Ordering::SeqCst);
                self.entered.notify_waiters();
                self.release.notified().await;
            }
            Ok(execute_response(status, body.to_string()))
        })
    }
}

async fn start_runtime_basic(
    runtime: &LoginSessionRuntime,
    api: Arc<dyn LoginApi>,
    web: &WebClient,
    db: &DatabaseService,
    config: &ConfigRepository,
    username: &str,
    save_credentials: bool,
) -> LoginSessionState {
    runtime
        .start_with(
            api,
            web,
            db,
            config,
            LoginSessionStartInput::Basic {
                username: username.into(),
                password: "secret".into(),
                save_credentials,
            },
        )
        .await
}

fn transition_label(transition: LoginRuntimeTransition) -> String {
    match transition {
        LoginRuntimeTransition::Authenticating => "authenticating".into(),
        LoginRuntimeTransition::Authenticated(session) => {
            format!("authenticated:{}", session.user_id)
        }
        LoginRuntimeTransition::Unauthenticated(reason) => {
            format!("unauthenticated:{reason}")
        }
    }
}

fn challenge_attempt_id(state: &LoginSessionState) -> String {
    match state {
        LoginSessionState::Challenge { attempt_id, .. } => attempt_id.clone(),
        other => panic!("expected Challenge, got {other:?}"),
    }
}

#[tokio::test]
async fn authenticates_immediately_when_no_two_factor_is_required() {
    let api = Arc::new(FakeLoginApi::new(vec![(200, user_json())]));
    let state = start(api.as_ref(), "self@example.test", "secret").await;

    match &state {
        LoginSessionState::Authenticated { session, .. } => {
            assert_eq!(session.user_id, "usr_123");
        }
        other => panic!("expected Authenticated, got {other:?}"),
    }
    assert_eq!(api.call_paths(), vec!["auth/user"]);
}

#[tokio::test]
async fn totp_challenge_completes_after_a_correct_code() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({ "requiresTwoFactorAuth": ["totp", "otp"] })),
        (200, json!({})),
        (200, user_json()),
    ]));
    let mut state = start(api.as_ref(), "self@example.test", "secret").await;

    match &state {
        LoginSessionState::Challenge { methods, mode, .. } => {
            assert_eq!(methods, &vec!["totp".to_string(), "otp".to_string()]);
            assert_eq!(mode, "totp");
        }
        other => panic!("expected Challenge, got {other:?}"),
    }

    state = respond(api.as_ref(), state, "totp", "123456").await;

    match &state {
        LoginSessionState::Authenticated { session, .. } => {
            assert_eq!(session.user_id, "usr_123");
        }
        other => panic!("expected Authenticated, got {other:?}"),
    }
    assert_eq!(
        api.call_paths(),
        vec!["auth/user", "auth/twofactorauth/totp/verify", "auth/user"]
    );
}

#[tokio::test]
async fn email_otp_is_selected_when_totp_is_not_offered() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({ "requiresTwoFactorAuth": ["emailOtp"] })),
        (200, json!({})),
        (200, user_json()),
    ]));
    let mut state = start(api.as_ref(), "self@example.test", "secret").await;

    match &state {
        LoginSessionState::Challenge { methods, mode, .. } => {
            assert_eq!(methods, &vec!["emailOtp".to_string()]);
            assert_eq!(mode, "emailOtp");
        }
        other => panic!("expected Challenge, got {other:?}"),
    }

    state = respond(api.as_ref(), state, "emailOtp", "000000").await;

    assert!(matches!(state, LoginSessionState::Authenticated { .. }));
    assert_eq!(api.call_paths()[1], "auth/twofactorauth/emailotp/verify");
}

#[tokio::test]
async fn otp_recovery_code_is_dash_normalized_before_sending() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({ "requiresTwoFactorAuth": ["totp", "otp"] })),
        (200, json!({})),
        (200, user_json()),
    ]));
    let state = start(api.as_ref(), "self@example.test", "secret").await;

    let state = respond(api.as_ref(), state, "otp", "123456").await;

    assert!(matches!(state, LoginSessionState::Authenticated { .. }));
    assert_eq!(api.call_paths()[1], "auth/twofactorauth/otp/verify");
    assert_eq!(api.call_bodies()[1], Some(json!({ "code": "1234-56" })));
}

#[tokio::test]
async fn a_wrong_code_keeps_the_same_challenge_open_for_a_retry() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({ "requiresTwoFactorAuth": ["totp", "otp"] })),
        (400, json!({ "message": "Invalid code" })),
        (200, json!({})),
        (200, user_json()),
    ]));
    let mut state = start(api.as_ref(), "self@example.test", "secret").await;

    state = respond(api.as_ref(), state, "totp", "000000").await;
    match &state {
        LoginSessionState::Challenge {
            methods,
            mode,
            error,
            ..
        } => {
            assert_eq!(methods, &vec!["totp".to_string(), "otp".to_string()]);
            assert_eq!(mode, "totp");
            assert_eq!(
                error.as_deref(),
                Some("2FA verification failed with HTTP 400")
            );
        }
        other => panic!("expected Challenge with a retryable error, got {other:?}"),
    }

    state = respond(api.as_ref(), state, "totp", "123456").await;
    assert!(matches!(state, LoginSessionState::Authenticated { .. }));
    assert_eq!(api.call_paths().len(), 4);
}

#[tokio::test]
async fn two_factor_verification_requires_a_200_response() {
    for status in [429, 500] {
        let api = Arc::new(FakeLoginApi::new(vec![
            (200, json!({ "requiresTwoFactorAuth": ["totp"] })),
            (status, json!({})),
        ]));
        let state = start(api.as_ref(), "self@example.test", "secret").await;

        let state = respond(api.as_ref(), state, "totp", "123456").await;

        assert!(matches!(
            state,
            LoginSessionState::Challenge { error: Some(_), .. }
        ));
        assert_eq!(api.call_paths().len(), 2);
    }
}

#[tokio::test]
async fn an_auth_rejection_during_two_factor_verification_ends_the_session() {
    for status in [401, 403] {
        let api = Arc::new(FakeLoginApi::new(vec![
            (200, json!({ "requiresTwoFactorAuth": ["totp"] })),
            (status, json!({ "message": "Session expired" })),
        ]));
        let state = start(api.as_ref(), "self@example.test", "secret").await;

        let state = respond(api.as_ref(), state, "totp", "123456").await;

        assert!(matches!(
            state,
            LoginSessionState::Failed {
                kind: LoginFailureKind::SessionInvalidated,
                ..
            }
        ));
        assert_eq!(api.call_paths().len(), 2);
    }
}

#[tokio::test]
async fn a_follow_up_challenge_after_a_successful_verify_recomputes_the_default_mode() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({ "requiresTwoFactorAuth": ["totp", "otp"] })),
        (200, json!({})),
        (200, json!({ "requiresTwoFactorAuth": ["otp"] })),
    ]));
    let state = start(api.as_ref(), "self@example.test", "secret").await;

    let state = respond(api.as_ref(), state, "totp", "123456").await;

    match &state {
        LoginSessionState::Challenge {
            methods,
            mode,
            error,
            ..
        } => {
            assert_eq!(methods, &vec!["otp".to_string()]);
            assert_eq!(mode, "otp");
            assert!(error.is_none());
        }
        other => panic!("expected a fresh Challenge, got {other:?}"),
    }
}

#[tokio::test]
async fn invalid_credentials_fail_with_the_server_message() {
    let api = Arc::new(FakeLoginApi::new(vec![(
        401,
        json!({ "error": { "message": "Invalid Username/Email or Password" } }),
    )]));
    let state = start(api.as_ref(), "self@example.test", "secret").await;

    match &state {
        LoginSessionState::Failed { reason, kind, .. } => {
            assert_eq!(reason, "Invalid Username/Email or Password");
            assert_eq!(*kind, LoginFailureKind::InvalidCredentials);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn a_missing_credentials_401_is_not_misclassified_as_invalid_credentials() {
    let api = Arc::new(FakeLoginApi::new(vec![(
        401,
        json!({ "error": { "message": "Missing Credentials" } }),
    )]));
    let state = start(api.as_ref(), "self@example.test", "secret").await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::MissingCredentials);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn a_403_login_response_is_classified_as_session_invalidated() {
    let api = Arc::new(FakeLoginApi::new(vec![(
        403,
        json!({ "error": { "message": "Forbidden" } }),
    )]));
    let state = start(api.as_ref(), "self@example.test", "secret").await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn an_html_401_login_response_is_session_invalidation_not_bad_credentials() {
    let api = Arc::new(FakeLoginApi::new_raw(vec![(
        401,
        "<html>Unauthorized</html>".into(),
    )]));
    let state = start(api.as_ref(), "self@example.test", "secret").await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn gui_basic_login_short_circuits_on_an_html_403_config_response() {
    let api = Arc::new(FakeLoginApi::new_raw(vec![(
        403,
        "<html>Cloudflare challenge</html>".into(),
    )]));
    let state = start_gui_basic_login(
        api.as_ref(),
        "",
        "self@example.test".into(),
        "secret".into(),
    )
    .await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(api.call_paths(), vec!["config"]);
}

#[tokio::test]
async fn gui_basic_login_requires_a_200_config_response() {
    for status in [429, 500] {
        let api = Arc::new(FakeLoginApi::new(vec![(status, json!({}))]));
        let state = start_gui_basic_login(
            api.as_ref(),
            "",
            "self@example.test".into(),
            "secret".into(),
        )
        .await;

        assert!(matches!(
            state,
            LoginSessionState::Failed {
                kind: LoginFailureKind::Other,
                ..
            }
        ));
        assert_eq!(api.call_paths(), vec!["config"]);
    }
}

#[tokio::test]
async fn an_empty_two_factor_methods_array_fails_instead_of_hanging() {
    let api = Arc::new(FakeLoginApi::new(vec![(
        200,
        json!({ "requiresTwoFactorAuth": [] }),
    )]));
    let state = start(api.as_ref(), "self@example.test", "secret").await;

    match &state {
        LoginSessionState::Failed { reason, kind, .. } => {
            assert_eq!(
                reason,
                "2FA is required but no supported method was returned."
            );
            assert_eq!(*kind, LoginFailureKind::TwoFactorUnavailable);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn a_network_error_during_basic_login_fails_the_session() {
    let api = Arc::new(FakeLoginApi::new(vec![]).with_network_error("connection reset"));
    let state = start(api.as_ref(), "self@example.test", "secret").await;

    match &state {
        LoginSessionState::Failed { reason, kind, .. } => {
            assert_eq!(reason, "connection reset");
            assert_eq!(*kind, LoginFailureKind::Network);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn blank_credentials_fail_before_any_network_call() {
    let api = Arc::new(FakeLoginApi::new(vec![]));
    let state = start(api.as_ref(), "  ", "secret").await;

    match &state {
        LoginSessionState::Failed { reason, kind, .. } => {
            assert_eq!(reason, "Username is required.");
            assert_eq!(*kind, LoginFailureKind::Other);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
    assert!(api.call_paths().is_empty());
}

#[tokio::test]
async fn saved_credential_falls_through_both_cookie_probes_to_a_successful_password_login() {
    let (_dir, config, web, _db) = test_env("saved-cred-three-level-fallback");
    seed_saved_credential(&config, &web, "usr_saved");

    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
        (200, json!({})),
        (200, user_json()),
    ]));

    let state = start_saved_credential_login(
        api.as_ref(),
        &config,
        &web,
        String::new(),
        "usr_saved".into(),
    )
    .await;

    match &state {
        LoginSessionState::Authenticated { session, .. } => {
            assert_eq!(session.user_id, "usr_123");
        }
        other => panic!("expected Authenticated, got {other:?}"),
    }
    assert_eq!(
        api.call_paths(),
        vec![
            "config",
            "auth/user",
            "config",
            "auth/user",
            "config",
            "auth/user",
        ]
    );
}

#[tokio::test]
async fn saved_credential_short_circuits_on_a_403_cookie_probe() {
    let (_dir, config, web, _db) = test_env("saved-cred-403-short-circuit");
    seed_saved_credential(&config, &web, "usr_saved");

    let api = Arc::new(FakeLoginApi::new(vec![(
        403,
        json!({ "error": { "message": "Forbidden" } }),
    )]));

    let state = start_saved_credential_login(
        api.as_ref(),
        &config,
        &web,
        String::new(),
        "usr_saved".into(),
    )
    .await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(api.call_paths(), vec!["config"]);
}

#[tokio::test]
async fn saved_credential_login_requires_the_exact_invalid_credentials_message() {
    let (_dir, config, web, _db) = test_env("saved-cred-401-granularity");
    seed_saved_credential(&config, &web, "usr_saved");

    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
    ]));

    let state = start_saved_credential_login(
        api.as_ref(),
        &config,
        &web,
        String::new(),
        "usr_saved".into(),
    )
    .await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(
                *kind,
                LoginFailureKind::MissingCredentials,
                "a 'Missing Credentials' 401 must not be treated as invalid credentials \
                 for a saved-credential login"
            );
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn saved_credential_login_classifies_the_exact_invalid_credentials_message() {
    let (_dir, config, web, _db) = test_env("saved-cred-exact-invalid");
    seed_saved_credential(&config, &web, "usr_saved");

    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Invalid Username/Email or Password" } }),
        ),
    ]));

    let state = start_saved_credential_login(
        api.as_ref(),
        &config,
        &web,
        String::new(),
        "usr_saved".into(),
    )
    .await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::InvalidCredentials);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn saved_credential_login_fails_when_no_record_exists() {
    let (_dir, config, web, _db) = test_env("saved-cred-missing-record");
    let api = Arc::new(FakeLoginApi::new(vec![]));

    let state = start_saved_credential_login(
        api.as_ref(),
        &config,
        &web,
        String::new(),
        "usr_unknown".into(),
    )
    .await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::Other);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
    assert!(api.call_paths().is_empty());
}

#[tokio::test]
async fn cookie_restore_authenticates_from_an_existing_session() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, user_json()),
    ]));

    let state = start_cookie_restore(api.as_ref(), "", "").await;

    match &state {
        LoginSessionState::Authenticated { session, .. } => {
            assert_eq!(session.user_id, "usr_123");
        }
        other => panic!("expected Authenticated, got {other:?}"),
    }
    assert_eq!(api.call_paths(), vec!["config", "auth/user"]);
}

#[tokio::test]
async fn cookie_restore_short_circuits_on_a_403_config_response() {
    let api = Arc::new(FakeLoginApi::new(vec![(
        403,
        json!({ "error": { "message": "Forbidden" } }),
    )]));

    let state = start_cookie_restore(api.as_ref(), "", "").await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(api.call_paths(), vec!["config"]);
}

#[tokio::test]
async fn cookie_restore_requires_200_from_config_and_current_user() {
    for (responses, expected_paths) in [
        (vec![(429, json!({}))], vec!["config"]),
        (vec![(500, json!({}))], vec!["config"]),
        (
            vec![(200, json!({})), (429, user_json())],
            vec!["config", "auth/user"],
        ),
        (
            vec![(200, json!({})), (500, user_json())],
            vec!["config", "auth/user"],
        ),
    ] {
        let api = Arc::new(FakeLoginApi::new(responses));
        let state = start_cookie_restore(api.as_ref(), "", "").await;

        assert!(matches!(state, LoginSessionState::Failed { .. }));
        assert_eq!(api.call_paths(), expected_paths);
    }
}

#[tokio::test]
async fn cookie_restore_reports_a_two_factor_requirement_as_unavailable() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, json!({ "requiresTwoFactorAuth": ["totp", "otp"] })),
    ]));

    let state = start_cookie_restore(api.as_ref(), "", "").await;

    match &state {
        LoginSessionState::Failed { reason, kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::TwoFactorUnavailable);
            assert_eq!(
                reason,
                "The stored browser session still requires interactive verification."
            );
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn cookie_restore_classifies_a_missing_credentials_401_for_fallback() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
    ]));

    let state = start_cookie_restore(api.as_ref(), "", "").await;

    match &state {
        LoginSessionState::Failed { reason, kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::MissingCredentials);
            assert_eq!(reason, "Missing Credentials");
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn cookie_restore_classifies_a_generic_401_as_session_invalidated() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (401, json!({ "error": { "message": "Unauthorized" } })),
    ]));

    let state = start_cookie_restore(api.as_ref(), "", "").await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn cookie_restore_classifies_an_empty_401_before_body_parsing() {
    let api = Arc::new(FakeLoginApi::new_raw(vec![
        (200, "{}".into()),
        (401, String::new()),
    ]));

    let state = start_cookie_restore(api.as_ref(), "", "").await;

    match &state {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn cookie_restore_fails_on_a_network_error() {
    let api = Arc::new(FakeLoginApi::new(vec![]).with_network_error("connection reset"));

    let state = start_cookie_restore(api.as_ref(), "", "").await;

    match &state {
        LoginSessionState::Failed { reason, kind, .. } => {
            assert_eq!(reason, "connection reset");
            assert_eq!(*kind, LoginFailureKind::Network);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn auto_login_challenge_completion_records_login_success() {
    let (_dir, config, web, db) = test_env("auto-login-challenge-record");
    seed_saved_credential(&config, &web, "usr_saved");

    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
        (200, json!({})),
        (200, json!({ "requiresTwoFactorAuth": ["totp", "otp"] })),
        (200, json!({})),
        (200, user_json()),
    ]));

    let runtime = LoginSessionRuntime::new();
    let outcome = runtime
        .auto_login_start_with(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            db.as_ref(),
            AutoLoginStartInput {
                user_id: "usr_saved".into(),
            },
        )
        .await
        .unwrap();
    let attempt_id = match outcome {
        AutoLoginOutcome::Session(LoginSessionState::Challenge { attempt_id, .. }) => attempt_id,
        other => panic!("expected Challenge, got {other:?}"),
    };

    let state = runtime
        .respond(
            LoginSessionRespondInput {
                attempt_id,
                method: "totp".into(),
                code: "123456".into(),
            },
            &web,
            db.as_ref(),
            &config,
        )
        .await;
    match &state {
        LoginSessionState::Authenticated { session, .. } => {
            assert_eq!(session.user_id, "usr_123");
        }
        other => panic!("expected Authenticated, got {other:?}"),
    }
    assert_eq!(
        config
            .get_string("lastUserLoggedIn", "")
            .unwrap_or_default(),
        "usr_123"
    );
}

#[tokio::test]
async fn authenticated_state_is_committed_before_it_is_exposed() {
    let (_dir, config, web, db) = test_env("login-commit-success");
    let runtime = LoginSessionRuntime::new();
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, user_json()),
    ]));
    let commits = AtomicUsize::new(0);

    let state = runtime
        .start_with_transition(
            api,
            &web,
            db.as_ref(),
            &config,
            LoginSessionStartInput::Basic {
                username: "self@example.test".into(),
                password: "secret".into(),
                save_credentials: false,
            },
            &|transition| {
                if let LoginRuntimeTransition::Authenticated(session) = transition {
                    assert_eq!(session.user_id, "usr_123");
                    commits.fetch_add(1, Ordering::SeqCst);
                }
                Ok(())
            },
        )
        .await;

    assert!(matches!(
        state,
        LoginSessionState::Authenticated {
            snapshot: Some(ref snapshot),
            ..
        } if snapshot.last_user_logged_in.as_deref() == Some("usr_123")
    ));
    assert_eq!(commits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn challenge_attempt_id_rejects_stale_responses_and_cancel_clears_auth_cookie() {
    let (_dir, config, web, db) = test_env("challenge-attempt-id");
    let runtime = LoginSessionRuntime::new();
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, json!({ "requiresTwoFactorAuth": ["totp"] })),
    ]));
    let state = start_runtime_basic(
        &runtime,
        Arc::clone(&api) as Arc<dyn LoginApi>,
        &web,
        db.as_ref(),
        &config,
        "self@example.test",
        false,
    )
    .await;
    let attempt_id = challenge_attempt_id(&state);
    assert!(!attempt_id.is_empty());

    let stale_response = runtime
        .respond(
            LoginSessionRespondInput {
                attempt_id: "stale-attempt".into(),
                method: "totp".into(),
                code: "123456".into(),
            },
            &web,
            db.as_ref(),
            &config,
        )
        .await;
    assert_eq!(challenge_attempt_id(&stale_response), attempt_id);
    assert_eq!(api.call_paths(), vec!["config", "auth/user"]);

    let stale_cancel = runtime
        .cancel("stale-attempt".into(), &web, db.as_ref(), &|_| Ok(()))
        .await;
    assert_eq!(challenge_attempt_id(&stale_cancel), attempt_id);

    let cookie_payload = B64.encode(
        serde_json::to_vec(&json!([
            {"Name": "auth", "Value": "a", "Domain": ".vrchat.cloud", "Path": "/"},
            {"Name": "twoFactorAuth", "Value": "t", "Domain": ".vrchat.cloud", "Path": "/"}
        ]))
        .unwrap(),
    );
    web.set_cookies(&cookie_payload).unwrap();
    let cancelled = runtime
        .cancel(attempt_id, &web, db.as_ref(), &|_| Ok(()))
        .await;
    assert!(matches!(cancelled, LoginSessionState::Cancelled));
    assert_ne!(web.get_cookies(), cookie_payload);
    assert_eq!(
        vrcx_0_persistence::cookies::get_default_cookies(db.as_ref())
            .unwrap()
            .as_deref(),
        Some(web.get_cookies().as_str())
    );
}

#[test]
fn invalidation_requires_the_current_scope_and_transport_epoch() {
    let expected = RuntimeRealtimeTransportEpoch {
        client_run_id: 5,
        generation: 7,
        session_generation: 11,
    };
    let invalidated = LoginSessionEnd::Invalidated {
        expected_user_id: "usr_1".into(),
        expected_auth_scope_generation: 3,
        expected_realtime_transport: Some(expected.clone()),
    };

    assert!(invalidated.matches_invalidation("usr_1", 3, Some(&expected)));
    assert!(!invalidated.matches_invalidation(
        "usr_1",
        3,
        Some(&RuntimeRealtimeTransportEpoch {
            generation: 8,
            ..expected.clone()
        })
    ));
    assert!(!invalidated.matches_invalidation("usr_1", 4, Some(&expected)));
    assert!(!invalidated.matches_invalidation("usr_2", 3, Some(&expected)));
}

#[tokio::test]
async fn stale_session_invalidation_is_an_atomic_no_op() {
    let (_dir, config, web, db) = test_env("stale-session-invalidation");
    let runtime = LoginSessionRuntime::new();
    let state = start_runtime_basic(
        &runtime,
        Arc::new(FakeLoginApi::new(vec![
            (200, json!({})),
            (200, json!({ "requiresTwoFactorAuth": ["totp"] })),
        ])),
        &web,
        db.as_ref(),
        &config,
        "self@example.test",
        false,
    )
    .await;
    let attempt_id = challenge_attempt_id(&state);
    let transitions = AtomicUsize::new(0);

    let outcome = runtime
        .end_session(
            &web,
            db.as_ref(),
            &config,
            LoginSessionEndRequest {
                user_id: "usr_1".into(),
                kind: LoginSessionEnd::Invalidated {
                    expected_user_id: "usr_1".into(),
                    expected_auth_scope_generation: 3,
                    expected_realtime_transport: None,
                },
            },
            &|_| false,
            &|_| {
                transitions.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await
        .unwrap();

    assert!(outcome.is_none());
    assert_eq!(transitions.load(Ordering::SeqCst), 0);
    assert_eq!(challenge_attempt_id(&runtime.state()), attempt_id);
}

#[tokio::test]
async fn a_failed_authenticated_commit_is_not_exposed_as_logged_in() {
    let (_dir, config, web, db) = test_env("login-commit-failure");
    let runtime = LoginSessionRuntime::new();
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, user_json()),
    ]));

    let state = runtime
        .start_with_transition(
            api,
            &web,
            db.as_ref(),
            &config,
            LoginSessionStartInput::Basic {
                username: "self@example.test".into(),
                password: "secret".into(),
                save_credentials: false,
            },
            &|transition| match transition {
                LoginRuntimeTransition::Authenticated(_) => Err("session commit failed".into()),
                LoginRuntimeTransition::Authenticating
                | LoginRuntimeTransition::Unauthenticated(_) => Ok(()),
            },
        )
        .await;

    assert!(matches!(
        state,
        LoginSessionState::Failed {
            ref reason,
            kind: LoginFailureKind::Other,
            snapshot: Some(_),
        } if reason == "session commit failed"
    ));
}

#[tokio::test]
async fn a_failed_manual_login_preserves_the_existing_last_user() {
    for status in [401, 403] {
        let test_name = format!("manual-failure-preserves-target-{status}");
        let (_dir, config, web, db) = test_env(&test_name);
        seed_saved_credential(&config, &web, "usr_saved");
        let runtime = LoginSessionRuntime::new();
        let api = Arc::new(FakeLoginApi::new(vec![
            (200, json!({})),
            (status, json!({ "error": { "message": "Login rejected" } })),
        ]));

        let state = start_runtime_basic(
            &runtime,
            api,
            &web,
            db.as_ref(),
            &config,
            "other@example.test",
            false,
        )
        .await;

        assert!(matches!(
            &state,
            LoginSessionState::Failed {
                snapshot: Some(snapshot),
                ..
            } if snapshot.last_user_logged_in.as_deref() == Some("usr_saved")
        ));
        assert_eq!(
            crate::saved_snapshot(&config)
                .unwrap()
                .last_user_logged_in
                .as_deref(),
            Some("usr_saved"),
            "HTTP {status} from a manual login must not clear another account's last-user marker"
        );
    }
}

#[tokio::test]
async fn auto_login_returns_the_installed_failure_and_committed_snapshot() {
    let (_dir, config, web, db) = test_env("auto-login-install-failure");
    seed_saved_credential(&config, &web, "usr_saved");
    let runtime = LoginSessionRuntime::new();
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (
            200,
            json!({ "id": "usr_saved", "displayName": "Saved User" }),
        ),
    ]));

    let outcome = runtime
        .auto_login_start_with_transition(
            api,
            &config,
            &web,
            db.as_ref(),
            AutoLoginStartInput {
                user_id: "usr_saved".into(),
            },
            &|transition| match transition {
                LoginRuntimeTransition::Authenticated(_) => Err("runtime commit failed".into()),
                LoginRuntimeTransition::Authenticating
                | LoginRuntimeTransition::Unauthenticated(_) => Ok(()),
            },
        )
        .await
        .unwrap();

    assert!(matches!(
        outcome,
        AutoLoginOutcome::Session(LoginSessionState::Failed {
            ref reason,
            kind: LoginFailureKind::Other,
            ref snapshot,
        }) if reason == "runtime commit failed"
            && snapshot
                .as_deref()
                .and_then(|snapshot| snapshot.last_user_logged_in.as_deref())
                == Some("usr_saved")
    ));
}

#[tokio::test]
async fn a_superseded_start_cannot_clear_the_newer_committed_session() {
    let (_dir, config, web, db) = test_env("start-transition-generation");
    let config = Arc::new(config);
    let web = Arc::new(web);
    let runtime = LoginSessionRuntime::new();
    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    let old_api = Arc::new(PausedLoginApi::new(
        vec![
            (200, json!({})),
            (200, json!({ "id": "usr_old", "displayName": "Old" })),
        ],
        2,
    ));

    let old_task = {
        let runtime = runtime.clone();
        let events = Arc::clone(&events);
        let old_api = old_api.clone();
        let config = Arc::clone(&config);
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        tokio::spawn(async move {
            runtime
                .start_with_transition(
                    old_api as Arc<dyn LoginApi>,
                    web.as_ref(),
                    db.as_ref(),
                    config.as_ref(),
                    LoginSessionStartInput::Basic {
                        username: "old@example.test".into(),
                        password: "secret".into(),
                        save_credentials: false,
                    },
                    &|transition| {
                        events.lock().unwrap().push(transition_label(transition));
                        Ok(())
                    },
                )
                .await
        })
    };
    old_api.wait_until_paused().await;

    let new_api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, json!({ "id": "usr_new", "displayName": "New" })),
    ]));
    let new_task = {
        let runtime = runtime.clone();
        let events = Arc::clone(&events);
        let config = Arc::clone(&config);
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        tokio::spawn(async move {
            runtime
                .start_with_transition(
                    new_api,
                    web.as_ref(),
                    db.as_ref(),
                    config.as_ref(),
                    LoginSessionStartInput::Basic {
                        username: "new@example.test".into(),
                        password: "secret".into(),
                        save_credentials: false,
                    },
                    &|transition| {
                        events.lock().unwrap().push(transition_label(transition));
                        Ok(())
                    },
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    old_api.resume();
    assert!(matches!(
        old_task.await.unwrap(),
        LoginSessionState::Cancelled
    ));
    assert!(matches!(
        new_task.await.unwrap(),
        LoginSessionState::Authenticated { .. }
    ));
    assert_eq!(
        events.lock().unwrap().last().map(String::as_str),
        Some("authenticated:usr_new")
    );
}

#[tokio::test]
async fn logout_invalidates_a_login_waiting_on_the_network() {
    let (_dir, config, web, db) = test_env("logout-start-generation");
    let config = Arc::new(config);
    let web = Arc::new(web);
    let runtime = LoginSessionRuntime::new();
    let api = Arc::new(PausedLoginApi::new(
        vec![
            (200, json!({})),
            (200, json!({ "id": "usr_late", "displayName": "Late" })),
        ],
        2,
    ));

    let login_task = {
        let runtime = runtime.clone();
        let api = api.clone();
        let config = Arc::clone(&config);
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        tokio::spawn(async move {
            runtime
                .start_with_transition(
                    api as Arc<dyn LoginApi>,
                    web.as_ref(),
                    db.as_ref(),
                    config.as_ref(),
                    LoginSessionStartInput::Basic {
                        username: "late@example.test".into(),
                        password: "secret".into(),
                        save_credentials: false,
                    },
                    &|_| Ok(()),
                )
                .await
        })
    };
    api.wait_until_paused().await;

    let transitions = Arc::new(Mutex::new(Vec::new()));
    let logout_task = {
        let runtime = runtime.clone();
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        let config = Arc::clone(&config);
        let transitions = Arc::clone(&transitions);
        tokio::spawn(async move {
            runtime
                .end_session(
                    web.as_ref(),
                    db.as_ref(),
                    config.as_ref(),
                    LoginSessionEndRequest {
                        user_id: String::new(),
                        kind: LoginSessionEnd::Logout,
                    },
                    &|_| true,
                    &|transition| {
                        transitions
                            .lock()
                            .unwrap()
                            .push(transition_label(transition));
                        Ok(())
                    },
                )
                .await
                .unwrap()
        })
    };
    tokio::task::yield_now().await;
    api.resume();
    assert!(matches!(
        login_task.await.unwrap(),
        LoginSessionState::Cancelled
    ));
    logout_task.await.unwrap();
    assert_eq!(
        transitions.lock().unwrap().as_slice(),
        ["unauthenticated:User logged out."]
    );
}

#[tokio::test]
async fn a_stale_respond_cannot_replace_a_newer_session_or_use_its_finalize() {
    let (_dir, config, web, db) = test_env("respond-generation");
    let config = Arc::new(config);
    let web = Arc::new(web);
    let runtime = LoginSessionRuntime::new();
    let old_api = Arc::new(PausedLoginApi::new(
        vec![
            (200, json!({})),
            (200, json!({ "requiresTwoFactorAuth": ["totp"] })),
            (200, json!({})),
            (200, json!({ "id": "usr_old", "displayName": "Old User" })),
        ],
        3,
    ));

    let initial = start_runtime_basic(
        &runtime,
        Arc::clone(&old_api) as Arc<dyn LoginApi>,
        web.as_ref(),
        db.as_ref(),
        config.as_ref(),
        "old@example.test",
        false,
    )
    .await;
    assert!(matches!(initial, LoginSessionState::Challenge { .. }));
    let old_attempt_id = challenge_attempt_id(&initial);

    let respond_task = {
        let runtime = runtime.clone();
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        let config = Arc::clone(&config);
        tokio::spawn(async move {
            runtime
                .respond(
                    LoginSessionRespondInput {
                        attempt_id: old_attempt_id,
                        method: "totp".into(),
                        code: "123456".into(),
                    },
                    web.as_ref(),
                    db.as_ref(),
                    config.as_ref(),
                )
                .await
        })
    };
    old_api.wait_until_paused().await;

    let new_api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, json!({ "requiresTwoFactorAuth": ["emailOtp"] })),
    ]));
    let newer_task = {
        let runtime = runtime.clone();
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        let config = Arc::clone(&config);
        tokio::spawn(async move {
            start_runtime_basic(
                &runtime,
                new_api as Arc<dyn LoginApi>,
                web.as_ref(),
                db.as_ref(),
                config.as_ref(),
                "new@example.test",
                true,
            )
            .await
        })
    };
    tokio::task::yield_now().await;
    old_api.resume();
    assert!(matches!(
        respond_task.await.unwrap(),
        LoginSessionState::Cancelled
    ));
    assert!(matches!(
        newer_task.await.unwrap(),
        LoginSessionState::Challenge { ref mode, .. } if mode == "emailOtp"
    ));
    assert!(matches!(
        runtime.state(),
        LoginSessionState::Challenge { ref mode, .. } if mode == "emailOtp"
    ));
    assert_eq!(
        config
            .get_string("lastUserLoggedIn", "")
            .unwrap_or_default(),
        ""
    );
}

#[tokio::test]
async fn cancel_invalidates_a_respond_that_is_waiting_on_the_network() {
    let (_dir, config, web, db) = test_env("respond-cancel-generation");
    let config = Arc::new(config);
    let web = Arc::new(web);
    let runtime = LoginSessionRuntime::new();
    let api = Arc::new(PausedLoginApi::new(
        vec![
            (200, json!({})),
            (200, json!({ "requiresTwoFactorAuth": ["totp"] })),
            (200, json!({})),
            (200, user_json()),
        ],
        3,
    ));

    let initial = start_runtime_basic(
        &runtime,
        Arc::clone(&api) as Arc<dyn LoginApi>,
        web.as_ref(),
        db.as_ref(),
        config.as_ref(),
        "self@example.test",
        true,
    )
    .await;
    assert!(matches!(initial, LoginSessionState::Challenge { .. }));
    let attempt_id = challenge_attempt_id(&initial);
    let respond_attempt_id = attempt_id.clone();

    let respond_task = {
        let runtime = runtime.clone();
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        let config = Arc::clone(&config);
        tokio::spawn(async move {
            runtime
                .respond(
                    LoginSessionRespondInput {
                        attempt_id: respond_attempt_id,
                        method: "totp".into(),
                        code: "123456".into(),
                    },
                    web.as_ref(),
                    db.as_ref(),
                    config.as_ref(),
                )
                .await
        })
    };
    api.wait_until_paused().await;

    let cancel_task = {
        let runtime = runtime.clone();
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        tokio::spawn(async move {
            runtime
                .cancel(attempt_id, web.as_ref(), db.as_ref(), &|_| Ok(()))
                .await
        })
    };
    tokio::task::yield_now().await;
    api.resume();

    assert!(matches!(
        cancel_task.await.unwrap(),
        LoginSessionState::Cancelled
    ));

    assert!(matches!(
        respond_task.await.unwrap(),
        LoginSessionState::Cancelled
    ));
    assert!(matches!(runtime.state(), LoginSessionState::Cancelled));
    assert_eq!(
        config
            .get_string("lastUserLoggedIn", "")
            .unwrap_or_default(),
        ""
    );
}

#[tokio::test]
async fn a_manual_start_supersedes_an_auto_login_waiting_on_the_network() {
    let (_dir, config, web, db) = test_env("auto-login-generation");
    let config = Arc::new(config);
    let web = Arc::new(web);
    let runtime = LoginSessionRuntime::new();
    let auto_api = Arc::new(PausedLoginApi::new(
        vec![
            (200, json!({})),
            (200, json!({ "id": "usr_auto", "displayName": "Auto User" })),
        ],
        2,
    ));

    let auto_task = {
        let runtime = runtime.clone();
        let auto_api = Arc::clone(&auto_api);
        let config = Arc::clone(&config);
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        tokio::spawn(async move {
            runtime
                .auto_login_start_with(
                    auto_api as Arc<dyn LoginApi>,
                    config.as_ref(),
                    web.as_ref(),
                    db.as_ref(),
                    AutoLoginStartInput {
                        user_id: "usr_auto".into(),
                    },
                )
                .await
        })
    };
    auto_api.wait_until_paused().await;

    let manual_api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, json!({ "requiresTwoFactorAuth": ["emailOtp"] })),
    ]));
    let manual_task = {
        let runtime = runtime.clone();
        let web = Arc::clone(&web);
        let db = Arc::clone(&db);
        let config = Arc::clone(&config);
        tokio::spawn(async move {
            start_runtime_basic(
                &runtime,
                manual_api as Arc<dyn LoginApi>,
                web.as_ref(),
                db.as_ref(),
                config.as_ref(),
                "manual@example.test",
                true,
            )
            .await
        })
    };
    tokio::task::yield_now().await;
    auto_api.resume();
    let error = auto_task.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("superseded"));
    assert!(matches!(
        manual_task.await.unwrap(),
        LoginSessionState::Challenge { ref mode, .. } if mode == "emailOtp"
    ));
    assert!(matches!(
        runtime.state(),
        LoginSessionState::Challenge { ref mode, .. } if mode == "emailOtp"
    ));
}
