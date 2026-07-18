use serde::{Deserialize, Serialize};
use vrcx_0_persistence::local_moderation::{LocalModerationOutput, RemoteModerationInput};
use vrcx_0_persistence::DatabaseService;

use vrcx_0_application_core::{HostSessionRuntime, RuntimeAuthScope, WebClient};

pub struct ModerationSyncDeps<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub session: &'a HostSessionRuntime,
    pub auth_scope: &'a RuntimeAuthScope,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModerationSyncRefreshInput {
    pub user_id: String,
    #[serde(default)]
    pub endpoint: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModerationSyncMutationInput {
    #[serde(default)]
    pub(super) owner_user_id: String,
    #[serde(default)]
    pub(super) endpoint: String,
    pub(super) target_user_id: String,
    #[serde(default)]
    pub(super) target_display_name: String,
    pub(super) r#type: String,
    pub(super) enabled: bool,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModerationSyncRefreshOutput {
    pub accepted: bool,
    pub user_id: String,
    pub remote_count: usize,
    pub local_count: usize,
    pub rows: Vec<RemoteModerationRow>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModerationRow {
    pub(super) id: String,
    pub(super) r#type: String,
    pub(super) source_user_id: String,
    pub(super) source_display_name: String,
    pub(super) target_user_id: String,
    pub(super) target_display_name: String,
    pub(super) created: String,
}

impl RemoteModerationRow {
    pub(super) fn to_local_input(&self) -> RemoteModerationInput {
        RemoteModerationInput {
            r#type: self.r#type.clone(),
            target_user_id: self.target_user_id.clone(),
            target_display_name: self.target_display_name.clone(),
            created: self.created.clone(),
        }
    }
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModerationSyncMutationOutput {
    pub target_user_id: String,
    pub r#type: String,
    pub enabled: bool,
    pub local: Option<LocalModerationOutput>,
}
