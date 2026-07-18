use super::*;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::json;
use tokio::sync::Notify;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_vrchat_client::http_api::{execute_response, ApiScope, HttpApiRequestInput};

use crate::WebClient;

use super::test_support::{seed_saved_credential, test_env, user_json, FakeLoginApi};

async fn start(api: Arc<FakeLoginApi>, username: &str, password: &str) -> LoginSession {
    LoginSession::start(api, String::new(), username.into(), password.into()).await
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
            Ok(execute_response(status, body.to_string(), ApiScope::Vrchat))
        })
    }
}

async fn start_runtime_basic(
    runtime: &LoginSessionRuntime,
    api: Arc<dyn LoginApi>,
    web: &WebClient,
    config: &ConfigRepository,
    username: &str,
    save_credentials: bool,
) -> LoginSessionState {
    runtime
        .start_basic_with(
            api,
            web,
            config,
            LoginSessionStartBasicInput {
                endpoint: String::new(),
                username: username.into(),
                password: "secret".into(),
                save_credentials,
            },
        )
        .await
}

#[test]
fn priority_orders_totp_before_email_otp_before_otp() {
    let mut methods: Vec<String> = vec!["otp".into(), "emailOtp".into(), "totp".into()];
    sort_two_factor_methods(&mut methods);
    assert_eq!(methods, vec!["totp", "emailOtp", "otp"]);
}

#[test]
fn priority_matches_the_real_totp_account_payload() {
    let mut methods: Vec<String> = vec!["totp".into(), "otp".into()];
    sort_two_factor_methods(&mut methods);
    assert_eq!(methods, vec!["totp", "otp"]);
}

#[test]
fn priority_matches_the_real_email_only_account_payload() {
    let mut methods: Vec<String> = vec!["emailOtp".into()];
    sort_two_factor_methods(&mut methods);
    assert_eq!(methods, vec!["emailOtp"]);
}

#[test]
fn priority_places_unrecognized_methods_last() {
    let mut methods: Vec<String> = vec!["otp".into(), "unknownMethod".into(), "totp".into()];
    sort_two_factor_methods(&mut methods);
    assert_eq!(methods, vec!["totp", "otp", "unknownMethod"]);
}

#[tokio::test]
async fn authenticates_immediately_when_no_two_factor_is_required() {
    let api = Arc::new(FakeLoginApi::new(vec![(200, user_json())]));
    let session = start(Arc::clone(&api), "self@example.test", "secret").await;

    match session.state() {
        LoginSessionState::Authenticated { session } => {
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
    let mut session = start(Arc::clone(&api), "self@example.test", "secret").await;

    match session.state() {
        LoginSessionState::Challenge { methods, mode, .. } => {
            assert_eq!(methods, &vec!["totp".to_string(), "otp".to_string()]);
            assert_eq!(mode, "totp");
        }
        other => panic!("expected Challenge, got {other:?}"),
    }

    session.respond("totp".into(), "123456".into()).await;

    match session.state() {
        LoginSessionState::Authenticated { session } => {
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
    let mut session = start(Arc::clone(&api), "self@example.test", "secret").await;

    match session.state() {
        LoginSessionState::Challenge { methods, mode, .. } => {
            assert_eq!(methods, &vec!["emailOtp".to_string()]);
            assert_eq!(mode, "emailOtp");
        }
        other => panic!("expected Challenge, got {other:?}"),
    }

    session.respond("emailOtp".into(), "000000".into()).await;

    assert!(matches!(
        session.state(),
        LoginSessionState::Authenticated { .. }
    ));
    assert_eq!(api.call_paths()[1], "auth/twofactorauth/emailotp/verify");
}

#[tokio::test]
async fn otp_recovery_code_is_dash_normalized_before_sending() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({ "requiresTwoFactorAuth": ["totp", "otp"] })),
        (200, json!({})),
        (200, user_json()),
    ]));
    let mut session = start(Arc::clone(&api), "self@example.test", "secret").await;

    session.respond("otp".into(), "123456".into()).await;

    assert!(matches!(
        session.state(),
        LoginSessionState::Authenticated { .. }
    ));
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
    let mut session = start(Arc::clone(&api), "self@example.test", "secret").await;

    session.respond("totp".into(), "000000".into()).await;
    match session.state() {
        LoginSessionState::Challenge {
            methods,
            mode,
            error,
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

    session.respond("totp".into(), "123456".into()).await;
    assert!(matches!(
        session.state(),
        LoginSessionState::Authenticated { .. }
    ));
    assert_eq!(api.call_paths().len(), 4);
}

#[tokio::test]
async fn a_follow_up_challenge_after_a_successful_verify_recomputes_the_default_mode() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({ "requiresTwoFactorAuth": ["totp", "otp"] })),
        (200, json!({})),
        (200, json!({ "requiresTwoFactorAuth": ["otp"] })),
    ]));
    let mut session = start(Arc::clone(&api), "self@example.test", "secret").await;

    session.respond("totp".into(), "123456".into()).await;

    match session.state() {
        LoginSessionState::Challenge {
            methods,
            mode,
            error,
        } => {
            assert_eq!(methods, &vec!["otp".to_string()]);
            assert_eq!(mode, "otp");
            assert!(error.is_none());
        }
        other => panic!("expected a fresh Challenge, got {other:?}"),
    }
}

#[tokio::test]
async fn cancel_moves_to_cancelled_and_respond_becomes_a_no_op() {
    let api = Arc::new(FakeLoginApi::new(vec![(
        200,
        json!({ "requiresTwoFactorAuth": ["totp"] }),
    )]));
    let mut session = start(Arc::clone(&api), "self@example.test", "secret").await;

    session.cancel();
    assert!(matches!(session.state(), LoginSessionState::Cancelled));

    session.respond("totp".into(), "123456".into()).await;
    assert!(matches!(session.state(), LoginSessionState::Cancelled));
    assert_eq!(api.call_paths().len(), 1);
}

#[tokio::test]
async fn respond_is_a_no_op_once_already_authenticated() {
    let api = Arc::new(FakeLoginApi::new(vec![(200, user_json())]));
    let mut session = start(Arc::clone(&api), "self@example.test", "secret").await;
    assert!(matches!(
        session.state(),
        LoginSessionState::Authenticated { .. }
    ));

    session.respond("totp".into(), "123456".into()).await;
    assert!(matches!(
        session.state(),
        LoginSessionState::Authenticated { .. }
    ));
    assert_eq!(api.call_paths().len(), 1);
}

#[tokio::test]
async fn invalid_credentials_fail_with_the_server_message() {
    let api = Arc::new(FakeLoginApi::new(vec![(
        401,
        json!({ "error": { "message": "Invalid Username/Email or Password" } }),
    )]));
    let session = start(Arc::clone(&api), "self@example.test", "secret").await;

    match session.state() {
        LoginSessionState::Failed { reason, kind } => {
            assert_eq!(reason, "Invalid Username/Email or Password");
            assert_eq!(*kind, LoginFailureKind::InvalidCredentials);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn any_401_during_manual_login_is_classified_as_invalid_credentials() {
    let api = Arc::new(FakeLoginApi::new(vec![(
        401,
        json!({ "error": { "message": "Missing Credentials" } }),
    )]));
    let session = start(Arc::clone(&api), "self@example.test", "secret").await;

    match session.state() {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::InvalidCredentials);
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
    let session = start(Arc::clone(&api), "self@example.test", "secret").await;

    match session.state() {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn an_html_401_login_response_is_classified_before_body_parsing() {
    let api = Arc::new(FakeLoginApi::new_raw(vec![(
        401,
        "<html>Unauthorized</html>".into(),
    )]));
    let session = start(Arc::clone(&api), "self@example.test", "secret").await;

    match session.state() {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::InvalidCredentials);
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
    let session = LoginSession::start_gui_basic(
        Arc::clone(&api) as Arc<dyn LoginApi>,
        String::new(),
        "self@example.test".into(),
        "secret".into(),
    )
    .await;

    match session.state() {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(api.call_paths(), vec!["config"]);
}

#[tokio::test]
async fn an_empty_two_factor_methods_array_fails_instead_of_hanging() {
    let api = Arc::new(FakeLoginApi::new(vec![(
        200,
        json!({ "requiresTwoFactorAuth": [] }),
    )]));
    let session = start(Arc::clone(&api), "self@example.test", "secret").await;

    match session.state() {
        LoginSessionState::Failed { reason, kind } => {
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
    let session = start(Arc::clone(&api), "self@example.test", "secret").await;

    match session.state() {
        LoginSessionState::Failed { reason, kind } => {
            assert_eq!(reason, "connection reset");
            assert_eq!(*kind, LoginFailureKind::Network);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn blank_credentials_fail_before_any_network_call() {
    let api = Arc::new(FakeLoginApi::new(vec![]));
    let session = start(Arc::clone(&api), "  ", "secret").await;

    match session.state() {
        LoginSessionState::Failed { reason, kind } => {
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

    let session = LoginSession::start_saved_credential(
        Arc::clone(&api) as Arc<dyn LoginApi>,
        &config,
        &web,
        String::new(),
        "usr_saved".into(),
    )
    .await;

    match session.state() {
        LoginSessionState::Authenticated { session } => {
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

    let session = LoginSession::start_saved_credential(
        Arc::clone(&api) as Arc<dyn LoginApi>,
        &config,
        &web,
        String::new(),
        "usr_saved".into(),
    )
    .await;

    match session.state() {
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

    let session = LoginSession::start_saved_credential(
        Arc::clone(&api) as Arc<dyn LoginApi>,
        &config,
        &web,
        String::new(),
        "usr_saved".into(),
    )
    .await;

    match session.state() {
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

    let session = LoginSession::start_saved_credential(
        Arc::clone(&api) as Arc<dyn LoginApi>,
        &config,
        &web,
        String::new(),
        "usr_saved".into(),
    )
    .await;

    match session.state() {
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

    let session = LoginSession::start_saved_credential(
        Arc::clone(&api) as Arc<dyn LoginApi>,
        &config,
        &web,
        String::new(),
        "usr_unknown".into(),
    )
    .await;

    match session.state() {
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

    let session =
        LoginSession::start_cookie_restore(Arc::clone(&api) as Arc<dyn LoginApi>, String::new())
            .await;

    match session.state() {
        LoginSessionState::Authenticated { session } => {
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

    let session =
        LoginSession::start_cookie_restore(Arc::clone(&api) as Arc<dyn LoginApi>, String::new())
            .await;

    match session.state() {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(api.call_paths(), vec!["config"]);
}

#[tokio::test]
async fn cookie_restore_reports_a_two_factor_requirement_as_unavailable() {
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, json!({ "requiresTwoFactorAuth": ["totp", "otp"] })),
    ]));

    let session =
        LoginSession::start_cookie_restore(Arc::clone(&api) as Arc<dyn LoginApi>, String::new())
            .await;

    match session.state() {
        LoginSessionState::Failed { reason, kind } => {
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

    let session =
        LoginSession::start_cookie_restore(Arc::clone(&api) as Arc<dyn LoginApi>, String::new())
            .await;

    match session.state() {
        LoginSessionState::Failed { reason, kind } => {
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

    let session =
        LoginSession::start_cookie_restore(Arc::clone(&api) as Arc<dyn LoginApi>, String::new())
            .await;

    match session.state() {
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

    let session =
        LoginSession::start_cookie_restore(Arc::clone(&api) as Arc<dyn LoginApi>, String::new())
            .await;

    match session.state() {
        LoginSessionState::Failed { kind, .. } => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

#[tokio::test]
async fn cookie_restore_fails_on_a_network_error() {
    let api = Arc::new(FakeLoginApi::new(vec![]).with_network_error("connection reset"));

    let session =
        LoginSession::start_cookie_restore(Arc::clone(&api) as Arc<dyn LoginApi>, String::new())
            .await;

    match session.state() {
        LoginSessionState::Failed { reason, kind } => {
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
                endpoint: String::new(),
                user_id: "usr_saved".into(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(outcome, AutoLoginOutcome::Challenge { .. }));

    let state = runtime
        .respond("totp".into(), "123456".into(), &web, &config)
        .await;
    match &state {
        LoginSessionState::Authenticated { session } => {
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
async fn a_stale_respond_cannot_replace_a_newer_session_or_use_its_finalize() {
    let (_dir, config, web, _db) = test_env("respond-generation");
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
        config.as_ref(),
        "old@example.test",
        false,
    )
    .await;
    assert!(matches!(initial, LoginSessionState::Challenge { .. }));

    let respond_task = {
        let runtime = runtime.clone();
        let web = Arc::clone(&web);
        let config = Arc::clone(&config);
        tokio::spawn(async move {
            runtime
                .respond(
                    "totp".into(),
                    "123456".into(),
                    web.as_ref(),
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
    let newer = start_runtime_basic(
        &runtime,
        new_api as Arc<dyn LoginApi>,
        web.as_ref(),
        config.as_ref(),
        "new@example.test",
        true,
    )
    .await;
    assert!(matches!(
        newer,
        LoginSessionState::Challenge { ref mode, .. } if mode == "emailOtp"
    ));

    old_api.resume();
    assert!(matches!(
        respond_task.await.unwrap(),
        LoginSessionState::Cancelled
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
    let (_dir, config, web, _db) = test_env("respond-cancel-generation");
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
        config.as_ref(),
        "self@example.test",
        true,
    )
    .await;
    assert!(matches!(initial, LoginSessionState::Challenge { .. }));

    let respond_task = {
        let runtime = runtime.clone();
        let web = Arc::clone(&web);
        let config = Arc::clone(&config);
        tokio::spawn(async move {
            runtime
                .respond(
                    "totp".into(),
                    "123456".into(),
                    web.as_ref(),
                    config.as_ref(),
                )
                .await
        })
    };
    api.wait_until_paused().await;

    assert!(matches!(runtime.cancel(), LoginSessionState::Cancelled));
    api.resume();

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
                        endpoint: String::new(),
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
    let manual = start_runtime_basic(
        &runtime,
        manual_api as Arc<dyn LoginApi>,
        web.as_ref(),
        config.as_ref(),
        "manual@example.test",
        true,
    )
    .await;
    assert!(matches!(
        manual,
        LoginSessionState::Challenge { ref mode, .. } if mode == "emailOtp"
    ));

    auto_api.resume();
    let error = auto_task.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("superseded"));
    assert!(matches!(
        runtime.state(),
        LoginSessionState::Challenge { ref mode, .. } if mode == "emailOtp"
    ));
}
