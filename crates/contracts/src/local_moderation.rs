use serde::Serialize;

#[derive(Clone, Debug)]
pub struct LocalModerationInput {
    pub user_id: String,
    pub updated_at: String,
    pub display_name: String,
    pub block: bool,
    pub mute: bool,
}

#[derive(Clone, Debug)]
pub struct RemoteModerationInput {
    pub r#type: String,
    pub target_user_id: String,
    pub target_display_name: String,
    pub created: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalModerationOutput {
    pub user_id: String,
    pub updated_at: String,
    pub display_name: String,
    pub block: bool,
    pub mute: bool,
}
