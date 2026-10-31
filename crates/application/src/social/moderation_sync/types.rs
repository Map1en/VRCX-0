use crate::remote::VrchatRequestPort;
use serde::{Deserialize, Serialize};
use vrcx_0_application_core::RemoteMutationGate;
use vrcx_0_application_core::{vrchat_api::VrchatApiRequest, Result, RuntimeAuthScope};
pub use vrcx_0_contracts::local_moderation::{
    LocalModerationInput, LocalModerationOutput, RemoteModerationInput,
};
use vrcx_0_core::text::normalize_text;
use vrcx_0_core::OwnerId;

pub struct ModerationSyncDeps<'a> {
    pub(crate) store: &'a dyn ModerationSyncStore,
    pub(crate) remote_requests: &'a dyn ModerationSyncRemoteRequests,
    pub(crate) remote: &'a dyn VrchatRequestPort,
    pub auth_scope: &'a RuntimeAuthScope,
    pub remote_mutations: &'a RemoteMutationGate,
}

impl<'a> ModerationSyncDeps<'a> {
    pub fn new(
        store: &'a dyn ModerationSyncStore,
        remote_requests: &'a dyn ModerationSyncRemoteRequests,
        remote: &'a dyn VrchatRequestPort,
        auth_scope: &'a RuntimeAuthScope,
        remote_mutations: &'a RemoteMutationGate,
    ) -> Self {
        Self {
            store,
            remote_requests,
            remote,
            auth_scope,
            remote_mutations,
        }
    }
}

pub trait ModerationSyncStore: Send + Sync {
    fn sync_snapshot(
        &self,
        owner: OwnerId,
        rows: Vec<RemoteModerationInput>,
    ) -> Result<Vec<LocalModerationOutput>>;
    fn get(&self, owner: OwnerId, user_id: String) -> Result<Option<LocalModerationOutput>>;
    fn set(&self, owner: OwnerId, entry: LocalModerationInput) -> Result<()>;
    fn delete(&self, owner: OwnerId, user_id: String) -> Result<()>;
}

pub trait ModerationSyncRemoteRequests: Send + Sync {
    fn list(&self, endpoint: String) -> Result<VrchatApiRequest>;
    fn update(
        &self,
        endpoint: String,
        enabled: bool,
        target_user_id: String,
        moderation_type: String,
    ) -> Result<VrchatApiRequest>;
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModerationSyncRefreshInput {
    pub user_id: String,
    #[serde(default)]
    pub endpoint: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(from = "String")]
pub(super) enum ModerationMutationType {
    Block,
    Mute,
    InteractOff,
    MuteChat,
    Unknown(String),
}

impl ModerationMutationType {
    pub(super) fn as_str(&self) -> &str {
        match self {
            Self::Block => "block",
            Self::Mute => "mute",
            Self::InteractOff => "interactOff",
            Self::MuteChat => "muteChat",
            Self::Unknown(value) => value,
        }
    }

    pub(super) fn is_supported_enable(&self) -> bool {
        !matches!(self, Self::Unknown(_))
    }
}

impl From<String> for ModerationMutationType {
    fn from(value: String) -> Self {
        let value = normalize_text(value);
        match value.as_str() {
            "block" => Self::Block,
            "mute" => Self::Mute,
            "interactOff" => Self::InteractOff,
            "muteChat" => Self::MuteChat,
            _ => Self::Unknown(value),
        }
    }
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModerationSyncMutationInput {
    pub(super) target_user_id: String,
    #[serde(default)]
    pub(super) target_display_name: String,
    #[specta(type = String)]
    pub(super) r#type: ModerationMutationType,
    pub(super) enabled: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModerationSyncRefreshOutput {
    pub accepted: bool,
    pub user_id: String,
    pub remote_count: u32,
    pub local_count: u32,
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
    pub owner_user_id: OwnerId,
    pub target_user_id: String,
    pub r#type: String,
    pub enabled: bool,
    pub local: Option<LocalModerationOutput>,
}
