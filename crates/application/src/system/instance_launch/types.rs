use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};

use crate::Result;
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;

pub type InstanceLaunchApiFuture<'a> =
    Pin<Box<dyn Future<Output = Result<VrchatApiResponse>> + Send + 'a>>;

pub trait InstanceLaunchHttpClient: Send + Sync {
    fn instance_short_name<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
    ) -> InstanceLaunchApiFuture<'a>;

    fn self_invite<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
        short_name: &'a str,
    ) -> InstanceLaunchApiFuture<'a>;
}

pub trait InstanceLaunchPipe: Send + Sync {
    fn try_open_vrchat_launch_url(&self, launch_url: &str) -> Result<bool>;
}

pub struct InstanceLaunchDeps<'a> {
    pub api: &'a dyn InstanceLaunchHttpClient,
    pub launch_pipe: &'a dyn InstanceLaunchPipe,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceLaunchInput {
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub short_name: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub mode: InstanceLaunchMode,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InstanceLaunchMode {
    #[default]
    Auto,
    OpenOnly,
    SelfInviteOnly,
}

#[derive(Clone, Debug, Deserialize, Serialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum InstanceLaunchOutcome {
    Opened,
    SelfInvited,
    Failed { reason: String },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceActionGatesBatchInput {
    #[serde(default)]
    pub current_user_id: String,
    #[serde(default)]
    pub current_invite_location: String,
    #[serde(default)]
    pub is_game_running: bool,
    #[serde(default)]
    pub friend_user_ids: Vec<String>,
    #[serde(default)]
    pub closed_locations: Vec<String>,
    #[serde(default)]
    pub targets: Vec<InstanceActionGateTarget>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceActionGateTarget {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub state_bucket: String,
    #[serde(default)]
    pub is_current_user: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstanceActionGates {
    pub key: String,
    pub can_join: bool,
    pub can_open_in_game: bool,
    pub can_self_invite: bool,
    pub can_request_invite: bool,
    pub can_invite: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstanceActionGatesBatchOutput {
    pub targets: Vec<InstanceActionGates>,
}
