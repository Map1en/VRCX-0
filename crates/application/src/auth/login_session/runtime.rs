use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use crate::{record_login_success, Error, LoginSuccessRecordInput, WebClient};

use super::auto_login::{
    drive_auto_login, AutoLoginOutcome, AutoLoginStartInput, AutoLoginThrottle,
};
use super::service::LoginSession;
use super::types::{LoginApi, LoginFailureKind, LoginSessionState, WebClientLoginApi};

pub struct LoginSessionStartBasicInput {
    pub endpoint: String,
    pub username: String,
    pub password: String,
    pub save_credentials: bool,
}

pub struct LoginSessionStartSavedCredentialInput {
    pub endpoint: String,
    pub user_id: String,
}

pub struct LoginSessionStartCookieRestoreInput {
    pub endpoint: String,
}

#[derive(Clone)]
enum LoginSessionFinalize {
    None,
    Basic {
        login_params: Value,
        save_credentials: bool,
    },
    SavedCredential,
}

struct LoginSessionRuntimeInner {
    generation: u64,
    active: Option<ActiveLoginSession>,
}

struct ActiveLoginSession {
    generation: u64,
    session: LoginSession,
    finalize: LoginSessionFinalize,
}

#[derive(Clone)]
pub(super) struct LoginSessionOperation {
    inner: Arc<Mutex<LoginSessionRuntimeInner>>,
    generation: u64,
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
            })),
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
    ) -> crate::Result<AutoLoginOutcome> {
        let api = Self::login_api(&web, &db);
        self.auto_login_start_with(api, config, web.as_ref(), db.as_ref(), input)
            .await
    }

    pub(super) async fn auto_login_start_with(
        &self,
        api: Arc<dyn LoginApi>,
        config: &ConfigRepository,
        web: &WebClient,
        db: &DatabaseService,
        input: AutoLoginStartInput,
    ) -> crate::Result<AutoLoginOutcome> {
        let operation = self.begin_operation();
        let (session, outcome) = drive_auto_login(
            api,
            config,
            web,
            db,
            &self.auto_login_throttle,
            &operation,
            input,
        )
        .await?;
        operation.ensure_current()?;
        if let Some(session) = session {
            let finalize = if matches!(outcome, AutoLoginOutcome::Challenge { .. }) {
                LoginSessionFinalize::SavedCredential
            } else {
                LoginSessionFinalize::None
            };
            self.install(&operation, session, finalize, web, config)?;
        }
        Ok(outcome)
    }

    pub fn reset_auto_login_throttle(&self) {
        self.auto_login_throttle.reset_all();
    }

    pub fn state(&self) -> LoginSessionState {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| {
                inner
                    .active
                    .as_ref()
                    .map(|active| active.session.state().clone())
            })
            .unwrap_or(LoginSessionState::Cancelled)
    }

    pub async fn start_basic(
        &self,
        web: Arc<WebClient>,
        db: Arc<DatabaseService>,
        config: &ConfigRepository,
        input: LoginSessionStartBasicInput,
    ) -> LoginSessionState {
        let api = Self::login_api(&web, &db);
        self.start_basic_with(api, web.as_ref(), config, input)
            .await
    }

    pub(super) async fn start_basic_with(
        &self,
        api: Arc<dyn LoginApi>,
        web: &WebClient,
        config: &ConfigRepository,
        input: LoginSessionStartBasicInput,
    ) -> LoginSessionState {
        let operation = self.begin_operation();
        let login_params = json!({
            "username": input.username,
            "password": input.password,
            "endpoint": "",
            "websocket": "",
        });
        let session =
            LoginSession::start_gui_basic(api, input.endpoint, input.username, input.password)
                .await;
        self.install(
            &operation,
            session,
            LoginSessionFinalize::Basic {
                login_params,
                save_credentials: input.save_credentials,
            },
            web,
            config,
        )
        .unwrap_or(LoginSessionState::Cancelled)
    }

    pub async fn start_saved_credential(
        &self,
        web: Arc<WebClient>,
        db: Arc<DatabaseService>,
        config: &ConfigRepository,
        input: LoginSessionStartSavedCredentialInput,
    ) -> LoginSessionState {
        let operation = self.begin_operation();
        let api = Self::login_api(&web, &db);
        let session = LoginSession::start_saved_credential(
            api,
            config,
            web.as_ref(),
            input.endpoint,
            input.user_id,
        )
        .await;
        self.install(
            &operation,
            session,
            LoginSessionFinalize::SavedCredential,
            web.as_ref(),
            config,
        )
        .unwrap_or(LoginSessionState::Cancelled)
    }

    pub async fn start_cookie_restore(
        &self,
        web: Arc<WebClient>,
        db: Arc<DatabaseService>,
        config: &ConfigRepository,
        input: LoginSessionStartCookieRestoreInput,
    ) -> LoginSessionState {
        let operation = self.begin_operation();
        let api = Self::login_api(&web, &db);
        let session = LoginSession::start_cookie_restore(api, input.endpoint).await;
        self.install(
            &operation,
            session,
            LoginSessionFinalize::None,
            web.as_ref(),
            config,
        )
        .unwrap_or(LoginSessionState::Cancelled)
    }

    pub async fn respond(
        &self,
        method: String,
        code: String,
        web: &WebClient,
        config: &ConfigRepository,
    ) -> LoginSessionState {
        let Some((operation, mut session, finalize)) = self.take_active() else {
            return LoginSessionState::Cancelled;
        };
        session.respond(method, code).await;
        self.install(&operation, session, finalize, web, config)
            .unwrap_or(LoginSessionState::Cancelled)
    }

    pub fn cancel(&self) -> LoginSessionState {
        let Ok(mut inner) = self.inner.lock() else {
            return LoginSessionState::Cancelled;
        };
        inner.generation = inner.generation.wrapping_add(1);
        let generation = inner.generation;
        let Some(mut active) = inner.active.take() else {
            return LoginSessionState::Cancelled;
        };
        active.session.cancel();
        active.generation = generation;
        active.finalize = LoginSessionFinalize::None;
        let state = active.session.state().clone();
        inner.active = Some(active);
        state
    }

    pub(super) fn begin_operation(&self) -> LoginSessionOperation {
        let mut inner = self.inner.lock().unwrap();
        inner.generation = inner.generation.wrapping_add(1);
        inner.active = None;
        LoginSessionOperation {
            inner: Arc::clone(&self.inner),
            generation: inner.generation,
        }
    }

    fn take_active(&self) -> Option<(LoginSessionOperation, LoginSession, LoginSessionFinalize)> {
        let mut inner = self.inner.lock().ok()?;
        let active = inner.active.take()?;
        let operation = LoginSessionOperation {
            inner: Arc::clone(&self.inner),
            generation: active.generation,
        };
        Some((operation, active.session, active.finalize))
    }

    fn install(
        &self,
        operation: &LoginSessionOperation,
        session: LoginSession,
        finalize: LoginSessionFinalize,
        web: &WebClient,
        config: &ConfigRepository,
    ) -> crate::Result<LoginSessionState> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| Error::Custom("Login session state is unavailable.".into()))?;
        if inner.generation != operation.generation {
            return Err(superseded_error());
        }
        let state = finalize_if_authenticated(session.state().clone(), &finalize, config, web);
        inner.active = Some(ActiveLoginSession {
            generation: operation.generation,
            session,
            finalize: if matches!(state, LoginSessionState::Authenticated { .. }) {
                LoginSessionFinalize::None
            } else {
                finalize
            },
        });
        Ok(state)
    }
}

fn superseded_error() -> Error {
    Error::Custom("Login session was superseded by a newer request.".into())
}

fn finalize_if_authenticated(
    state: LoginSessionState,
    finalize: &LoginSessionFinalize,
    config: &ConfigRepository,
    web: &WebClient,
) -> LoginSessionState {
    let LoginSessionState::Authenticated { session } = &state else {
        return state;
    };

    let result = match finalize {
        LoginSessionFinalize::None => Ok(Value::Null),
        LoginSessionFinalize::Basic {
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
        LoginSessionFinalize::SavedCredential => record_login_success(
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
        Ok(_) => state,
        Err(error) => LoginSessionState::Failed {
            reason: error.to_string(),
            kind: LoginFailureKind::Other,
        },
    }
}
