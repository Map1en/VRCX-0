use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use crate::{saved_snapshot, SavedAuthAutoLoginStatus, SavedAuthSnapshot, WebClient};

use super::runtime::{
    apply_login_failure_cleanup, clear_auth_cookies_and_save, LoginAttemptPolicy,
    LoginSessionOperation,
};
use super::service::{start_cookie_restore, start_saved_credential_login};
use super::types::{LoginApi, LoginFailureKind, LoginSessionState};

const AUTO_LOGIN_WINDOW: Duration = Duration::from_secs(60 * 60);
const AUTO_LOGIN_MAX_ATTEMPTS: usize = 3;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AutoLoginStartInput {
    #[serde(default)]
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum AutoLoginTerminalOutcome {
    Throttled { snapshot: Box<SavedAuthSnapshot> },
    Expired { snapshot: Box<SavedAuthSnapshot> },
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(untagged)]
pub enum AutoLoginOutcome {
    Session(LoginSessionState),
    Terminal(AutoLoginTerminalOutcome),
}

pub(super) enum AutoLoginDrive {
    Install(LoginSessionState),
    Done(Box<AutoLoginOutcome>),
}

pub(super) struct AutoLoginThrottle {
    attempts_by_key: Mutex<HashMap<String, Vec<Instant>>>,
}

impl AutoLoginThrottle {
    pub(super) fn new() -> Self {
        Self {
            attempts_by_key: Mutex::new(HashMap::new()),
        }
    }

    fn normalize_key(user_id: &str) -> String {
        let trimmed = user_id.trim();
        if trimmed.is_empty() {
            "__global__".to_string()
        } else {
            trimmed.to_string()
        }
    }

    fn prune(bucket: &mut Vec<Instant>, now: Instant) {
        bucket.retain(|attempt| now.saturating_duration_since(*attempt) < AUTO_LOGIN_WINDOW);
    }

    fn attempt_count(&self, user_id: &str, now: Instant) -> usize {
        let key = Self::normalize_key(user_id);
        let mut attempts = self.attempts_by_key.lock().unwrap();
        let bucket = attempts.entry(key).or_default();
        Self::prune(bucket, now);
        bucket.len()
    }

    fn can_attempt(&self, user_id: &str, now: Instant) -> bool {
        self.attempt_count(user_id, now) < AUTO_LOGIN_MAX_ATTEMPTS
    }

    fn record_attempt(&self, user_id: &str, now: Instant) -> usize {
        let key = Self::normalize_key(user_id);
        let mut attempts = self.attempts_by_key.lock().unwrap();
        let bucket = attempts.entry(key).or_default();
        Self::prune(bucket, now);
        bucket.push(now);
        bucket.len()
    }

    pub(super) fn reset_all(&self) {
        self.attempts_by_key.lock().unwrap().clear();
    }
}

impl Default for AutoLoginThrottle {
    fn default() -> Self {
        Self::new()
    }
}

pub(super) async fn drive_auto_login(
    api: &dyn LoginApi,
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
    throttle: &AutoLoginThrottle,
    operation: &LoginSessionOperation,
    input: AutoLoginStartInput,
) -> crate::Result<AutoLoginDrive> {
    let user_id = input.user_id.trim().to_string();

    let can_attempt =
        operation.run_if_current(|| Ok(throttle.can_attempt(&user_id, Instant::now())))?;
    if !can_attempt {
        let cleanup_result = operation.run_if_current(|| {
            Ok(apply_failure_cleanup(
                web,
                db,
                config,
                &user_id,
                LoginFailureKind::SessionInvalidated,
            ))
        })?;
        let outcome = match cleanup_result {
            Ok(snapshot) => AutoLoginOutcome::Terminal(AutoLoginTerminalOutcome::Throttled {
                snapshot: Box::new(snapshot),
            }),
            Err(error) => failure_outcome(
                operation,
                config,
                error.to_string(),
                LoginFailureKind::Other,
            )?,
        };
        return Ok(AutoLoginDrive::Done(Box::new(outcome)));
    }
    operation.run_if_current(|| {
        throttle.record_attempt(&user_id, Instant::now());
        Ok(())
    })?;

    let cookie_state = start_cookie_restore(api, VRCHAT_API_DEFAULT_ENDPOINT, &user_id).await;
    operation.ensure_current()?;

    let is_missing_credentials = matches!(
        cookie_state,
        LoginSessionState::Failed {
            kind: LoginFailureKind::MissingCredentials,
            ..
        }
    );

    if !is_missing_credentials {
        return Ok(AutoLoginDrive::Install(cookie_state));
    }

    operation.run_if_current(|| {
        clear_auth_cookies_and_save(web, db);
        Ok(())
    })?;

    let probe_snapshot = operation.run_if_current(|| saved_snapshot(config))?;
    let fallback_available = probe_snapshot.auto_login_status
        == SavedAuthAutoLoginStatus::Available
        && probe_snapshot
            .saved_credentials_list
            .iter()
            .any(|credential| credential.user.id == user_id);
    if !fallback_available {
        return Ok(AutoLoginDrive::Done(Box::new(AutoLoginOutcome::Terminal(
            AutoLoginTerminalOutcome::Expired {
                snapshot: Box::new(probe_snapshot),
            },
        ))));
    }

    let saved_state = start_saved_credential_login(
        api,
        config,
        web,
        VRCHAT_API_DEFAULT_ENDPOINT.to_string(),
        user_id.clone(),
    )
    .await;
    operation.ensure_current()?;
    Ok(AutoLoginDrive::Install(saved_state))
}

fn failure_outcome(
    operation: &LoginSessionOperation,
    config: &ConfigRepository,
    reason: String,
    kind: LoginFailureKind,
) -> crate::Result<AutoLoginOutcome> {
    let snapshot = operation.run_if_current(|| saved_snapshot(config))?;
    Ok(AutoLoginOutcome::Session(LoginSessionState::Failed {
        reason,
        kind,
        snapshot: Some(Box::new(snapshot)),
    }))
}

fn apply_failure_cleanup(
    web: &WebClient,
    db: &DatabaseService,
    config: &ConfigRepository,
    user_id: &str,
    kind: LoginFailureKind,
) -> crate::Result<SavedAuthSnapshot> {
    apply_login_failure_cleanup(
        web,
        db,
        config,
        &LoginAttemptPolicy::SavedCredential {
            user_id: user_id.to_string(),
        },
        kind,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    use super::super::test_support::{seed_saved_credential, test_env, user_json, FakeLoginApi};

    async fn drive_test_auto_login(
        api: Arc<dyn LoginApi>,
        config: &ConfigRepository,
        web: &WebClient,
        db: &DatabaseService,
        throttle: &AutoLoginThrottle,
        input: AutoLoginStartInput,
    ) -> AutoLoginDrive {
        let runtime = crate::LoginSessionRuntime::new();
        let operation = runtime.begin_operation(&|_| Ok(())).unwrap();
        drive_auto_login(api.as_ref(), config, web, db, throttle, &operation, input)
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
        let (_dir, config, web, db) = test_env("cookie-success");
        seed_saved_credential(&config, &web, "usr_saved");
        let api = Arc::new(FakeLoginApi::new(vec![
            (200, json!({})),
            (
                200,
                json!({ "id": "usr_saved", "displayName": "Saved User" }),
            ),
        ]));

        let runtime = crate::LoginSessionRuntime::new();
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

        assert!(matches!(
            outcome,
            AutoLoginOutcome::Session(LoginSessionState::Authenticated { .. })
        ));
        assert_eq!(api.call_paths(), vec!["config", "auth/user"]);
    }

    #[tokio::test]
    async fn cookie_restore_for_another_user_falls_back_to_the_target_account() {
        let (_dir, config, web, db) = test_env("cookie-user-mismatch");
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
            db.as_ref(),
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
            api.call_paths(),
            vec!["config", "auth/user", "config", "auth/user"]
        );
    }

    #[tokio::test]
    async fn missing_credentials_falls_back_to_saved_credential_and_records_login_success() {
        let (_dir, config, web, db) = test_env("missing-creds-fallback");
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

        let runtime = crate::LoginSessionRuntime::new();
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
        let (_dir, config, web, db) = test_env("config-missing-creds-fallback");
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

        let outcome = crate::LoginSessionRuntime::new()
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

        assert!(matches!(
            outcome,
            AutoLoginOutcome::Session(LoginSessionState::Authenticated { ref session, .. })
                if session.user_id == "usr_123"
        ));
        assert_eq!(api.call_paths().first().map(String::as_str), Some("config"));
        assert_eq!(
            api.call_paths().last().map(String::as_str),
            Some("auth/user")
        );
    }

    #[tokio::test]
    async fn missing_credentials_fallback_can_surface_a_two_factor_challenge() {
        let (_dir, config, web, db) = test_env("missing-creds-challenge");
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
            db.as_ref(),
            &throttle,
            AutoLoginStartInput {
                user_id: "usr_saved".into(),
            },
        )
        .await;

        match &drive {
            AutoLoginDrive::Install(LoginSessionState::Challenge { methods, mode, .. }) => {
                assert_eq!(methods, &vec!["totp".to_string(), "otp".to_string()]);
                assert_eq!(mode, "totp");
            }
            _ => panic!("expected an installable Challenge"),
        }
    }

    #[tokio::test]
    async fn missing_credentials_without_fallback_available_reports_expired() {
        let (_dir, config, web, db) = test_env("missing-creds-no-fallback");

        let api = Arc::new(FakeLoginApi::new(vec![
            (200, json!({})),
            (
                401,
                json!({ "error": { "message": "Missing Credentials" } }),
            ),
        ]));

        let outcome = crate::LoginSessionRuntime::new()
            .auto_login_start_with(
                Arc::clone(&api) as Arc<dyn LoginApi>,
                &config,
                &web,
                db.as_ref(),
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
        let (_dir, config, web, db) = test_env("config-missing-creds-no-fallback");
        let api = Arc::new(FakeLoginApi::new(vec![(
            401,
            json!({ "error": { "message": "Missing Credentials" } }),
        )]));

        let outcome = crate::LoginSessionRuntime::new()
            .auto_login_start_with(
                Arc::clone(&api) as Arc<dyn LoginApi>,
                &config,
                &web,
                db.as_ref(),
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
        assert_eq!(api.call_paths(), vec!["config"]);
    }

    #[tokio::test]
    async fn a_non_missing_credentials_cookie_failure_never_attempts_a_fallback() {
        let (_dir, config, web, db) = test_env("cookie-network-failure");
        seed_saved_credential(&config, &web, "usr_saved");

        let api = Arc::new(FakeLoginApi::new(vec![(
            403,
            json!({ "error": { "message": "Forbidden" } }),
        )]));

        let outcome = crate::LoginSessionRuntime::new()
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

        match &outcome {
            AutoLoginOutcome::Session(LoginSessionState::Failed { kind, .. }) => {
                assert_eq!(*kind, LoginFailureKind::SessionInvalidated);
            }
            other => panic!("expected Failed, got {other:?}"),
        }
        assert_eq!(api.call_paths(), vec!["config"]);
    }

    #[tokio::test]
    async fn throttled_attempt_clears_auth_cookies_and_last_user() {
        let (_dir, config, web, db) = test_env("throttled");
        seed_saved_credential(&config, &web, "usr_saved");
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
            db.as_ref(),
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
        assert!(api.call_paths().is_empty());
        assert_eq!(
            config
                .get_string("lastUserLoggedIn", "")
                .unwrap_or_default(),
            ""
        );
    }

    #[test]
    fn invalid_credentials_failure_deletes_the_saved_credential() {
        let (_dir, config, web, db) = test_env("cleanup-invalid-credentials");
        seed_saved_credential(&config, &web, "usr_saved");

        let snapshot = apply_failure_cleanup(
            &web,
            db.as_ref(),
            &config,
            "usr_saved",
            LoginFailureKind::InvalidCredentials,
        )
        .unwrap();

        assert_eq!(snapshot.last_user_logged_in, None);
        assert!(snapshot.saved_credentials_list.is_empty());
    }

    #[test]
    fn session_invalidated_failure_clears_auth_cookies_and_last_user() {
        let (_dir, config, web, db) = test_env("cleanup-session-invalidated");
        seed_saved_credential(&config, &web, "usr_saved");

        let snapshot = apply_failure_cleanup(
            &web,
            db.as_ref(),
            &config,
            "usr_saved",
            LoginFailureKind::SessionInvalidated,
        )
        .unwrap();

        assert_eq!(snapshot.last_user_logged_in, None);
        assert_eq!(snapshot.saved_credentials_list.len(), 1);
    }

    #[test]
    fn missing_credentials_failure_clears_auth_cookies_and_last_user() {
        let (_dir, config, web, db) = test_env("cleanup-missing-credentials");
        seed_saved_credential(&config, &web, "usr_saved");

        let snapshot = apply_failure_cleanup(
            &web,
            db.as_ref(),
            &config,
            "usr_saved",
            LoginFailureKind::MissingCredentials,
        )
        .unwrap();

        assert_eq!(snapshot.last_user_logged_in, None);
    }

    #[test]
    fn two_factor_unavailable_failure_keeps_the_last_user() {
        let (_dir, config, web, db) = test_env("cleanup-two-factor-unavailable");
        seed_saved_credential(&config, &web, "usr_saved");

        let snapshot = apply_failure_cleanup(
            &web,
            db.as_ref(),
            &config,
            "usr_saved",
            LoginFailureKind::TwoFactorUnavailable,
        )
        .unwrap();

        assert_eq!(snapshot.last_user_logged_in.as_deref(), Some("usr_saved"));
    }

    #[test]
    fn network_failure_keeps_the_last_user() {
        let (_dir, config, web, db) = test_env("cleanup-network");
        seed_saved_credential(&config, &web, "usr_saved");

        let snapshot = apply_failure_cleanup(
            &web,
            db.as_ref(),
            &config,
            "usr_saved",
            LoginFailureKind::Network,
        )
        .unwrap();

        assert_eq!(snapshot.last_user_logged_in.as_deref(), Some("usr_saved"));
    }
}
