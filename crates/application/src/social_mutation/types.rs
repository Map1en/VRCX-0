use std::sync::Arc;

use serde::{Deserialize, Serialize};
use vrcx_0_persistence::DatabaseService;

use crate::auth_scope::RuntimeAuthScope;
use crate::realtime::RealtimeHostRuntime;
use crate::web_client::WebClient;

pub struct SocialMutationDeps<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub auth_scope: &'a RuntimeAuthScope,
    pub realtime: &'a Arc<RealtimeHostRuntime>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendMutationInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    pub target_user_id: String,
    #[serde(default)]
    pub target_display_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRequestCancelInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    pub target_user_id: String,
    #[serde(default)]
    pub target_display_name: String,
    #[serde(default)]
    pub notification_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRequestAcceptInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    pub notification_id: String,
    pub target_user_id: String,
    #[serde(default)]
    pub target_display_name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SocialFriendMutationStatus {
    Applied,
    RemoteOkLocalFailed,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendMutationOutcome {
    pub status: SocialFriendMutationStatus,
    pub target_user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_error: Option<String>,
}

impl SocialFriendMutationOutcome {
    pub(super) fn applied(target_user_id: &str) -> Self {
        Self {
            status: SocialFriendMutationStatus::Applied,
            target_user_id: target_user_id.to_string(),
            local_error: None,
        }
    }

    pub(super) fn remote_ok_local_failed(target_user_id: &str, error: impl ToString) -> Self {
        Self {
            status: SocialFriendMutationStatus::RemoteOkLocalFailed,
            target_user_id: target_user_id.to_string(),
            local_error: Some(error.to_string()),
        }
    }
}
