use serde::Serialize;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MemoSaveResult {
    pub entity_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserMemoOutput {
    pub user_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldMemoOutput {
    pub world_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarMemoOutput {
    pub avatar_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserNoteOutput {
    pub user_id: String,
    pub display_name: String,
    pub note: String,
    pub created_at: String,
}
