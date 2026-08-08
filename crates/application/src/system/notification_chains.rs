use std::{future::Future, pin::Pin};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vrcx_0_application_core::{RealtimeNotificationProjection, RuntimeEventBus};
use vrcx_0_persistence::{
    invite_history::record_successful_invite_send,
    notifications::{notification_expire, notification_list_query, NotificationListQueryInput},
    DatabaseService,
};
use vrcx_0_vrchat_client::{
    http_api::{normalize_vrchat_api_endpoint, ApiJsonResponse, ApiScope},
    notifications::{
        boop_send_input, invite_response_photo_input, invite_response_send_input,
        invite_send_input, notification_hide_remote_input, notification_respond_input,
    },
};

use crate::{
    media::prepare_media_upload_request, Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot,
    WebClient,
};

use super::notification_actions::ensure_scope_matches;

const BOOP_DISMISS_QUERY_LIMIT: i64 = 50_000;

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
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRequestInviteAcceptInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
    #[serde(default)]
    pub instance_id: String,
    #[serde(default)]
    pub world_id: String,
    #[serde(default)]
    pub world_name: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationInviteResponseInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
    pub response_slot: i64,
    #[serde(default)]
    pub image_data: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationBoopDismissInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    pub sender_user_id: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationBoopReplyInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
    #[serde(default)]
    pub emoji_id: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRespondInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub endpoint: String,
    pub target: NotificationTarget,
    #[serde(default)]
    pub response_type: String,
    #[serde(default)]
    pub response_data: Value,
}

#[derive(Clone, Debug)]
pub struct NotificationChainRemoteError {
    pub message: String,
    pub status: i32,
}

impl NotificationChainRemoteError {
    fn terminal(error: impl ToString) -> Self {
        Self {
            message: error.to_string(),
            status: 0,
        }
    }

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
        response_slot: i64,
    },
    InviteResponsePhoto {
        id: String,
        response_slot: i64,
        image_data: String,
    },
    InviteSend {
        receiver_user_id: String,
        params: Value,
    },
    BoopSend {
        user_id: String,
        emoji_id: String,
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
    fn ensure_scope(&self, owner_user_id: &str, endpoint: &str) -> Result<()>;
    fn execute_remote(
        &self,
        call: NotificationChainRemoteCall,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<(), NotificationChainRemoteError>> + Send + '_>,
    >;
    fn expire_local(&self, id: String) -> Result<()>;
    fn query_boop_rows(&self) -> Result<Vec<BoopNotificationRow>>;
    fn emit_expired(&self, expired_ids: Vec<String>);
    fn record_invite_send(
        &self,
        _receiver_user_id: &str,
        _source_notification_id: &str,
    ) -> Result<()> {
        Ok(())
    }
}

pub struct VrchatNotificationChainActions<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub auth_scope: &'a RuntimeAuthScope,
    pub expected_scope: RuntimeAuthScopeSnapshot,
    pub event_bus: &'a RuntimeEventBus,
}

impl NotificationChainActions for VrchatNotificationChainActions<'_> {
    fn ensure_scope(&self, owner_user_id: &str, endpoint: &str) -> Result<()> {
        ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)?;
        let stale = || {
            Error::Custom("Notification action request is stale for the current auth scope.".into())
        };
        if self.expected_scope.current_user_id != owner_user_id {
            return Err(stale());
        }
        if !endpoint.is_empty()
            && normalize_vrchat_api_endpoint(Some(endpoint)) != self.expected_scope.endpoint
        {
            return Err(stale());
        }
        Ok(())
    }

    fn execute_remote(
        &self,
        call: NotificationChainRemoteCall,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<(), NotificationChainRemoteError>> + Send + '_>,
    > {
        Box::pin(async move {
            ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)
                .map_err(NotificationChainRemoteError::terminal)?;
            let endpoint = self.expected_scope.endpoint.clone();
            let (request, scope) = match call {
                NotificationChainRemoteCall::HideNotification(target) => {
                    let (_, request) = notification_hide_remote_input(
                        endpoint,
                        target.id,
                        target.version,
                        target.notification_type,
                        target.sender_user_id,
                    )
                    .map_err(NotificationChainRemoteError::terminal)?;
                    (request, ApiScope::Vrchat)
                }
                NotificationChainRemoteCall::Respond {
                    id,
                    response_type,
                    response_data,
                } => {
                    let (_, request) =
                        notification_respond_input(endpoint, id, response_type, response_data)
                            .map_err(NotificationChainRemoteError::terminal)?;
                    (request, ApiScope::Vrchat)
                }
                NotificationChainRemoteCall::InviteResponse { id, response_slot } => {
                    let (_, request) = invite_response_send_input(endpoint, id, response_slot)
                        .map_err(NotificationChainRemoteError::terminal)?;
                    (request, ApiScope::Vrchat)
                }
                NotificationChainRemoteCall::InviteResponsePhoto {
                    id,
                    response_slot,
                    image_data,
                } => {
                    let (_, request) =
                        invite_response_photo_input(endpoint, id, response_slot, image_data)
                            .map_err(NotificationChainRemoteError::terminal)?;
                    let request = prepare_media_upload_request(request)
                        .map_err(NotificationChainRemoteError::terminal)?;
                    (request, ApiScope::VrchatMedia)
                }
                NotificationChainRemoteCall::InviteSend {
                    receiver_user_id,
                    params,
                } => {
                    let (_, request) = invite_send_input(endpoint, receiver_user_id, params)
                        .map_err(NotificationChainRemoteError::terminal)?;
                    (request, ApiScope::Vrchat)
                }
                NotificationChainRemoteCall::BoopSend { user_id, emoji_id } => {
                    let (_, request) = boop_send_input(endpoint, user_id, emoji_id)
                        .map_err(NotificationChainRemoteError::terminal)?;
                    (request, ApiScope::Vrchat)
                }
            };
            let response = self
                .web
                .execute_api(request, scope, self.db)
                .await
                .map_err(NotificationChainRemoteError::terminal)?;
            let parsed = ApiJsonResponse::parse(response.status, &response.data);
            if parsed.is_failure() {
                return Err(NotificationChainRemoteError {
                    message: parsed.error_message_or("VRChat notification request failed"),
                    status: parsed.status,
                });
            }
            ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)
                .map_err(NotificationChainRemoteError::terminal)?;
            Ok(())
        })
    }

    fn expire_local(&self, id: String) -> Result<()> {
        ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)?;
        notification_expire(self.db, self.expected_scope.current_user_id.clone(), id)?;
        Ok(())
    }

    fn query_boop_rows(&self) -> Result<Vec<BoopNotificationRow>> {
        ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)?;
        let rows = notification_list_query(
            self.db,
            NotificationListQueryInput {
                user_id: self.expected_scope.current_user_id.clone(),
                search: String::new(),
                filters: vec!["boop".into()],
                per_table_limit: BOOP_DISMISS_QUERY_LIMIT,
                limit: BOOP_DISMISS_QUERY_LIMIT,
                include_unseen: false,
            },
        )?;
        Ok(rows
            .into_iter()
            .map(|row| BoopNotificationRow {
                id: row.id,
                version: row.version,
                notification_type: row.r#type,
                sender_user_id: row.sender_user_id,
                link: row.link,
                expired: row.expired,
            })
            .collect())
    }

    fn emit_expired(&self, expired_ids: Vec<String>) {
        self.event_bus
            .emit_realtime_notification_projection(RealtimeNotificationProjection {
                generation: 0,
                expired_ids,
                seen_ids: Vec::new(),
                clear_menu_if_no_unseen: true,
                ..RealtimeNotificationProjection::default()
            });
    }

    fn record_invite_send(
        &self,
        receiver_user_id: &str,
        source_notification_id: &str,
    ) -> Result<()> {
        ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)?;
        record_successful_invite_send(
            self.db,
            &self.expected_scope.current_user_id,
            receiver_user_id,
            "request-invite-accept",
            Some(source_notification_id),
        )?;
        Ok(())
    }
}

fn normalize_target(mut target: NotificationTarget) -> NotificationTarget {
    target.id = target.id.trim().to_string();
    target.notification_type = target.notification_type.trim().to_string();
    target.sender_user_id = target.sender_user_id.trim().to_string();
    target
}

fn normalize_text(value: &str) -> String {
    value.trim().to_string()
}

pub fn boop_rows_matching(
    rows: Vec<BoopNotificationRow>,
    sender_user_id: &str,
) -> Vec<BoopNotificationRow> {
    let link = format!("user:{sender_user_id}");
    rows.into_iter()
        .filter(|row| row.notification_type == "boop" && !row.expired && row.link == link)
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
        normalize_text(&input.owner_user_id).as_str(),
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
        normalize_text(&input.owner_user_id).as_str(),
        &input.endpoint,
    )?;
    let instance_id = normalize_text(&input.instance_id);
    let world_id = normalize_text(&input.world_id);
    let world_name = normalize_text(&input.world_name);
    let mut history_error = None;
    if !target.sender_user_id.is_empty() && !instance_id.is_empty() && !world_id.is_empty() {
        let params = json!({
            "instanceId": instance_id,
            "worldId": world_id,
            "worldName": if world_name.is_empty() { world_id.clone() } else { world_name },
            "rsvp": true,
        });
        if let Err(error) = actions
            .execute_remote(NotificationChainRemoteCall::InviteSend {
                receiver_user_id: target.sender_user_id.clone(),
                params,
            })
            .await
        {
            let mut outcome =
                NotificationActionOutcome::new(NotificationActionStatus::RemoteFailed);
            outcome.remote_error = Some(error.message);
            return finish(actions, outcome);
        }
        if let Err(error) = actions.record_invite_send(&target.sender_user_id, &target.id) {
            history_error = Some(error.to_string());
        }
    }
    let mut outcome = hide_then_expire(actions, &target).await;
    if let Some(error) = history_error {
        outcome.local_error = Some(error);
        if outcome.status == NotificationActionStatus::Applied {
            outcome.status = NotificationActionStatus::RemoteOkLocalFailed;
        }
    }
    finish(actions, outcome)
}

pub async fn send_invite_response_notification(
    actions: &dyn NotificationChainActions,
    input: NotificationInviteResponseInput,
) -> Result<NotificationActionOutcome> {
    let target = normalize_target(input.target);
    actions.ensure_scope(
        normalize_text(&input.owner_user_id).as_str(),
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
    let mut outcome = hide_then_expire(actions, &target).await;
    outcome.sent_photo = sent_photo;
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
        normalize_text(&input.owner_user_id).as_str(),
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
        normalize_text(&input.owner_user_id).as_str(),
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
        normalize_text(&input.owner_user_id).as_str(),
        &input.endpoint,
    )?;
    let response_type = normalize_text(&input.response_type);
    let mut outcome = NotificationActionOutcome::new(NotificationActionStatus::Applied);
    if !target.id.is_empty() && !response_type.is_empty() {
        match actions
            .execute_remote(NotificationChainRemoteCall::Respond {
                id: target.id.clone(),
                response_type,
                response_data: input.response_data,
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
