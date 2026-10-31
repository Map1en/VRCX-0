use serde::{Deserialize, Serialize};
use vrcx_0_core::json::RawJson;

use crate::remote::VrchatRequestPort;
use vrcx_0_application_core::{vrchat_api::VrchatApiRequest, Result, RuntimeAuthScope};
pub use vrcx_0_contracts::mutual_graph::{
    MutualGraphLinkOutput, MutualGraphMetaInput, MutualGraphMetaOutput,
    MutualGraphSnapshotEntryInput, MutualGraphSnapshotOutput,
};
use vrcx_0_core::OwnerId;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphFetchStartInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub friend_ids: Vec<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphFetchCancelInput {
    #[serde(default)]
    pub owner_user_id: OwnerId,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphFetchStatus {
    pub run_id: u64,
    pub revision: u64,
    pub status: MutualGraphFetchState,
    pub owner_user_id: OwnerId,
    pub total_friends: u32,
    pub processed_friends: u32,
    pub current_friend_id: String,
    pub fetched_friends: u32,
    pub opted_out_friends: u32,
    pub failed_friends: u32,
    pub cancel_requested: bool,
    pub started_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MutualGraphFetchState {
    Idle,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Error,
}

impl MutualGraphFetchState {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Running | Self::Cancelling)
    }
}

#[derive(Clone, Copy)]
pub struct MutualGraphRequestDeps<'a> {
    pub(crate) store: &'a dyn MutualGraphStore,
    pub(crate) remote_requests: &'a dyn MutualGraphRemoteRequests,
    pub(crate) remote: &'a dyn VrchatRequestPort,
    pub auth_scope: &'a RuntimeAuthScope,
}

impl<'a> MutualGraphRequestDeps<'a> {
    pub fn new(
        store: &'a dyn MutualGraphStore,
        remote_requests: &'a dyn MutualGraphRemoteRequests,
        remote: &'a dyn VrchatRequestPort,
        auth_scope: &'a RuntimeAuthScope,
    ) -> Self {
        Self {
            store,
            remote_requests,
            remote,
            auth_scope,
        }
    }
}

pub trait MutualGraphStore: Send + Sync {
    fn friend_refresh_commit(
        &self,
        owner_user_id: String,
        friend_id: String,
        mutual_ids: Option<Vec<String>>,
        total_count: Option<usize>,
        opted_out: bool,
    ) -> Result<()>;
    fn snapshot_get(&self, owner_user_id: String) -> Result<MutualGraphSnapshotOutput>;
    fn snapshot_commit(
        &self,
        owner_user_id: String,
        entries: Vec<MutualGraphSnapshotEntryInput>,
        meta: Vec<MutualGraphMetaInput>,
    ) -> Result<()>;
}

pub trait MutualGraphRemoteRequests: Send + Sync {
    fn mutual_friends(
        &self,
        endpoint: String,
        user_id: String,
        n: i32,
        offset: i32,
    ) -> Result<VrchatApiRequest>;
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphFriendRefreshInput {
    pub owner_user_id: OwnerId,
    pub friend_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MutualGraphFriendRefreshStatus {
    Refreshed,
    OptedOut,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphFriendRefreshOutput {
    pub status: MutualGraphFriendRefreshStatus,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserMutualFriendsListInput {
    pub user_id: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserMutualFriendsListOutput {
    pub rows: Vec<RawJson>,
    pub persisted: bool,
}
