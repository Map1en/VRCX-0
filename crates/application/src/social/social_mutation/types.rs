use std::sync::Arc;

use serde::{Deserialize, Serialize};
use vrcx_0_contracts::friend_log::{
    FriendLogCurrentEntryInput, FriendLogDeleteOptionsInput, FriendLogHistoryEntryInput,
    FriendLogMutationResult, FriendLogUpsertOptionsInput,
};

use crate::remote::VrchatRequestPort;
use vrcx_0_application_core::{Result, RuntimeAuthScope};
use vrcx_0_application_realtime::{RealtimeHostRuntime, RealtimeStore};
use vrcx_0_contracts::vrchat_api::VrchatRequest;

pub trait SocialMutationStore: Send + Sync {
    fn delete_current_friend(
        &self,
        owner_user_id: &str,
        target_user_ids: Vec<String>,
        options: FriendLogDeleteOptionsInput,
    ) -> Result<FriendLogMutationResult>;
    fn upsert_current_friend(
        &self,
        owner_user_id: &str,
        entry: FriendLogCurrentEntryInput,
        options: FriendLogUpsertOptionsInput,
    ) -> Result<FriendLogMutationResult>;
    fn add_friend_history(
        &self,
        owner_user_id: &str,
        entries: Vec<FriendLogHistoryEntryInput>,
    ) -> Result<i64>;
    fn expire_notification(&self, owner_user_id: &str, notification_id: &str) -> Result<()>;
}

pub trait SocialMutationRemoteRequests: Send + Sync {
    fn unfriend(&self, endpoint: String, target_user_id: String) -> Result<VrchatRequest>;
    fn send_friend_request(
        &self,
        endpoint: String,
        target_user_id: String,
    ) -> Result<VrchatRequest>;
    fn cancel_friend_request(
        &self,
        endpoint: String,
        target_user_id: String,
        notification_id: String,
    ) -> Result<VrchatRequest>;
    fn accept_friend_request(
        &self,
        endpoint: String,
        notification_id: String,
    ) -> Result<VrchatRequest>;
}

#[cfg(any(test, feature = "test-utils"))]
#[derive(Clone, Copy, Default)]
pub struct TestSocialMutationRemoteRequests;

#[cfg(any(test, feature = "test-utils"))]
impl SocialMutationRemoteRequests for TestSocialMutationRemoteRequests {
    fn unfriend(&self, endpoint: String, target_user_id: String) -> Result<VrchatRequest> {
        Ok(test_remote_request(
            endpoint,
            "DELETE",
            format!("auth/user/friends/{target_user_id}"),
        ))
    }

    fn send_friend_request(
        &self,
        endpoint: String,
        target_user_id: String,
    ) -> Result<VrchatRequest> {
        Ok(test_remote_request(
            endpoint,
            "POST",
            format!("user/{target_user_id}/friendRequest"),
        ))
    }

    fn cancel_friend_request(
        &self,
        endpoint: String,
        target_user_id: String,
        _notification_id: String,
    ) -> Result<VrchatRequest> {
        Ok(test_remote_request(
            endpoint,
            "DELETE",
            format!("user/{target_user_id}/friendRequest"),
        ))
    }

    fn accept_friend_request(
        &self,
        endpoint: String,
        notification_id: String,
    ) -> Result<VrchatRequest> {
        Ok(test_remote_request(
            endpoint,
            "PUT",
            format!("auth/user/notifications/{notification_id}/accept"),
        ))
    }
}

#[cfg(any(test, feature = "test-utils"))]
fn test_remote_request(endpoint: String, method: &str, path: String) -> VrchatRequest {
    VrchatRequest {
        endpoint: Some(endpoint),
        method: Some(method.to_string()),
        path: Some(path),
        ..Default::default()
    }
}

impl<T> SocialMutationStore for T
where
    T: RealtimeStore + ?Sized,
{
    fn delete_current_friend(
        &self,
        owner_user_id: &str,
        target_user_ids: Vec<String>,
        options: FriendLogDeleteOptionsInput,
    ) -> Result<FriendLogMutationResult> {
        self.friend_log_delete_current(owner_user_id, target_user_ids, options)
    }

    fn upsert_current_friend(
        &self,
        owner_user_id: &str,
        entry: FriendLogCurrentEntryInput,
        options: FriendLogUpsertOptionsInput,
    ) -> Result<FriendLogMutationResult> {
        self.friend_log_upsert_current(owner_user_id, entry, options)
    }

    fn add_friend_history(
        &self,
        owner_user_id: &str,
        entries: Vec<FriendLogHistoryEntryInput>,
    ) -> Result<i64> {
        self.friend_log_history_add(owner_user_id, entries)
    }

    fn expire_notification(&self, owner_user_id: &str, notification_id: &str) -> Result<()> {
        self.notification_expire(owner_user_id, notification_id)
    }
}

#[derive(Clone, Copy)]
pub struct SocialMutationDeps<'a> {
    pub(crate) store: &'a dyn SocialMutationStore,
    pub(crate) remote_requests: &'a dyn SocialMutationRemoteRequests,
    pub(crate) remote: &'a dyn VrchatRequestPort,
    pub auth_scope: &'a RuntimeAuthScope,
    pub remote_mutations: &'a vrcx_0_application_core::RemoteMutationGate,
    pub realtime: &'a Arc<RealtimeHostRuntime>,
}

impl<'a> SocialMutationDeps<'a> {
    pub fn new(
        store: &'a dyn SocialMutationStore,
        remote_requests: &'a dyn SocialMutationRemoteRequests,
        remote: &'a dyn VrchatRequestPort,
        auth_scope: &'a RuntimeAuthScope,
        remote_mutations: &'a vrcx_0_application_core::RemoteMutationGate,
        realtime: &'a Arc<RealtimeHostRuntime>,
    ) -> Self {
        Self {
            store,
            remote_requests,
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
