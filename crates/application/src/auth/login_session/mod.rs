mod auto_login;
mod runtime;
mod service;
mod types;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
#[cfg(test)]
use service::sort_two_factor_methods;

pub use auto_login::{AutoLoginOutcome, AutoLoginStartInput};
pub use runtime::{
    LoginSessionRuntime, LoginSessionStartBasicInput, LoginSessionStartCookieRestoreInput,
    LoginSessionStartSavedCredentialInput,
};
pub use service::LoginSession;
pub use types::{
    LoginApi, LoginApiFuture, LoginFailureKind, LoginSessionState, TwoFactorMethod,
    WebClientLoginApi,
};
