mod auto_login;
mod runtime;
mod service;
mod types;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub use auto_login::{AutoLoginOutcome, AutoLoginStartInput, AutoLoginTerminalOutcome};
pub use runtime::{
    LoginRuntimeTransition, LoginSessionCancelInput, LoginSessionEnd, LoginSessionEndRequest,
    LoginSessionRespondInput, LoginSessionRuntime, LoginSessionStartInput,
};
#[cfg(test)]
pub(crate) use types::LoginApiFuture;
pub(crate) use types::{LoginApi, WebClientLoginApi};
pub use types::{LoginFailureKind, LoginSessionState, TwoFactorMethod};
