use serde_json::Value;

pub struct LoginSuccessRecordInput {
    pub user: Value,
    pub login_params: Value,
    pub stored_login_params: Option<Value>,
    pub save_credentials: bool,
}

pub struct LogoutRecordInput {
    pub user_or_user_id: Value,
    pub clear_last_user_logged_in: Option<bool>,
    pub cookies: Option<Value>,
}

pub struct SavedCredentialLoginStartInput {
    pub user_id: String,
    pub endpoint: String,
}

pub struct SavedCredentialSessionData {
    pub endpoint: String,
    pub websocket: String,
    pub cookies: Option<String>,
}
