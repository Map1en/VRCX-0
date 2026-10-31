use serde::Serialize;

#[derive(Clone, Debug)]
pub struct MutualGraphSnapshotEntryInput {
    pub friend_id: String,
    pub mutual_ids: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct MutualGraphMetaInput {
    pub friend_id: String,
    pub last_fetched_at: String,
    pub opted_out: bool,
    pub total_count: Option<usize>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphLinkOutput {
    pub friend_id: String,
    pub mutual_id: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphMetaOutput {
    pub friend_id: String,
    pub last_fetched_at: String,
    pub opted_out: bool,
    pub total_count: Option<u32>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphSnapshotOutput {
    pub friend_ids: Vec<String>,
    pub links: Vec<MutualGraphLinkOutput>,
    pub meta: Vec<MutualGraphMetaOutput>,
}
