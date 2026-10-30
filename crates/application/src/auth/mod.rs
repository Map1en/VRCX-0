mod auth_credentials;
mod authenticated_session_maintenance;
mod authenticated_session_storage;
mod background_auth_recovery;
mod cookie_session;
mod device_authorization;
mod login_session;
mod noninteractive_auth;
mod privacy_lock;
mod runtime_phase;
mod session_projection;
#[cfg(test)]
mod test_support;
mod vrchat_config;

pub use auth_credentials::{
    clear_saved_password, delete_saved_credential, migrate_saved_credential_secrets,
    record_login_success, record_logout, saved_credential_login_start,
    saved_credential_session_data, saved_login_credentials, saved_snapshot, AuthCredentialStore,
    LoginSuccessRecordInput, LogoutRecordInput, SavedAuthAutoLoginStatus, SavedAuthSnapshot,
    SavedCredentialLoginStartInput, SavedCredentialRecordMode, SavedCredentialSessionData,
    SavedCredentialSnapshot, SavedCredentialUser, SavedLoginCredentials, SavedLoginParamsSnapshot,
    SealedAuthSecret,
};
pub use authenticated_session_maintenance::{
    run_authenticated_session_maintenance, AuthenticatedSessionMaintenance,
    AuthenticatedSessionMaintenanceRuntime,
};
pub use authenticated_session_storage::{
    initialize_authenticated_session_storage, AuthenticatedSessionStorage,
};
pub use background_auth_recovery::{
    invalidate_background_auth_scope, BackgroundAuthRecoveryActions, BackgroundAuthRecoveryContext,
    BackgroundAuthRecoveryFuture, BackgroundAuthRecoveryOrchestrator,
};
pub use device_authorization::{wait_for_device_approval, DeviceApprovalOutcome};
pub use login_session::{
    AuthSessionCookies, AutoLoginOutcome, AutoLoginStartInput, AutoLoginTerminalOutcome, LoginApi,
    LoginApiFuture, LoginFailureKind, LoginRemoteOperation, LoginRuntimeTransition,
    LoginSessionCancelInput, LoginSessionEnd, LoginSessionEndRequest, LoginSessionRespondInput,
    LoginSessionRuntime, LoginSessionStartInput, LoginSessionState, TwoFactorMethod,
};
pub use noninteractive_auth::{
    current_user_from_cookie, parse_current_user_response, probe_current_user_from_cookie,
    probe_saved_current_user_from_cookie, AuthenticatedRuntimeSession, CookieSessionProbe,
    NonInteractiveAuthActions, NonInteractiveAuthError, NonInteractiveAuthProbeFuture,
    NonInteractiveAuthResponseFuture, NonInteractiveAuthRuntime,
};
pub use privacy_lock::{
    verify_saved_account_password, PrivacyLockPasswordCheck, PrivacyLockRecord, PrivacyLockStore,
};
pub use runtime_phase::{
    AuthenticatedRuntimePhase, AuthenticatedRuntimePhaseSnapshot,
    AuthenticatedRuntimeRealtimeHealth, AuthenticatedRuntimeStepSnapshot,
    AuthenticatedRuntimeStepStatus,
};
pub use session_projection::{
    authenticated_session_projection_matches, clear_authenticated_session_projection,
    establish_authenticated_session_projection,
    replace_authenticated_session_user_if_session_matches, AuthenticatedSessionProjection,
    AuthenticatedSessionSnapshot,
};
pub use vrchat_config::{VrchatConfigFuture, VrchatConfigPort, VrchatConfigRuntime};
