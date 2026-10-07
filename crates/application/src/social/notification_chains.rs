use futures_util::future::BoxFuture;

use vrcx_0_core::text::normalize_text;
use vrcx_0_core::NotificationKind;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vrcx_0_application_core::{Error, Result};
use vrcx_0_core::json::RawJson;
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTarget {
    pub id: String,
    #[serde(default)]
    pub version: i64,
    #[serde(rename = "type", default)]
    pub notification_type: String,
    #[serde(default)]
    pub sender_user_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationActionStatus {
    Applied,
    RemoteOkLocalFailed,
    AlreadyResolved,
    RemoteFailed,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationActionOutcome {
    pub status: NotificationActionStatus,
    pub expired_ids: Vec<String>,
    pub sent_photo: bool,
    pub remote_error: Option<String>,
    pub local_error: Option<String>,
}

impl NotificationActionOutcome {
    fn new(status: NotificationActionStatus) -> Self {
        Self {
            status,
            expired_ids: Vec::new(),
            sent_photo: false,
            remote_error: None,
            local_error: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationHideExpireInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRequestInviteAcceptInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
    #[serde(default)]
    pub instance_id: String,
    #[serde(default)]
    pub world_id: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationInstanceInviteInput {
    #[serde(default)]
    pub endpoint: String,
    pub receiver_user_id: String,
    pub instance_id: String,
    pub world_id: String,
    #[serde(default)]
    pub world_name: String,
    #[serde(default)]
    pub message_slot: Option<i32>,
    #[serde(default)]
    pub image_data: String,
    #[serde(default)]
    pub rsvp: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationInviteResponseInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
    pub response_slot: i32,
    #[serde(default)]
    pub image_data: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationBoopDismissInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub endpoint: String,
    pub sender_user_id: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationBoopReplyInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
    #[serde(default)]
    pub emoji_id: String,
    #[serde(default)]
    pub inventory_item_id: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRespondInput {
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
    #[serde(default)]
    pub response_type: String,
    #[serde(default)]
    pub response_data: RawJson,
}

#[derive(Clone, Debug)]
pub struct NotificationChainRemoteError {
    pub message: String,
    pub status: i32,
}

impl NotificationChainRemoteError {
    fn is_not_found(&self) -> bool {
        self.status == 404
    }
}

#[derive(Clone, Debug)]
pub enum NotificationChainRemoteCall {
    HideNotification(NotificationTarget),
    Respond {
        id: String,
        response_type: String,
        response_data: Value,
    },
    InviteResponse {
        id: String,
        response_slot: i32,
    },
    InviteResponsePhoto {
        id: String,
        response_slot: i32,
        image_data: String,
    },
    InviteSend {
        receiver_user_id: String,
        params: Value,
    },
    InviteSendPhoto {
        receiver_user_id: String,
        params: Value,
        image_data: String,
    },
    BoopSend {
        user_id: String,
        emoji_id: String,
        inventory_item_id: String,
    },
}

#[derive(Clone, Debug, Default)]
pub struct BoopNotificationRow {
    pub id: String,
    pub version: i64,
    pub notification_type: String,
    pub sender_user_id: String,
    pub link: String,
    pub expired: bool,
}

pub trait NotificationChainActions: Send + Sync {
    fn ensure_scope(&self, owner_user_id: &OwnerId, endpoint: &str) -> Result<()>;
    fn ensure_active_scope(&self, endpoint: &str) -> Result<()>;
    fn execute_remote(
        &self,
        call: NotificationChainRemoteCall,
    ) -> BoxFuture<'_, std::result::Result<(), NotificationChainRemoteError>>;
    fn resolve_world_name<'a>(&'a self, world_id: &'a str) -> BoxFuture<'a, Option<String>>;
    fn expire_local(&self, id: String) -> Result<()>;
    fn query_boop_rows(&self) -> Result<Vec<BoopNotificationRow>>;
    fn emit_expired(&self, expired_ids: Vec<String>);
}

fn normalize_target(mut target: NotificationTarget) -> NotificationTarget {
    target.id = target.id.trim().to_string();
    target.notification_type = target.notification_type.trim().to_string();
    target.sender_user_id = target.sender_user_id.trim().to_string();
    target
}

pub fn boop_rows_matching(
    rows: Vec<BoopNotificationRow>,
    sender_user_id: &str,
) -> Vec<BoopNotificationRow> {
    let link = format!("user:{sender_user_id}");
    rows.into_iter()
        .filter(|row| {
            NotificationKind::from(row.notification_type.as_str()) == NotificationKind::Boop
                && !row.expired
                && row.link == link
        })
        .collect()
}

fn finish(
    actions: &dyn NotificationChainActions,
    outcome: NotificationActionOutcome,
) -> Result<NotificationActionOutcome> {
    if !outcome.expired_ids.is_empty() {
        actions.emit_expired(outcome.expired_ids.clone());
    }
    Ok(outcome)
}

fn expire_into(
    actions: &dyn NotificationChainActions,
    id: &str,
    outcome: &mut NotificationActionOutcome,
) {
    if id.is_empty() {
        return;
    }
    match actions.expire_local(id.to_string()) {
        Ok(()) => outcome.expired_ids.push(id.to_string()),
        Err(error) => {
            outcome.status = NotificationActionStatus::RemoteOkLocalFailed;
            outcome.local_error = Some(error.to_string());
        }
    }
}

async fn hide_then_expire(
    actions: &dyn NotificationChainActions,
    target: &NotificationTarget,
) -> NotificationActionOutcome {
    let mut outcome = NotificationActionOutcome::new(NotificationActionStatus::Applied);
    if !target.id.is_empty() {
        match actions
            .execute_remote(NotificationChainRemoteCall::HideNotification(
                target.clone(),
            ))
            .await
        {
            Ok(()) => {}
            Err(error) if error.is_not_found() => {
                outcome.status = NotificationActionStatus::AlreadyResolved;
                outcome.remote_error = Some(error.message);
            }
            Err(error) => {
                outcome.status = NotificationActionStatus::RemoteFailed;
                outcome.remote_error = Some(error.message);
                return outcome;
            }
        }
    }
    expire_into(actions, &target.id, &mut outcome);
    outcome
}

pub async fn hide_and_expire_notification(
    actions: &dyn NotificationChainActions,
    input: NotificationHideExpireInput,
) -> Result<NotificationActionOutcome> {
    let target = normalize_target(input.target);
    actions.ensure_scope(
        &OwnerId::new(normalize_text(input.owner_user_id.as_str())),
        &input.endpoint,
    )?;
    let outcome = hide_then_expire(actions, &target).await;
    finish(actions, outcome)
}

pub async fn accept_request_invite_notification(
    actions: &dyn NotificationChainActions,
    input: NotificationRequestInviteAcceptInput,
) -> Result<NotificationActionOutcome> {
    let target = normalize_target(input.target);
    actions.ensure_scope(
        &OwnerId::new(normalize_text(input.owner_user_id.as_str())),
        &input.endpoint,
    )?;
    let receiver_user_id = target.sender_user_id.clone();
    let instance_id = normalize_text(&input.instance_id);
    let world_id = normalize_text(&input.world_id);
    if !receiver_user_id.is_empty() && !instance_id.is_empty() && !world_id.is_empty() {
        let world_name = actions
            .resolve_world_name(&world_id)
            .await
            .unwrap_or_else(|| world_id.clone());
        let params = json!({
            "instanceId": instance_id,
            "worldId": world_id,
            "worldName": if world_name.is_empty() { world_id.clone() } else { world_name },
            "rsvp": true,
        });
        if let Err(error) = actions
            .execute_remote(NotificationChainRemoteCall::InviteSend {
                receiver_user_id,
                params,
            })
            .await
        {
            let mut outcome =
                NotificationActionOutcome::new(NotificationActionStatus::RemoteFailed);
            outcome.remote_error = Some(error.message);
            return finish(actions, outcome);
        }
    }
    let outcome = hide_then_expire(actions, &target).await;
    finish(actions, outcome)
}

pub async fn send_instance_invite_notification(
    actions: &dyn NotificationChainActions,
    input: NotificationInstanceInviteInput,
) -> Result<NotificationActionOutcome> {
    actions.ensure_active_scope(&input.endpoint)?;
    let receiver_user_id = normalize_text(&input.receiver_user_id);
    let instance_id = normalize_text(&input.instance_id);
    let world_id = normalize_text(&input.world_id);
    if receiver_user_id.is_empty() || instance_id.is_empty() || world_id.is_empty() {
        return Err(Error::Custom(
            "Instance invite requires receiverUserId, instanceId, and worldId.".into(),
        ));
    }
    let provided_world_name = normalize_text(&input.world_name);
    let world_name = if provided_world_name.is_empty() {
        actions
            .resolve_world_name(&world_id)
            .await
            .unwrap_or_else(|| world_id.clone())
    } else {
        provided_world_name
    };
    let mut params = serde_json::Map::from_iter([
        ("instanceId".into(), Value::String(instance_id)),
        ("worldId".into(), Value::String(world_id)),
        ("worldName".into(), Value::String(world_name)),
    ]);
    if let Some(message_slot) = input.message_slot {
        params.insert("messageSlot".into(), Value::from(message_slot));
    }
    if let Some(rsvp) = input.rsvp {
        params.insert("rsvp".into(), Value::Bool(rsvp));
    }
    let image_data = normalize_text(&input.image_data);
    let sent_photo = !image_data.is_empty();
    let call = if sent_photo {
        NotificationChainRemoteCall::InviteSendPhoto {
            receiver_user_id,
            params: Value::Object(params),
            image_data,
        }
    } else {
        NotificationChainRemoteCall::InviteSend {
            receiver_user_id,
            params: Value::Object(params),
        }
    };
    let mut outcome = NotificationActionOutcome::new(NotificationActionStatus::Applied);
    outcome.sent_photo = sent_photo;
    if let Err(error) = actions.execute_remote(call).await {
        outcome.status = NotificationActionStatus::RemoteFailed;
        outcome.remote_error = Some(error.message);
    }
    Ok(outcome)
}

pub async fn send_invite_response_notification(
    actions: &dyn NotificationChainActions,
    input: NotificationInviteResponseInput,
) -> Result<NotificationActionOutcome> {
    let target = normalize_target(input.target);
    actions.ensure_scope(
        &OwnerId::new(normalize_text(input.owner_user_id.as_str())),
        &input.endpoint,
    )?;
    let image_data = normalize_text(&input.image_data);
    let sent_photo = !image_data.is_empty();
    if !target.id.is_empty() {
        let call = if sent_photo {
            NotificationChainRemoteCall::InviteResponsePhoto {
                id: target.id.clone(),
                response_slot: input.response_slot,
                image_data,
            }
        } else {
            NotificationChainRemoteCall::InviteResponse {
                id: target.id.clone(),
                response_slot: input.response_slot,
            }
        };
        if let Err(error) = actions.execute_remote(call).await {
            let mut outcome =
                NotificationActionOutcome::new(NotificationActionStatus::RemoteFailed);
            outcome.sent_photo = sent_photo;
            outcome.remote_error = Some(error.message);
            return finish(actions, outcome);
        }
    }
    let mut outcome = NotificationActionOutcome::new(NotificationActionStatus::Applied);
    outcome.sent_photo = sent_photo;
    if !target.id.is_empty() {
        if let Err(error) = actions
            .execute_remote(NotificationChainRemoteCall::HideNotification(
                target.clone(),
            ))
            .await
        {
            outcome.remote_error = Some(error.message);
        }
    }
    expire_into(actions, &target.id, &mut outcome);
    finish(actions, outcome)
}

async fn dismiss_boop_rows(
    actions: &dyn NotificationChainActions,
    sender_user_id: &str,
    outcome: &mut NotificationActionOutcome,
) -> Result<()> {
    let rows = boop_rows_matching(actions.query_boop_rows()?, sender_user_id);
    for row in rows {
        let target = NotificationTarget {
            id: row.id.clone(),
            version: row.version,
            notification_type: row.notification_type,
            sender_user_id: row.sender_user_id,
        };
        if let Err(error) = actions
            .execute_remote(NotificationChainRemoteCall::HideNotification(target))
            .await
        {
            outcome.remote_error = Some(error.message);
        }
        match actions.expire_local(row.id.clone()) {
            Ok(()) => outcome.expired_ids.push(row.id),
            Err(error) => outcome.local_error = Some(error.to_string()),
        }
    }
    Ok(())
}

pub async fn dismiss_boop_notifications(
    actions: &dyn NotificationChainActions,
    input: NotificationBoopDismissInput,
) -> Result<NotificationActionOutcome> {
    let sender_user_id = normalize_text(&input.sender_user_id);
    actions.ensure_scope(
        &OwnerId::new(normalize_text(input.owner_user_id.as_str())),
        &input.endpoint,
    )?;
    let mut outcome = NotificationActionOutcome::new(NotificationActionStatus::Applied);
    if sender_user_id.is_empty() {
        return finish(actions, outcome);
    }
    dismiss_boop_rows(actions, &sender_user_id, &mut outcome).await?;
    finish(actions, outcome)
}

pub async fn send_boop_reply_notification(
    actions: &dyn NotificationChainActions,
    input: NotificationBoopReplyInput,
) -> Result<NotificationActionOutcome> {
    let target = normalize_target(input.target);
    actions.ensure_scope(
        &OwnerId::new(normalize_text(input.owner_user_id.as_str())),
        &input.endpoint,
    )?;
    let sender_user_id = target.sender_user_id.clone();
    if sender_user_id.is_empty() {
        return Err(Error::Custom(
            "Cannot send boop: no sender user id is available.".into(),
        ));
    }
    let mut outcome = NotificationActionOutcome::new(NotificationActionStatus::Applied);
    dismiss_boop_rows(actions, &sender_user_id, &mut outcome).await?;
    if let Err(error) = actions
        .execute_remote(NotificationChainRemoteCall::BoopSend {
            user_id: sender_user_id,
            emoji_id: normalize_text(&input.emoji_id),
            inventory_item_id: normalize_text(&input.inventory_item_id),
        })
        .await
    {
        outcome.status = NotificationActionStatus::RemoteFailed;
        outcome.remote_error = Some(error.message);
        return finish(actions, outcome);
    }
    if !target.id.is_empty() {
        if let Err(error) = actions
            .execute_remote(NotificationChainRemoteCall::HideNotification(
                target.clone(),
            ))
            .await
        {
            outcome.remote_error = Some(error.message);
        }
    }
    expire_into(actions, &target.id, &mut outcome);
    finish(actions, outcome)
}

pub async fn respond_and_expire_notification(
    actions: &dyn NotificationChainActions,
    input: NotificationRespondInput,
) -> Result<NotificationActionOutcome> {
    let target = normalize_target(input.target);
    actions.ensure_scope(
        &OwnerId::new(normalize_text(input.owner_user_id.as_str())),
        &input.endpoint,
    )?;
    let response_type = normalize_text(&input.response_type);
    let mut outcome = NotificationActionOutcome::new(NotificationActionStatus::Applied);
    if !target.id.is_empty() && !response_type.is_empty() {
        match actions
            .execute_remote(NotificationChainRemoteCall::Respond {
                id: target.id.clone(),
                response_type,
                response_data: input.response_data.into_value(),
            })
            .await
        {
            Ok(()) => {}
            Err(error) if error.is_not_found() => {
                outcome.status = NotificationActionStatus::AlreadyResolved;
                outcome.remote_error = Some(error.message);
            }
            Err(error) => {
                outcome.status = NotificationActionStatus::RemoteFailed;
                outcome.remote_error = Some(error.message);
                if target.version >= 2 {
                    if let Ok(()) = actions.expire_local(target.id.clone()) {
                        outcome.expired_ids.push(target.id.clone());
                    }
                }
                return finish(actions, outcome);
            }
        }
    }
    expire_into(actions, &target.id, &mut outcome);
    finish(actions, outcome)
}

#[cfg(test)]
mod tests;
