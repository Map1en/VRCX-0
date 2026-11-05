use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::remote::VrchatRequestPort;
use vrcx_0_application_core::RuntimeAuthScope;
use vrcx_0_application_realtime::{RealtimeHostRuntime, SocialMutationStore};

#[derive(Clone, Copy)]
pub struct SocialMutationDeps<'a> {
    pub(crate) store: &'a dyn SocialMutationStore,
    pub(crate) remote: &'a dyn VrchatRequestPort,
    pub auth_scope: &'a RuntimeAuthScope,
    pub remote_mutations: &'a vrcx_0_application_core::RemoteMutationGate,
    pub realtime: &'a Arc<RealtimeHostRuntime>,
}

impl<'a> SocialMutationDeps<'a> {
    pub fn new(
        store: &'a dyn SocialMutationStore,
        remote: &'a dyn VrchatRequestPort,
        auth_scope: &'a RuntimeAuthScope,
        remote_mutations: &'a vrcx_0_application_core::RemoteMutationGate,
        realtime: &'a Arc<RealtimeHostRuntime>,
    ) -> Self {
        Self {
            store,
            remote,
            auth_scope,
            remote_mutations,
            realtime,
        }
    }
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendMutationInput {
    pub target_user_id: String,
    #[serde(default)]
    pub target_display_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRequestCancelInput {
    pub target_user_id: String,
    #[serde(default)]
    pub target_display_name: String,
    #[serde(default)]
    pub notification_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRequestAcceptInput {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SocialFriendRequestNotificationAcceptStatus {
    Accepted,
    NotFound,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRequestNotificationAcceptOutput {
    pub status: SocialFriendRequestNotificationAcceptStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<SocialFriendMutationOutcome>,
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
