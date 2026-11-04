use super::*;
use serde_json::json;
use std::sync::Arc;
use vrcx_0_application_core::ConfigStore;

use super::super::test_support::{seed_saved_credential, test_env, user_json, FakeLoginApi};
use super::super::types::TwoFactorMethod;

async fn drive_test_auto_login(
    api: Arc<dyn LoginApi>,
    config: &dyn AuthCredentialStore,
    web: &dyn AuthSessionCookies,
    throttle: &AutoLoginThrottle,
    input: AutoLoginStartInput,
) -> AutoLoginDrive {
    let runtime = crate::auth::LoginSessionRuntime::new();
    let operation = runtime.begin_operation(&|_| Ok(())).unwrap();
    drive_auto_login(api.as_ref(), config, web, throttle, &operation, input)
        .await
        .unwrap()
}

#[test]
fn session_outcome_preserves_the_login_state_wire_shape() {
    let outcome = AutoLoginOutcome::Session(LoginSessionState::Challenge {
        attempt_id: "attempt-1".into(),
        methods: vec!["totp".into(), "otp".into()],
        mode: "totp".into(),
        error: None,
    });

    assert_eq!(
        serde_json::to_value(outcome).unwrap(),
        json!({
            "status": "challenge",
            "attemptId": "attempt-1",
            "methods": ["totp", "otp"],
            "mode": "totp",
            "error": null
        })
    );
}

#[test]
fn throttle_allows_up_to_three_attempts_per_hour() {
    let throttle = AutoLoginThrottle::new();
    let now = Instant::now();
    assert!(throttle.can_attempt("usr_1", now));
    assert_eq!(throttle.record_attempt("usr_1", now), 1);
    assert!(throttle.can_attempt("usr_1", now));
    assert_eq!(throttle.record_attempt("usr_1", now), 2);
    assert!(throttle.can_attempt("usr_1", now));
    assert_eq!(throttle.record_attempt("usr_1", now), 3);
    assert!(!throttle.can_attempt("usr_1", now));
}

#[test]
fn throttle_window_slides_and_allows_again_after_an_hour() {
    let throttle = AutoLoginThrottle::new();
    let base = Instant::now();
    throttle.record_attempt("usr_1", base);
    throttle.record_attempt("usr_1", base + Duration::from_secs(1));
    throttle.record_attempt("usr_1", base + Duration::from_secs(2));
    assert!(!throttle.can_attempt("usr_1", base + Duration::from_secs(3)));

    assert!(throttle.can_attempt("usr_1", base + AUTO_LOGIN_WINDOW + Duration::from_secs(1)));
}

#[test]
fn throttle_tracks_accounts_independently() {
    let throttle = AutoLoginThrottle::new();
    let now = Instant::now();
    throttle.record_attempt("usr_a", now);
    throttle.record_attempt("usr_a", now);
    throttle.record_attempt("usr_a", now);
    assert!(!throttle.can_attempt("usr_a", now));
    assert!(throttle.can_attempt("usr_b", now));
}

#[test]
fn throttle_reset_all_clears_every_account() {
    let throttle = AutoLoginThrottle::new();
    let now = Instant::now();
    throttle.record_attempt("usr_a", now);
    throttle.record_attempt("usr_a", now);
    throttle.record_attempt("usr_a", now);
    throttle.record_attempt("usr_b", now);
    throttle.reset_all();
    assert!(throttle.can_attempt("usr_a", now));
    assert!(throttle.can_attempt("usr_b", now));
}

#[tokio::test]
async fn cookie_restore_success_never_attempts_saved_credential() {
    let (_dir, config, web, _db) = test_env("cookie-success");
    seed_saved_credential(&config, &web, "usr_saved");
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (
            200,
            json!({ "id": "usr_saved", "displayName": "Saved User" }),
        ),
    ]));

    let runtime = crate::auth::LoginSessionRuntime::new();
    let outcome = runtime
        .auto_login_start_with(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            AutoLoginStartInput {
                user_id: "usr_saved".into(),
            },
        )
        .await
        .unwrap();

    assert!(matches!(
        outcome,
        AutoLoginOutcome::Session(LoginSessionState::Authenticated { .. })
    ));
    assert_eq!(api.call_names(), vec!["config", "current_user"]);
}

#[tokio::test]
async fn cookie_restore_for_another_user_falls_back_to_the_target_account() {
    let (_dir, config, web, _db) = test_env("cookie-user-mismatch");
    seed_saved_credential(&config, &web, "usr_saved");
    let throttle = AutoLoginThrottle::new();
    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (200, json!({ "id": "usr_other", "displayName": "Other" })),
        (200, json!({})),
        (
            200,
            json!({ "id": "usr_saved", "displayName": "Saved User" }),
        ),
    ]));

    let drive = drive_test_auto_login(
        api.clone() as Arc<dyn LoginApi>,
        &config,
        &web,
        &throttle,
        AutoLoginStartInput {
            user_id: "usr_saved".into(),
        },
    )
    .await;

    assert!(matches!(
        drive,
        AutoLoginDrive::Install(LoginSessionState::Authenticated { ref session, .. })
            if session.user_id == "usr_saved"
    ));
    assert_eq!(
        api.call_names(),
        vec!["config", "current_user", "config", "current_user"]
    );
}

#[tokio::test]
async fn missing_credentials_falls_back_to_saved_credential_and_records_login_success() {
    let (_dir, config, web, _db) = test_env("missing-creds-fallback");
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
        (200, user_json()),
    ]));

    let runtime = crate::auth::LoginSessionRuntime::new();
    let outcome = runtime
        .auto_login_start_with(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            AutoLoginStartInput {
                user_id: "usr_saved".into(),
            },
        )
        .await
        .unwrap();

    match &outcome {
        AutoLoginOutcome::Session(LoginSessionState::Authenticated { session, .. }) => {
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
async fn config_missing_credentials_also_falls_back_to_the_saved_account() {
    let (_dir, config, web, _db) = test_env("config-missing-creds-fallback");
    seed_saved_credential(&config, &web, "usr_saved");

    let api = Arc::new(FakeLoginApi::new(vec![
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
        (200, user_json()),
    ]));

    let outcome = crate::auth::LoginSessionRuntime::new()
        .auto_login_start_with(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            AutoLoginStartInput {
                user_id: "usr_saved".into(),
            },
        )
        .await
        .unwrap();

    assert!(matches!(
        outcome,
        AutoLoginOutcome::Session(LoginSessionState::Authenticated { ref session, .. })
            if session.user_id == "usr_123"
    ));
    assert_eq!(api.call_names().first().map(String::as_str), Some("config"));
    assert_eq!(
        api.call_names().last().map(String::as_str),
        Some("basic_login")
    );
}

#[tokio::test]
async fn missing_credentials_fallback_can_surface_a_two_factor_challenge() {
    let (_dir, config, web, _db) = test_env("missing-creds-challenge");
    seed_saved_credential(&config, &web, "usr_saved");
    let throttle = AutoLoginThrottle::new();

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
    ]));

    let drive = drive_test_auto_login(
        Arc::clone(&api) as Arc<dyn LoginApi>,
        &config,
        &web,
        &throttle,
        AutoLoginStartInput {
            user_id: "usr_saved".into(),
        },
    )
    .await;

    match &drive {
        AutoLoginDrive::Install(LoginSessionState::Challenge { methods, mode, .. }) => {
            assert_eq!(methods, &vec![TwoFactorMethod::Totp, TwoFactorMethod::Otp]);
            assert_eq!(mode, &TwoFactorMethod::Totp);
        }
        _ => panic!("expected an installable Challenge"),
    }
}

#[tokio::test]
async fn missing_credentials_without_fallback_available_reports_expired() {
    let (_dir, config, web, _db) = test_env("missing-creds-no-fallback");

    let api = Arc::new(FakeLoginApi::new(vec![
        (200, json!({})),
        (
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        ),
    ]));

    let outcome = crate::auth::LoginSessionRuntime::new()
        .auto_login_start_with(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            AutoLoginStartInput {
                user_id: "usr_unknown".into(),
            },
        )
        .await
        .unwrap();

    assert!(matches!(
        outcome,
        AutoLoginOutcome::Terminal(AutoLoginTerminalOutcome::Expired { .. })
    ));
}

#[tokio::test]
async fn config_missing_credentials_without_a_saved_login_reports_expired() {
    let (_dir, config, web, _db) = test_env("config-missing-creds-no-fallback");
    let api = Arc::new(FakeLoginApi::new(vec![(
        401,
        json!({ "error": { "message": "Missing Credentials" } }),
    )]));

    let outcome = crate::auth::LoginSessionRuntime::new()
        .auto_login_start_with(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            AutoLoginStartInput {
                user_id: "usr_unknown".into(),
            },
        )
        .await
        .unwrap();

    assert!(matches!(
        outcome,
        AutoLoginOutcome::Terminal(AutoLoginTerminalOutcome::Expired { .. })
    ));
    assert_eq!(api.call_names(), vec!["config"]);
}

#[tokio::test]
async fn a_non_missing_credentials_cookie_failure_never_attempts_a_fallback() {
    let (_dir, config, web, _db) = test_env("cookie-network-failure");
    seed_saved_credential(&config, &web, "usr_saved");

    let api = Arc::new(FakeLoginApi::new(vec![(
        403,
        json!({ "error": { "message": "Forbidden" } }),
    )]));

    let outcome = crate::auth::LoginSessionRuntime::new()
        .auto_login_start_with(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            AutoLoginStartInput {
                user_id: "usr_saved".into(),
            },
        )
        .await
        .unwrap();

    match &outcome {
        AutoLoginOutcome::Session(LoginSessionState::Failed { kind, .. }) => {
            assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
    assert_eq!(api.call_names(), vec!["config"]);
}

#[tokio::test]
async fn throttled_attempt_clears_auth_cookies_and_last_user() {
    let (_dir, config, web, _db) = test_env("throttled");
    seed_saved_credential(&config, &web, "usr_saved");
    web.set_cookies("auth=live").unwrap();
    let throttle = AutoLoginThrottle::new();
    let now = Instant::now();
    throttle.record_attempt("usr_saved", now);
    throttle.record_attempt("usr_saved", now);
    throttle.record_attempt("usr_saved", now);

    let api = Arc::new(FakeLoginApi::new(vec![]));

    let drive = drive_test_auto_login(
        Arc::clone(&api) as Arc<dyn LoginApi>,
        &config,
        &web,
        &throttle,
        AutoLoginStartInput {
            user_id: "usr_saved".into(),
        },
    )
    .await;

    assert!(matches!(
        drive,
        AutoLoginDrive::Done(outcome)
            if matches!(
                *outcome,
                AutoLoginOutcome::Terminal(AutoLoginTerminalOutcome::Throttled { .. })
            )
    ));
    assert!(api.call_names().is_empty());
    assert_eq!(
        config
            .get_string("lastUserLoggedIn", "")
            .unwrap_or_default(),
        ""
    );
    assert!(web.get_cookies().is_empty());
}

#[test]
fn invalid_credentials_failure_deletes_the_saved_credential() {
    let (_dir, config, web, _db) = test_env("cleanup-invalid-credentials");
    seed_saved_credential(&config, &web, "usr_saved");

    let snapshot = apply_failure_cleanup(
        &web,
        &config,
        "usr_saved",
        LoginFailureKind::InvalidCredentials,
    )
    .unwrap();

    assert_eq!(snapshot.last_user_logged_in, None);
    assert!(snapshot.saved_credentials_list.is_empty());
}

#[test]
fn session_invalidated_and_missing_credentials_failures_clear_auth_cookies_and_last_user() {
    for kind in [
        LoginFailureKind::SessionInvalidated,
        LoginFailureKind::MissingCredentials,
    ] {
        let (_dir, config, web, _db) = test_env("cleanup-clears-last-user");
        seed_saved_credential(&config, &web, "usr_saved");
        web.set_cookies("auth=live").unwrap();

        let snapshot = apply_failure_cleanup(&web, &config, "usr_saved", kind).unwrap();

        assert_eq!(snapshot.last_user_logged_in, None);
        assert_eq!(snapshot.saved_credentials_list.len(), 1);
        assert!(web.get_cookies().is_empty());
    }
}

#[test]
fn two_factor_unavailable_failure_keeps_the_last_user() {
    let (_dir, config, web, _db) = test_env("cleanup-two-factor-unavailable");
    seed_saved_credential(&config, &web, "usr_saved");

    let snapshot = apply_failure_cleanup(
        &web,
        &config,
        "usr_saved",
        LoginFailureKind::TwoFactorUnavailable,
    )
    .unwrap();

    assert_eq!(snapshot.last_user_logged_in.as_deref(), Some("usr_saved"));
}

#[test]
fn network_failure_keeps_the_last_user() {
    let (_dir, config, web, _db) = test_env("cleanup-network");
    seed_saved_credential(&config, &web, "usr_saved");

    let snapshot =
        apply_failure_cleanup(&web, &config, "usr_saved", LoginFailureKind::Network).unwrap();

    assert_eq!(snapshot.last_user_logged_in.as_deref(), Some("usr_saved"));
}
