mod compat;
mod login;
mod service;
mod snapshot;
mod storage;
mod types;

pub use login::saved_credential_login_start;
pub(crate) use login::saved_credential_login_start_with_api;
pub use service::{
    clear_saved_password, delete_saved_credential, record_login_success, record_logout,
};
pub use snapshot::saved_snapshot;
pub(crate) use storage::saved_credential_password;
pub use storage::{
    migrate_saved_credential_secrets, saved_credential_session_data, saved_login_credentials,
    AuthCredentialStore, SavedLoginCredentials, SealedAuthSecret,
};
pub use types::{
    LoginSuccessRecordInput, LogoutRecordInput, SavedAuthAutoLoginStatus, SavedAuthSnapshot,
    SavedCredentialLoginStartInput, SavedCredentialRecordMode, SavedCredentialSessionData,
    SavedCredentialSnapshot, SavedCredentialUser, SavedLoginParamsSnapshot,
};
