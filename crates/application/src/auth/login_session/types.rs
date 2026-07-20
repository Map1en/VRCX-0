use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::Serialize;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{ApiScope, HttpApiExecuteResponse, HttpApiRequestInput};

use crate::{AuthenticatedRuntimeSession, Result, SavedAuthSnapshot, WebClient};

pub type TwoFactorMethod = String;

pub(crate) type LoginApiFuture<'a> =
    Pin<Box<dyn Future<Output = Result<HttpApiExecuteResponse>> + Send + 'a>>;

pub(crate) trait LoginApi: Send + Sync {
    fn execute<'a>(&'a self, input: HttpApiRequestInput, scope: ApiScope) -> LoginApiFuture<'a>;
}

pub(crate) struct WebClientLoginApi {
    web: Arc<WebClient>,
    db: Arc<DatabaseService>,
}

impl WebClientLoginApi {
    pub(crate) fn new(web: Arc<WebClient>, db: Arc<DatabaseService>) -> Self {
        Self { web, db }
    }
}

impl LoginApi for WebClientLoginApi {
    fn execute<'a>(&'a self, input: HttpApiRequestInput, scope: ApiScope) -> LoginApiFuture<'a> {
        Box::pin(async move { self.web.execute_api(input, scope, self.db.as_ref()).await })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LoginFailureKind {
    InvalidCredentials,
    MissingCredentials,
    SessionInvalidated,
    TwoFactorUnavailable,
    Network,
    Other,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LoginSessionState {
    Authenticated {
        session: AuthenticatedRuntimeSession,
        #[serde(skip_serializing_if = "Option::is_none")]
        snapshot: Option<Box<SavedAuthSnapshot>>,
    },
    Challenge {
        #[serde(rename = "attemptId")]
        attempt_id: String,
        methods: Vec<TwoFactorMethod>,
        mode: TwoFactorMethod,
        error: Option<String>,
    },
    Failed {
        reason: String,
        kind: LoginFailureKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        snapshot: Option<Box<SavedAuthSnapshot>>,
    },
    Cancelled,
}

impl LoginSessionState {
    pub(super) fn failed(reason: impl Into<String>, kind: LoginFailureKind) -> Self {
        Self::Failed {
            reason: reason.into(),
            kind,
            snapshot: None,
        }
    }
}
