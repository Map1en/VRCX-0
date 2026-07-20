use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use vrcx_0_application_core::RuntimeRealtimeTransportEpoch;
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use crate::{
    delete_saved_credential, record_login_success, record_logout, saved_snapshot,
    AuthenticatedRuntimeSession, Error, LoginSuccessRecordInput, LogoutRecordInput,
    SavedAuthSnapshot, WebClient,
};

use super::auto_login::{
    drive_auto_login, AutoLoginDrive, AutoLoginOutcome, AutoLoginStartInput,
    AutoLoginTerminalOutcome, AutoLoginThrottle,
};
use super::service::{respond_to_challenge, start_gui_basic_login, start_saved_credential_login};
use super::types::{LoginApi, LoginFailureKind, LoginSessionState, WebClientLoginApi};

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum LoginSessionStartInput {
    #[serde(rename_all = "camelCase")]
    Basic {
        #[serde(default)]
        username: String,
        #[serde(default)]
        password: String,
        #[serde(default)]
        save_credentials: bool,
    },
    #[serde(rename_all = "camelCase")]
    SavedCredential {
        #[serde(default)]
        user_id: String,
    },
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LoginSessionRespondInput {
    #[serde(default)]
    pub attempt_id: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub code: String,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LoginSessionCancelInput {
    #[serde(default)]
    pub attempt_id: String,
}

pub struct LoginSessionEndRequest {
    pub user_id: String,
    pub kind: LoginSessionEnd,
}

pub enum LoginRuntimeTransition {
    Authenticating,
    Authenticated(AuthenticatedRuntimeSession),
    Unauthenticated(String),
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoginSessionEnd {
    Logout,
    #[serde(rename_all = "camelCase")]
    Invalidated {
        #[serde(default)]
        expected_user_id: String,
        expected_auth_scope_generation: u64,
        #[serde(default)]
        expected_realtime_transport: Option<RuntimeRealtimeTransportEpoch>,
    },
}

impl LoginSessionEnd {
    pub fn matches_invalidation(
        &self,
        current_user_id: &str,
        current_auth_scope_generation: u64,
        active_realtime_transport: Option<&RuntimeRealtimeTransportEpoch>,
    ) -> bool {
        let Self::Invalidated {
            expected_user_id,
            expected_auth_scope_generation,
            expected_realtime_transport,
        } = self
        else {
            return true;
        };
        expected_user_id.trim() == current_user_id
            && *expected_auth_scope_generation == current_auth_scope_generation
            && match expected_realtime_transport {
                None => true,
                Some(expected) => active_realtime_transport == Some(expected),
            }
    }
}

type TransitionSink<'a> = dyn Fn(LoginRuntimeTransition) -> Result<(), String> + Send + Sync + 'a;

struct LoginRuntimeDeps<'a> {
    web: &'a WebClient,
    db: &'a DatabaseService,
    config: &'a ConfigRepository,
    transition: &'a TransitionSink<'a>,
}

#[derive(Clone)]
pub(super) enum LoginAttemptPolicy {
    Basic {
        login_params: Value,
        save_credentials: bool,
    },
    SavedCredential {
        user_id: String,
    },
}

struct LoginSessionRuntimeInner {
    generation: u64,
    active: Option<ActiveChallenge>,
    inflight_attempt_id: Option<String>,
}

struct ActiveChallenge {
    generation: u64,
    attempt_id: String,
    api: Arc<dyn LoginApi>,
    endpoint: String,
    methods: Vec<String>,
    mode: String,
    error: Option<String>,
    policy: LoginAttemptPolicy,
}

impl ActiveChallenge {
    fn state(&self) -> LoginSessionState {
        LoginSessionState::Challenge {
            attempt_id: self.attempt_id.clone(),
            methods: self.methods.clone(),
            mode: self.mode.clone(),
            error: self.error.clone(),
        }
    }
}

#[derive(Clone)]
pub(super) struct LoginSessionOperation {
    inner: Arc<Mutex<LoginSessionRuntimeInner>>,
    generation: u64,
    attempt_id: String,
}

impl LoginSessionOperation {
    pub(super) fn ensure_current(&self) -> crate::Result<()> {
        self.run_if_current(|| Ok(()))
    }

    pub(super) fn run_if_current<T>(
        &self,
        operation: impl FnOnce() -> crate::Result<T>,
    ) -> crate::Result<T> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| Error::Custom("Login session state is unavailable.".into()))?;
        if inner.generation != self.generation {
            return Err(superseded_error());
        }
        operation()
    }
}

#[derive(Clone)]
pub struct LoginSessionRuntime {
    inner: Arc<Mutex<LoginSessionRuntimeInner>>,
    network_gate: Arc<AsyncMutex<()>>,
    auto_login_throttle: Arc<AutoLoginThrottle>,
}

impl Default for LoginSessionRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl LoginSessionRuntime {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(LoginSessionRuntimeInner {
                generation: 0,
                active: None,
                inflight_attempt_id: None,
            })),
            network_gate: Arc::new(AsyncMutex::new(())),
            auto_login_throttle: Arc::new(AutoLoginThrottle::new()),
        }
    }

    fn login_api(web: &Arc<WebClient>, db: &Arc<DatabaseService>) -> Arc<dyn LoginApi> {
        Arc::new(WebClientLoginApi::new(Arc::clone(web), Arc::clone(db)))
    }

    pub async fn auto_login_start(
        &self,
        web: Arc<WebClient>,
        db: Arc<DatabaseService>,
        config: &ConfigRepository,
        input: AutoLoginStartInput,
        transition: &TransitionSink<'_>,
    ) -> crate::Result<AutoLoginOutcome> {
        let api = Self::login_api(&web, &db);
        self.auto_login_start_with_transition(
            api,
            config,
            web.as_ref(),
            db.as_ref(),
            input,
            transition,
        )
        .await
    }

    #[cfg(test)]
    pub(super) async fn auto_login_start_with(
        &self,
        api: Arc<dyn LoginApi>,
        config: &ConfigRepository,
        web: &WebClient,
        db: &DatabaseService,
        input: AutoLoginStartInput,
    ) -> crate::Result<AutoLoginOutcome> {
        self.auto_login_start_with_transition(api, config, web, db, input, &|_| Ok(()))
            .await
    }

    pub(super) async fn auto_login_start_with_transition(
        &self,
        api: Arc<dyn LoginApi>,
        config: &ConfigRepository,
        web: &WebClient,
        db: &DatabaseService,
        input: AutoLoginStartInput,
        transition: &TransitionSink<'_>,
    ) -> crate::Result<AutoLoginOutcome> {
        let operation = self.begin_operation(transition)?;
        let _network = match self.acquire_network(&operation).await {
            Ok(guard) => guard,
            Err(error) => return Err(error),
        };
        let auto_user_id = input.user_id.clone();
        let endpoint = VRCHAT_API_DEFAULT_ENDPOINT.to_string();
        let result = drive_auto_login(
            api.as_ref(),
            config,
            web,
            db,
            &self.auto_login_throttle,
            &operation,
            input,
        )
        .await;
        let drive = match result {
            Ok(result) => result,
            Err(error) => {
                let reason = error.to_string();
                let _ = operation.run_if_current(|| {
                    transition(LoginRuntimeTransition::Unauthenticated(reason.clone()))
                        .map_err(Error::Custom)
                });
                return Err(error);
            }
        };
        operation.ensure_current()?;
        match drive {
            AutoLoginDrive::Install(state) => {
                let state = self.install_state(
                    &operation,
                    state,
                    api,
                    endpoint,
                    LoginAttemptPolicy::SavedCredential {
                        user_id: auto_user_id,
                    },
                    LoginRuntimeDeps {
                        web,
                        db,
                        config,
                        transition,
                    },
                )?;
                auto_login_outcome_from_state(state, config)
            }
            AutoLoginDrive::Done(outcome) => {
                let outcome = *outcome;
                if let Some(reason) = auto_login_failure_reason(&outcome) {
                    operation.run_if_current(|| {
                        transition(LoginRuntimeTransition::Unauthenticated(reason.to_string()))
                            .map_err(Error::Custom)
                    })?;
                }
                Ok(outcome)
            }
        }
    }

    pub async fn end_session(
        &self,
        web: &WebClient,
        db: &DatabaseService,
        config: &ConfigRepository,
        request: LoginSessionEndRequest,
        invalidation_matches: &(dyn Fn(&LoginSessionEnd) -> bool + Send + Sync),
        transition: &TransitionSink<'_>,
    ) -> crate::Result<Option<SavedAuthSnapshot>> {
        let operation = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| Error::Custom("Login session state is unavailable.".into()))?;
            if matches!(request.kind, LoginSessionEnd::Invalidated { .. })
                && !invalidation_matches(&request.kind)
            {
                return Ok(None);
            }
            inner.generation = inner.generation.wrapping_add(1);
            inner.active = None;
            inner.inflight_attempt_id = None;
            LoginSessionOperation {
                inner: Arc::clone(&self.inner),
                generation: inner.generation,
                attempt_id: inner.generation.to_string(),
            }
        };
        let _network = match self.acquire_network(&operation).await {
            Ok(guard) => guard,
            Err(_) if matches!(request.kind, LoginSessionEnd::Invalidated { .. }) => {
                return Ok(None)
            }
            Err(error) => return Err(error),
        };
        let current = self
            .inner
            .lock()
            .map_err(|_| Error::Custom("Login session state is unavailable.".into()))?;
        if current.generation != operation.generation {
            return Ok(None);
        }
        if matches!(request.kind, LoginSessionEnd::Invalidated { .. })
            && !invalidation_matches(&request.kind)
        {
            return Ok(None);
        }

        let result = match &request.kind {
            LoginSessionEnd::Logout => {
                let snapshot = record_logout(
                    config,
                    web,
                    LogoutRecordInput {
                        user_id: request.user_id.clone(),
                        clear_last_user_logged_in: true,
                    },
                );
                web.clear_cookies();
                web.save_cookies(db);
                self.auto_login_throttle.reset_all();
                snapshot
            }
            LoginSessionEnd::Invalidated { .. } => {
                clear_auth_cookies_and_save(web, db);
                record_logout(
                    config,
                    web,
                    LogoutRecordInput {
                        user_id: request.user_id.clone(),
                        clear_last_user_logged_in: false,
                    },
                )
            }
        };
        let reason = match request.kind {
            LoginSessionEnd::Logout => "User logged out.",
            LoginSessionEnd::Invalidated { .. } => "VRChat session was invalidated.",
        };
        transition(LoginRuntimeTransition::Unauthenticated(reason.into()))
            .map_err(Error::Custom)?;
        result.map(Some)
    }

    #[cfg(test)]
    pub fn state(&self) -> LoginSessionState {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.active.as_ref().map(ActiveChallenge::state))
            .unwrap_or(LoginSessionState::Cancelled)
    }

    pub async fn start(
        &self,
        web: Arc<WebClient>,
        db: Arc<DatabaseService>,
        config: &ConfigRepository,
        input: LoginSessionStartInput,
        transition: &TransitionSink<'_>,
    ) -> LoginSessionState {
        let api = Self::login_api(&web, &db);
        self.start_with_transition(api, web.as_ref(), db.as_ref(), config, input, transition)
            .await
    }

    #[cfg(test)]
    pub(super) async fn start_with(
        &self,
        api: Arc<dyn LoginApi>,
        web: &WebClient,
        db: &DatabaseService,
        config: &ConfigRepository,
        input: LoginSessionStartInput,
    ) -> LoginSessionState {
        self.start_with_transition(api, web, db, config, input, &|_| Ok(()))
            .await
    }

    pub(super) async fn start_with_transition(
        &self,
        api: Arc<dyn LoginApi>,
        web: &WebClient,
        db: &DatabaseService,
        config: &ConfigRepository,
        input: LoginSessionStartInput,
        transition: &TransitionSink<'_>,
    ) -> LoginSessionState {
        let operation = match self.begin_operation(transition) {
            Ok(operation) => operation,
            Err(error) => return transition_failure(error),
        };
        let _network = match self.acquire_network(&operation).await {
            Ok(guard) => guard,
            Err(error) => return transition_failure(error),
        };
        let (state, endpoint, policy) = match input {
            LoginSessionStartInput::Basic {
                username,
                password,
                save_credentials,
            } => {
                let endpoint = VRCHAT_API_DEFAULT_ENDPOINT.to_string();
                clear_auth_cookies_and_save(web, db);
                let login_params = json!({
                    "username": username,
                    "password": password,
                });
                let state =
                    start_gui_basic_login(api.as_ref(), &endpoint, username, password).await;
                (
                    state,
                    endpoint,
                    LoginAttemptPolicy::Basic {
                        login_params,
                        save_credentials,
                    },
                )
            }
            LoginSessionStartInput::SavedCredential { user_id } => {
                let endpoint = VRCHAT_API_DEFAULT_ENDPOINT.to_string();
                let state = start_saved_credential_login(
                    api.as_ref(),
                    config,
                    web,
                    endpoint.clone(),
                    user_id.clone(),
                )
                .await;
                (
                    state,
                    endpoint,
                    LoginAttemptPolicy::SavedCredential { user_id },
                )
            }
        };
        self.install_state(
            &operation,
            state,
            api,
            endpoint,
            policy,
            LoginRuntimeDeps {
                web,
                db,
                config,
                transition,
            },
        )
        .unwrap_or(LoginSessionState::Cancelled)
    }

    #[cfg(test)]
    pub async fn respond(
        &self,
        input: LoginSessionRespondInput,
        web: &WebClient,
        db: &DatabaseService,
        config: &ConfigRepository,
    ) -> LoginSessionState {
        self.respond_and_transition(input, web, db, config, &|_| Ok(()))
            .await
    }

    pub async fn respond_and_transition(
        &self,
        input: LoginSessionRespondInput,
        web: &WebClient,
        db: &DatabaseService,
        config: &ConfigRepository,
        transition: &TransitionSink<'_>,
    ) -> LoginSessionState {
        let (operation, active) = match self.take_active(&input.attempt_id) {
            Ok(active) => active,
            Err(state) => return *state,
        };
        let _network = match self.acquire_network(&operation).await {
            Ok(guard) => guard,
            Err(_) => return LoginSessionState::Cancelled,
        };
        let state = respond_to_challenge(
            active.api.as_ref(),
            &active.endpoint,
            active.methods,
            active.mode,
            input.method,
            input.code,
        )
        .await;
        self.install_state(
            &operation,
            state,
            active.api,
            active.endpoint,
            active.policy,
            LoginRuntimeDeps {
                web,
                db,
                config,
                transition,
            },
        )
        .unwrap_or(LoginSessionState::Cancelled)
    }

    pub async fn cancel(
        &self,
        attempt_id: String,
        web: &WebClient,
        db: &DatabaseService,
        transition: &TransitionSink<'_>,
    ) -> LoginSessionState {
        let operation = {
            let Ok(mut inner) = self.inner.lock() else {
                return LoginSessionState::Cancelled;
            };
            let matches_active = inner
                .active
                .as_ref()
                .is_some_and(|active| active.attempt_id == attempt_id && !attempt_id.is_empty());
            let matches_inflight = inner.inflight_attempt_id.as_deref() == Some(&attempt_id);
            if !matches_active && !matches_inflight {
                return inner
                    .active
                    .as_ref()
                    .map(ActiveChallenge::state)
                    .unwrap_or(LoginSessionState::Cancelled);
            }
            inner.generation = inner.generation.wrapping_add(1);
            inner.active = None;
            inner.inflight_attempt_id = None;
            LoginSessionOperation {
                inner: Arc::clone(&self.inner),
                generation: inner.generation,
                attempt_id: inner.generation.to_string(),
            }
        };
        let _network = match self.acquire_network(&operation).await {
            Ok(guard) => guard,
            Err(_) => return LoginSessionState::Cancelled,
        };
        let Ok(current) = self.inner.lock() else {
            return LoginSessionState::Cancelled;
        };
        if current.generation != operation.generation {
            return LoginSessionState::Cancelled;
        }
        clear_auth_cookies_and_save(web, db);
        let _ = transition(LoginRuntimeTransition::Unauthenticated(
            "Frontend login was cancelled.".into(),
        ));
        LoginSessionState::Cancelled
    }

    pub(super) fn begin_operation(
        &self,
        transition: &TransitionSink<'_>,
    ) -> crate::Result<LoginSessionOperation> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| Error::Custom("Login session state is unavailable.".into()))?;
        inner.generation = inner.generation.wrapping_add(1);
        inner.active = None;
        inner.inflight_attempt_id = None;
        transition(LoginRuntimeTransition::Authenticating).map_err(Error::Custom)?;
        Ok(LoginSessionOperation {
            inner: Arc::clone(&self.inner),
            generation: inner.generation,
            attempt_id: inner.generation.to_string(),
        })
    }

    async fn acquire_network(
        &self,
        operation: &LoginSessionOperation,
    ) -> crate::Result<OwnedMutexGuard<()>> {
        let guard = Arc::clone(&self.network_gate).lock_owned().await;
        operation.ensure_current()?;
        Ok(guard)
    }

    fn take_active(
        &self,
        attempt_id: &str,
    ) -> Result<(LoginSessionOperation, ActiveChallenge), Box<LoginSessionState>> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| Box::new(LoginSessionState::Cancelled))?;
        let Some(active) = inner.active.as_ref() else {
            return Err(Box::new(LoginSessionState::Cancelled));
        };
        if attempt_id.is_empty() || active.attempt_id != attempt_id {
            return Err(Box::new(active.state()));
        }
        let active = inner.active.take().expect("active session was checked");
        inner.inflight_attempt_id = Some(attempt_id.to_string());
        let operation = LoginSessionOperation {
            inner: Arc::clone(&self.inner),
            generation: active.generation,
            attempt_id: attempt_id.to_string(),
        };
        Ok((operation, active))
    }

    fn install_state(
        &self,
        operation: &LoginSessionOperation,
        state: LoginSessionState,
        api: Arc<dyn LoginApi>,
        endpoint: String,
        policy: LoginAttemptPolicy,
        deps: LoginRuntimeDeps<'_>,
    ) -> crate::Result<LoginSessionState> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| Error::Custom("Login session state is unavailable.".into()))?;
        if inner.generation != operation.generation {
            return Err(superseded_error());
        }
        inner.inflight_attempt_id = None;
        let state = with_attempt_id(state, &operation.attempt_id);
        let state = finalize_authenticated_state(state, &policy, deps.config, deps.web);
        let state = apply_terminal_transition(state, deps.transition);
        let state = cleanup_failed_state(state, &policy, deps.config, deps.web, deps.db);
        inner.active = match &state {
            LoginSessionState::Challenge {
                attempt_id,
                methods,
                mode,
                error,
            } => Some(ActiveChallenge {
                generation: operation.generation,
                attempt_id: attempt_id.clone(),
                api,
                endpoint,
                methods: methods.clone(),
                mode: mode.clone(),
                error: error.clone(),
                policy,
            }),
            _ => None,
        };
        Ok(state)
    }
}

fn apply_terminal_transition(
    state: LoginSessionState,
    transition: &TransitionSink<'_>,
) -> LoginSessionState {
    match &state {
        LoginSessionState::Authenticated { session, .. } => {
            match transition(LoginRuntimeTransition::Authenticated(session.clone())) {
                Ok(()) => state,
                Err(reason) => LoginSessionState::failed(reason, LoginFailureKind::Other),
            }
        }
        LoginSessionState::Failed { reason, .. } => {
            let _ = transition(LoginRuntimeTransition::Unauthenticated(reason.clone()));
            state
        }
        LoginSessionState::Cancelled => {
            let _ = transition(LoginRuntimeTransition::Unauthenticated(
                "Login session was cancelled.".into(),
            ));
            state
        }
        LoginSessionState::Challenge { .. } => state,
    }
}

fn auto_login_failure_reason(outcome: &AutoLoginOutcome) -> Option<&str> {
    match outcome {
        AutoLoginOutcome::Terminal(AutoLoginTerminalOutcome::Throttled { .. }) => {
            Some("Automatic login was throttled.")
        }
        AutoLoginOutcome::Terminal(AutoLoginTerminalOutcome::Expired { .. }) => {
            Some("The saved browser session expired.")
        }
        AutoLoginOutcome::Session(LoginSessionState::Failed { reason, .. }) => Some(reason),
        AutoLoginOutcome::Session(
            LoginSessionState::Authenticated { .. }
            | LoginSessionState::Challenge { .. }
            | LoginSessionState::Cancelled,
        ) => None,
    }
}

fn transition_failure(error: Error) -> LoginSessionState {
    LoginSessionState::failed(error.to_string(), LoginFailureKind::Other)
}

fn superseded_error() -> Error {
    Error::Custom("Login session was superseded by a newer request.".into())
}

fn finalize_authenticated_state(
    state: LoginSessionState,
    policy: &LoginAttemptPolicy,
    config: &ConfigRepository,
    web: &WebClient,
) -> LoginSessionState {
    let LoginSessionState::Authenticated { session, .. } = &state else {
        return state;
    };
    let result = match policy {
        LoginAttemptPolicy::Basic {
            login_params,
            save_credentials,
        } => record_login_success(
            config,
            web,
            LoginSuccessRecordInput {
                user: session.current_user.clone(),
                login_params: login_params.clone(),
                stored_login_params: None,
                save_credentials: *save_credentials,
            },
        ),
        LoginAttemptPolicy::SavedCredential { .. } => record_login_success(
            config,
            web,
            LoginSuccessRecordInput {
                user: session.current_user.clone(),
                login_params: Value::Null,
                stored_login_params: None,
                save_credentials: false,
            },
        ),
    };
    match result {
        Ok(snapshot) => LoginSessionState::Authenticated {
            session: session.clone(),
            snapshot: Some(Box::new(snapshot)),
        },
        Err(error) => LoginSessionState::failed(error.to_string(), LoginFailureKind::Other),
    }
}

fn cleanup_failed_state(
    state: LoginSessionState,
    policy: &LoginAttemptPolicy,
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
) -> LoginSessionState {
    let LoginSessionState::Failed { reason, kind, .. } = state else {
        return state;
    };
    match apply_login_failure_cleanup(web, db, config, policy, kind) {
        Ok(snapshot) => LoginSessionState::Failed {
            reason,
            kind,
            snapshot: Some(Box::new(snapshot)),
        },
        Err(error) => LoginSessionState::Failed {
            reason: error.to_string(),
            kind: LoginFailureKind::Other,
            snapshot: saved_snapshot(config).ok().map(Box::new),
        },
    }
}

fn with_attempt_id(state: LoginSessionState, attempt_id: &str) -> LoginSessionState {
    match state {
        LoginSessionState::Challenge {
            methods,
            mode,
            error,
            ..
        } => LoginSessionState::Challenge {
            attempt_id: attempt_id.to_string(),
            methods,
            mode,
            error,
        },
        state => state,
    }
}

fn auto_login_outcome_from_state(
    state: LoginSessionState,
    config: &ConfigRepository,
) -> crate::Result<AutoLoginOutcome> {
    match state {
        LoginSessionState::Authenticated { session, snapshot } => {
            let snapshot = snapshot
                .ok_or_else(|| Error::Custom("Authenticated login snapshot is missing.".into()))?;
            Ok(AutoLoginOutcome::Session(
                LoginSessionState::Authenticated {
                    session,
                    snapshot: Some(snapshot),
                },
            ))
        }
        state @ LoginSessionState::Challenge { .. } => Ok(AutoLoginOutcome::Session(state)),
        LoginSessionState::Failed {
            reason,
            kind,
            snapshot,
        } => {
            let snapshot = match snapshot {
                Some(snapshot) => snapshot,
                None => Box::new(saved_snapshot(config)?),
            };
            Ok(AutoLoginOutcome::Session(LoginSessionState::Failed {
                reason,
                kind,
                snapshot: Some(snapshot),
            }))
        }
        LoginSessionState::Cancelled => Ok(AutoLoginOutcome::Session(LoginSessionState::Failed {
            reason: "The login session was cancelled.".into(),
            kind: LoginFailureKind::Other,
            snapshot: Some(Box::new(saved_snapshot(config)?)),
        })),
    }
}

pub(super) fn apply_login_failure_cleanup(
    web: &WebClient,
    db: &DatabaseService,
    config: &ConfigRepository,
    policy: &LoginAttemptPolicy,
    kind: LoginFailureKind,
) -> crate::Result<SavedAuthSnapshot> {
    let LoginAttemptPolicy::SavedCredential { user_id } = policy else {
        clear_auth_cookies_and_save(web, db);
        return saved_snapshot(config);
    };

    if kind == LoginFailureKind::InvalidCredentials {
        web.clear_cookies();
        web.save_cookies(db);
        return if user_id.trim().is_empty() {
            saved_snapshot(config)
        } else {
            delete_saved_credential(config, user_id.clone())
        };
    }

    clear_auth_cookies_and_save(web, db);
    match kind {
        LoginFailureKind::SessionInvalidated | LoginFailureKind::MissingCredentials => {
            clear_last_login_target(config, web, user_id.trim().to_string())
        }
        LoginFailureKind::InvalidCredentials => unreachable!(),
        LoginFailureKind::TwoFactorUnavailable
        | LoginFailureKind::Network
        | LoginFailureKind::Other => saved_snapshot(config),
    }
}

pub(super) fn clear_auth_cookies_and_save(web: &WebClient, db: &DatabaseService) {
    web.clear_auth_cookies();
    web.save_cookies(db);
}

fn clear_last_login_target(
    config: &ConfigRepository,
    web: &WebClient,
    user_id: String,
) -> crate::Result<SavedAuthSnapshot> {
    record_logout(
        config,
        web,
        LogoutRecordInput {
            user_id,
            clear_last_user_logged_in: true,
        },
    )
}
