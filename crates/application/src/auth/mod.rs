mod auth_credentials;
mod authenticated_session_maintenance;
mod cookie_session;
mod login_session;
mod noninteractive_auth;

pub use auth_credentials::{
    delete_saved_credential, migrate_saved_credential_secrets, record_login_success, record_logout,
    saved_credential_login_start, saved_credential_session_data, saved_snapshot,
    LoginSuccessRecordInput, LogoutRecordInput, SavedAuthAutoLoginStatus, SavedAuthSnapshot,
    SavedCredentialLoginStartInput, SavedCredentialSessionData, SavedCredentialSnapshot,
    SavedCredentialUser, SavedLoginParamsSnapshot,
};
pub use authenticated_session_maintenance::{
    run_authenticated_session_maintenance, AuthenticatedSessionMaintenanceOutcome,
};
pub use login_session::{
    AutoLoginOutcome, AutoLoginStartInput, AutoLoginTerminalOutcome, LoginFailureKind,
    LoginRuntimeTransition, LoginSessionCancelInput, LoginSessionEnd, LoginSessionEndRequest,
    LoginSessionRespondInput, LoginSessionRuntime, LoginSessionStartInput, LoginSessionState,
    TwoFactorMethod,
};
pub(crate) use login_session::{LoginApi, WebClientLoginApi};
pub use noninteractive_auth::{
    auth_response_error_message, current_user_from_cookie, parse_current_user_response,
    probe_current_user_from_cookie, probe_saved_current_user_from_cookie,
    AuthenticatedRuntimeSession, CookieSessionProbe, NonInteractiveAuthError,
};
