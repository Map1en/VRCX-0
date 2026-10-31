use futures_util::future::BoxFuture;

use serde::Serialize;
use vrcx_0_application_core::vrchat_api::VrchatApiResponse as HttpApiExecuteResponse;
use vrcx_0_contracts::vrchat_login::VrchatLoginFailureKind;
pub use vrcx_0_core::TwoFactorMethod;

use crate::auth::{AuthenticatedRuntimeSession, SavedAuthSnapshot};
use vrcx_0_application_core::Result;

pub type LoginApiFuture<'a> = BoxFuture<'a, Result<HttpApiExecuteResponse>>;

pub enum LoginRemoteOperation {
    Config {
        endpoint: String,
    },
    CurrentUser {
        endpoint: String,
    },
    BasicLogin {
        endpoint: String,
        username: String,
        password: String,
    },
    VerifyTotp {
        endpoint: String,
        code: String,
    },
    VerifyEmailOtp {
        endpoint: String,
        code: String,
    },
    VerifyOtp {
        endpoint: String,
        code: String,
    },
    DeviceCode {
        endpoint: String,
    },
    DeviceStatus {
        endpoint: String,
        device_code: String,
    },
}

pub trait LoginApi: Send + Sync {
    fn execute(&self, operation: LoginRemoteOperation) -> LoginApiFuture<'_>;
}

pub trait AuthSessionCookies: Send + Sync {
    fn get(&self) -> String;
    fn set(&self, cookies: &str) -> Result<()>;
    fn clear(&self);
    fn clear_everywhere(&self);
    fn clear_auth(&self);
    fn save(&self);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LoginFailureKind {
    InvalidCredentials,
    MissingCredentials,
    SessionInvalidated,
    TwoFactorUnavailable,
    DeviceCodeExpired,
    DeviceDenied,
    Network,
    Other,
}

impl From<VrchatLoginFailureKind> for LoginFailureKind {
    fn from(kind: VrchatLoginFailureKind) -> Self {
        match kind {
            VrchatLoginFailureKind::InvalidCredentials => Self::InvalidCredentials,
            VrchatLoginFailureKind::MissingCredentials => Self::MissingCredentials,
            VrchatLoginFailureKind::SessionInvalidated => Self::SessionInvalidated,
            VrchatLoginFailureKind::TwoFactorUnavailable => Self::TwoFactorUnavailable,
            VrchatLoginFailureKind::Other => Self::Other,
        }
    }
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
        #[specta(type = Vec<String>)]
        methods: Vec<TwoFactorMethod>,
        #[specta(type = String)]
        mode: TwoFactorMethod,
        error: Option<String>,
    },
    DeviceApproval {
        #[serde(rename = "attemptId")]
        attempt_id: String,
        #[serde(rename = "verificationUrl")]
        verification_url: String,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
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
