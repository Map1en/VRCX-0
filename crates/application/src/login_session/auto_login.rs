use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use crate::{
    delete_saved_credential, record_login_success, record_logout, saved_snapshot,
    LoginSuccessRecordInput, LogoutRecordInput, WebClient,
};

use super::runtime::LoginSessionOperation;
use super::service::LoginSession;
use super::types::{LoginApi, LoginFailureKind, LoginSessionState, TwoFactorMethod};

const AUTO_LOGIN_WINDOW: Duration = Duration::from_secs(60 * 60);
const AUTO_LOGIN_MAX_ATTEMPTS: usize = 3;

pub struct AutoLoginStartInput {
    pub endpoint: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum AutoLoginOutcome {
    Throttled {
        snapshot: Value,
    },
    Authenticated {
        session: crate::AuthenticatedRuntimeSession,
    },
    Challenge {
        methods: Vec<TwoFactorMethod>,
        mode: TwoFactorMethod,
        error: Option<String>,
    },
    Expired {
        snapshot: Value,
    },
    Failed {
        reason: String,
        kind: LoginFailureKind,
        snapshot: Value,
    },
}

pub(crate) struct AutoLoginThrottle {
    attempts_by_key: Mutex<HashMap<String, Vec<Instant>>>,
}

impl AutoLoginThrottle {
    pub(crate) fn new() -> Self {
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

    pub(crate) fn attempt_count(&self, user_id: &str, now: Instant) -> usize {
        let key = Self::normalize_key(user_id);
        let mut attempts = self.attempts_by_key.lock().unwrap();
        let bucket = attempts.entry(key).or_default();
        Self::prune(bucket, now);
        bucket.len()
    }

    pub(crate) fn can_attempt(&self, user_id: &str, now: Instant) -> bool {
        self.attempt_count(user_id, now) < AUTO_LOGIN_MAX_ATTEMPTS
    }

    pub(crate) fn record_attempt(&self, user_id: &str, now: Instant) -> usize {
        let key = Self::normalize_key(user_id);
        let mut attempts = self.attempts_by_key.lock().unwrap();
        let bucket = attempts.entry(key).or_default();
        Self::prune(bucket, now);
        bucket.push(now);
        bucket.len()
    }

    pub(crate) fn reset_all(&self) {
        self.attempts_by_key.lock().unwrap().clear();
    }
}

impl Default for AutoLoginThrottle {
    fn default() -> Self {
        Self::new()
    }
}

pub(super) async fn drive_auto_login(
    api: Arc<dyn LoginApi>,
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
    throttle: &AutoLoginThrottle,
    operation: &LoginSessionOperation,
    input: AutoLoginStartInput,
) -> crate::Result<(Option<LoginSession>, AutoLoginOutcome)> {
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
            Ok(snapshot) => AutoLoginOutcome::Throttled { snapshot },
            Err(error) => failure_outcome(
                operation,
                config,
                error.to_string(),
                LoginFailureKind::Other,
            )?,
        };
        return Ok((None, outcome));
    }
    operation.run_if_current(|| {
        throttle.record_attempt(&user_id, Instant::now());
        Ok(())
    })?;

    let cookie_session =
        LoginSession::start_cookie_restore(Arc::clone(&api), input.endpoint.clone()).await;
    operation.ensure_current()?;

    let is_missing_credentials = matches!(
        cookie_session.state(),
        LoginSessionState::Failed {
            kind: LoginFailureKind::MissingCredentials,
            ..
        }
    );

    if !is_missing_credentials {
        return finish_terminal(cookie_session, web, db, config, operation, &user_id);
    }

    operation.run_if_current(|| {
        clear_auth_cookies_and_save(web, db);
        Ok(())
    })?;

    let probe_snapshot = operation.run_if_current(|| saved_snapshot(config))?;
    let fallback_available = probe_snapshot
        .get("savedCredentialFallbackAvailable")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !fallback_available {
        return Ok((
            Some(cookie_session),
            AutoLoginOutcome::Expired {
                snapshot: probe_snapshot,
            },
        ));
    }

    let saved_session = LoginSession::start_saved_credential(
        Arc::clone(&api),
        config,
        web,
        input.endpoint.clone(),
        user_id.clone(),
    )
    .await;
    operation.ensure_current()?;

    match saved_session.state() {
        LoginSessionState::Authenticated { session } => {
            let session = session.clone();
            let record_result = operation.run_if_current(|| {
                Ok(record_login_success(
                    config,
                    web,
                    LoginSuccessRecordInput {
                        user: session.current_user.clone(),
                        login_params: Value::Null,
                        stored_login_params: None,
                        save_credentials: false,
                    },
                ))
            })?;
            if let Err(error) = record_result {
                let outcome = failure_outcome(
                    operation,
                    config,
                    error.to_string(),
                    LoginFailureKind::Other,
                )?;
                return Ok((None, outcome));
            }
            Ok((
                Some(saved_session),
                AutoLoginOutcome::Authenticated { session },
            ))
        }
        LoginSessionState::Challenge {
            methods,
            mode,
            error,
        } => {
            let outcome = AutoLoginOutcome::Challenge {
                methods: methods.clone(),
                mode: mode.clone(),
                error: error.clone(),
            };
            Ok((Some(saved_session), outcome))
        }
        LoginSessionState::Failed { .. } | LoginSessionState::Cancelled => {
            finish_terminal(saved_session, web, db, config, operation, &user_id)
        }
    }
}

fn finish_terminal(
    session: LoginSession,
    web: &WebClient,
    db: &DatabaseService,
    config: &ConfigRepository,
    operation: &LoginSessionOperation,
    user_id: &str,
) -> crate::Result<(Option<LoginSession>, AutoLoginOutcome)> {
    match session.state().clone() {
        LoginSessionState::Authenticated { session: authed } => Ok((
            Some(session),
            AutoLoginOutcome::Authenticated { session: authed },
        )),
        LoginSessionState::Challenge {
            methods,
            mode,
            error,
        } => Ok((
            Some(session),
            AutoLoginOutcome::Challenge {
                methods,
                mode,
                error,
            },
        )),
        LoginSessionState::Failed { reason, kind } => {
            let outcome = failure_after_cleanup(operation, config, web, db, user_id, reason, kind)?;
            Ok((Some(session), outcome))
        }
        LoginSessionState::Cancelled => {
            let outcome = failure_after_cleanup(
                operation,
                config,
                web,
                db,
                user_id,
                "The login session was cancelled.".into(),
                LoginFailureKind::Other,
            )?;
            Ok((Some(session), outcome))
        }
    }
}

fn failure_after_cleanup(
    operation: &LoginSessionOperation,
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
    user_id: &str,
    reason: String,
    kind: LoginFailureKind,
) -> crate::Result<AutoLoginOutcome> {
    let cleanup_result =
        operation.run_if_current(|| Ok(apply_failure_cleanup(web, db, config, user_id, kind)))?;
    match cleanup_result {
        Ok(snapshot) => Ok(AutoLoginOutcome::Failed {
            reason,
            kind,
            snapshot,
        }),
        Err(error) => failure_outcome(
            operation,
            config,
            error.to_string(),
            LoginFailureKind::Other,
        ),
    }
}

fn failure_outcome(
    operation: &LoginSessionOperation,
    config: &ConfigRepository,
    reason: String,
    kind: LoginFailureKind,
) -> crate::Result<AutoLoginOutcome> {
    let snapshot = operation.run_if_current(|| saved_snapshot(config))?;
    Ok(AutoLoginOutcome::Failed {
        reason,
        kind,
        snapshot,
    })
}

fn clear_auth_cookies_and_save(web: &WebClient, db: &DatabaseService) {
    web.clear_auth_cookies();
    web.save_cookies(db);
}

fn apply_failure_cleanup(
    web: &WebClient,
    db: &DatabaseService,
    config: &ConfigRepository,
    user_id: &str,
    kind: LoginFailureKind,
) -> crate::Result<Value> {
    match kind {
        LoginFailureKind::InvalidCredentials => {
            web.clear_cookies();
            web.save_cookies(db);
            if user_id.is_empty() {
                saved_snapshot(config)
            } else {
                delete_saved_credential(config, user_id.to_string())
            }
        }
        LoginFailureKind::SessionInvalidated | LoginFailureKind::MissingCredentials => {
            clear_auth_cookies_and_save(web, db);
            record_logout(
                config,
                web,
                LogoutRecordInput {
                    user_or_user_id: Value::String(user_id.to_string()),
                    clear_last_user_logged_in: Some(true),
                    cookies: None,
                },
            )
        }
        LoginFailureKind::TwoFactorUnavailable
        | LoginFailureKind::Network
        | LoginFailureKind::Other => {
            clear_auth_cookies_and_save(web, db);
            saved_snapshot(config)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    use crate::login_session::test_support::{
        seed_saved_credential, test_env, user_json, FakeLoginApi,
    };

    async fn drive_test_auto_login(
        api: Arc<dyn LoginApi>,
        config: &ConfigRepository,
        web: &WebClient,
        db: &DatabaseService,
        throttle: &AutoLoginThrottle,
        input: AutoLoginStartInput,
    ) -> (Option<LoginSession>, AutoLoginOutcome) {
        let runtime = crate::LoginSessionRuntime::new();
        let operation = runtime.begin_operation();
        drive_auto_login(api, config, web, db, throttle, &operation, input)
            .await
            .unwrap()
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
        let throttle = AutoLoginThrottle::new();

        let api = Arc::new(FakeLoginApi::new(vec![
            (200, json!({})),
            (200, user_json()),
        ]));

        let (session, outcome) = drive_test_auto_login(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            db.as_ref(),
            &throttle,
            AutoLoginStartInput {
                endpoint: String::new(),
                user_id: "usr_saved".into(),
            },
        )
        .await;

        assert!(matches!(outcome, AutoLoginOutcome::Authenticated { .. }));
        assert!(session.is_some());
        assert_eq!(api.call_paths(), vec!["config", "auth/user"]);
    }

    #[tokio::test]
    async fn missing_credentials_falls_back_to_saved_credential_and_records_login_success() {
        let (_dir, config, web, db) = test_env("missing-creds-fallback");
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
            (200, user_json()),
        ]));

        let (session, outcome) = drive_test_auto_login(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            db.as_ref(),
            &throttle,
            AutoLoginStartInput {
                endpoint: String::new(),
                user_id: "usr_saved".into(),
            },
        )
        .await;

        match &outcome {
            AutoLoginOutcome::Authenticated { session } => {
                assert_eq!(session.user_id, "usr_123");
            }
            other => panic!("expected Authenticated, got {other:?}"),
        }
        assert!(session.is_some());
        assert_eq!(
            config
                .get_string("lastUserLoggedIn", "")
                .unwrap_or_default(),
            "usr_123"
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

        let (session, outcome) = drive_test_auto_login(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            db.as_ref(),
            &throttle,
            AutoLoginStartInput {
                endpoint: String::new(),
                user_id: "usr_saved".into(),
            },
        )
        .await;

        match &outcome {
            AutoLoginOutcome::Challenge { methods, mode, .. } => {
                assert_eq!(methods, &vec!["totp".to_string(), "otp".to_string()]);
                assert_eq!(mode, "totp");
            }
            other => panic!("expected Challenge, got {other:?}"),
        }
        assert!(
            session.is_some(),
            "the mid-flight session must stay installable for a follow-up respond()"
        );
    }

    #[tokio::test]
    async fn missing_credentials_without_fallback_available_reports_expired() {
        let (_dir, config, web, db) = test_env("missing-creds-no-fallback");
        let throttle = AutoLoginThrottle::new();

        let api = Arc::new(FakeLoginApi::new(vec![
            (200, json!({})),
            (
                401,
                json!({ "error": { "message": "Missing Credentials" } }),
            ),
        ]));

        let (_session, outcome) = drive_test_auto_login(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            db.as_ref(),
            &throttle,
            AutoLoginStartInput {
                endpoint: String::new(),
                user_id: "usr_unknown".into(),
            },
        )
        .await;

        assert!(matches!(outcome, AutoLoginOutcome::Expired { .. }));
    }

    #[tokio::test]
    async fn a_non_missing_credentials_cookie_failure_never_attempts_a_fallback() {
        let (_dir, config, web, db) = test_env("cookie-network-failure");
        seed_saved_credential(&config, &web, "usr_saved");
        let throttle = AutoLoginThrottle::new();

        let api = Arc::new(FakeLoginApi::new(vec![(
            403,
            json!({ "error": { "message": "Forbidden" } }),
        )]));

        let (_session, outcome) = drive_test_auto_login(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            db.as_ref(),
            &throttle,
            AutoLoginStartInput {
                endpoint: String::new(),
                user_id: "usr_saved".into(),
            },
        )
        .await;

        match &outcome {
            AutoLoginOutcome::Failed { kind, .. } => {
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

        let (session, outcome) = drive_test_auto_login(
            Arc::clone(&api) as Arc<dyn LoginApi>,
            &config,
            &web,
            db.as_ref(),
            &throttle,
            AutoLoginStartInput {
                endpoint: String::new(),
                user_id: "usr_saved".into(),
            },
        )
        .await;

        assert!(session.is_none());
        assert!(matches!(outcome, AutoLoginOutcome::Throttled { .. }));
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

        assert_eq!(snapshot.get("lastUserLoggedIn"), Some(&Value::Null));
        assert_eq!(
            snapshot.get("savedCredentialCount").and_then(Value::as_u64),
            Some(0)
        );
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

        assert_eq!(snapshot.get("lastUserLoggedIn"), Some(&Value::Null));
        assert_eq!(
            snapshot.get("savedCredentialCount").and_then(Value::as_u64),
            Some(1)
        );
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

        assert_eq!(snapshot.get("lastUserLoggedIn"), Some(&Value::Null));
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

        assert_eq!(
            snapshot.get("lastUserLoggedIn"),
            Some(&Value::String("usr_saved".into()))
        );
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

        assert_eq!(
            snapshot.get("lastUserLoggedIn"),
            Some(&Value::String("usr_saved".into()))
        );
    }
}
