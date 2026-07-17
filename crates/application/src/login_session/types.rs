use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::Serialize;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{ApiScope, HttpApiExecuteResponse, HttpApiRequestInput};

use crate::{AuthenticatedRuntimeSession, Result, WebClient};

pub type TwoFactorMethod = String;

pub type LoginApiFuture<'a> =
    Pin<Box<dyn Future<Output = Result<HttpApiExecuteResponse>> + Send + 'a>>;

pub trait LoginApi: Send + Sync {
    fn execute<'a>(&'a self, input: HttpApiRequestInput, scope: ApiScope) -> LoginApiFuture<'a>;
}

pub struct WebClientLoginApi {
    web: Arc<WebClient>,
    db: Arc<DatabaseService>,
}

impl WebClientLoginApi {
    pub fn new(web: Arc<WebClient>, db: Arc<DatabaseService>) -> Self {
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
    },
    Challenge {
        methods: Vec<TwoFactorMethod>,
        mode: TwoFactorMethod,
        error: Option<String>,
    },
    Failed {
        reason: String,
        kind: LoginFailureKind,
    },
    Cancelled,
}
