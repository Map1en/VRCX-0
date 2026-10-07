use futures_util::future::BoxFuture;

use std::sync::Mutex;

use super::*;

#[derive(Default)]
struct FakeState {
    remote_calls: Vec<String>,
    expired: Vec<String>,
    emitted: Vec<Vec<String>>,
}

struct FakeActions {
    state: Mutex<FakeState>,
    boop_rows: Vec<BoopNotificationRow>,
    fail_remote: Option<(String, i32)>,
    fail_expire_ids: Vec<String>,
    resolved_world_name: Option<String>,
}

impl FakeActions {
    fn new() -> Self {
        Self {
            state: Mutex::new(FakeState::default()),
            boop_rows: Vec::new(),
            fail_remote: None,
            fail_expire_ids: Vec::new(),
            resolved_world_name: None,
        }
    }

    fn remote_calls(&self) -> Vec<String> {
        self.state.lock().unwrap().remote_calls.clone()
    }

    fn expired(&self) -> Vec<String> {
        self.state.lock().unwrap().expired.clone()
    }

    fn emitted(&self) -> Vec<Vec<String>> {
        self.state.lock().unwrap().emitted.clone()
    }
}

fn call_key(call: &NotificationChainRemoteCall) -> String {
    match call {
        NotificationChainRemoteCall::HideNotification(target) => format!("hide:{}", target.id),
        NotificationChainRemoteCall::Respond { id, .. } => format!("respond:{id}"),
        NotificationChainRemoteCall::InviteResponse { id, .. } => format!("inviteResponse:{id}"),
        NotificationChainRemoteCall::InviteResponsePhoto { id, .. } => {
            format!("inviteResponsePhoto:{id}")
        }
        NotificationChainRemoteCall::InviteSend {
            receiver_user_id,
            params,
        } => format!("inviteSend:{receiver_user_id}:{params}"),
        NotificationChainRemoteCall::InviteSendPhoto {
            receiver_user_id,
            params,
            ..
        } => format!("inviteSendPhoto:{receiver_user_id}:{params}"),
        NotificationChainRemoteCall::BoopSend {
            user_id,
            emoji_id,
            inventory_item_id,
        } => format!("boopSend:{user_id}:{emoji_id}:{inventory_item_id}"),
    }
}

impl NotificationChainActions for FakeActions {
    fn ensure_scope(&self, _owner_user_id: &OwnerId, _endpoint: &str) -> Result<()> {
        Ok(())
    }

    fn ensure_active_scope(&self, _endpoint: &str) -> Result<()> {
        Ok(())
    }

    fn execute_remote(
        &self,
        call: NotificationChainRemoteCall,
    ) -> BoxFuture<'_, std::result::Result<(), NotificationChainRemoteError>> {
        Box::pin(async move {
            let key = call_key(&call);
            self.state.lock().unwrap().remote_calls.push(key.clone());
            if let Some((prefix, status)) = &self.fail_remote {
                if key.starts_with(prefix.as_str()) {
                    return Err(NotificationChainRemoteError {
                        message: format!("remote failed: {key}"),
                        status: *status,
                    });
                }
            }
            Ok(())
        })
    }

    fn expire_local(&self, id: String) -> Result<()> {
        if self.fail_expire_ids.contains(&id) {
            return Err(Error::Custom(format!("expire failed: {id}")));
        }
        self.state.lock().unwrap().expired.push(id);
        Ok(())
    }

    fn resolve_world_name<'a>(&'a self, _world_id: &'a str) -> BoxFuture<'a, Option<String>> {
        Box::pin(async move { self.resolved_world_name.clone() })
    }

    fn query_boop_rows(&self) -> Result<Vec<BoopNotificationRow>> {
        Ok(self.boop_rows.clone())
    }

    fn emit_expired(&self, expired_ids: Vec<String>) {
        self.state.lock().unwrap().emitted.push(expired_ids);
    }
}

fn target(id: &str, version: i64) -> NotificationTarget {
    NotificationTarget {
        id: id.into(),
        version,
        notification_type: "boop".into(),
        sender_user_id: "usr_sender".into(),
    }
}

fn boop_row(id: &str, link: &str, expired: bool) -> BoopNotificationRow {
    BoopNotificationRow {
        id: id.into(),
        version: 2,
        notification_type: "boop".into(),
        sender_user_id: "usr_sender".into(),
        link: link.into(),
        expired,
    }
}

#[test]
fn boop_row_filter_matches_unexpired_rows_linked_to_sender() {
    let rows = vec![
        boop_row("match", "user:usr_sender", false),
        boop_row("expired", "user:usr_sender", true),
        boop_row("other-user", "user:usr_other", false),
        BoopNotificationRow {
            notification_type: "invite".into(),
            ..boop_row("other-type", "user:usr_sender", false)
        },
    ];
    let matched = boop_rows_matching(rows, "usr_sender");
    assert_eq!(
        matched
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        vec!["match"]
    );
}

#[tokio::test]
async fn hide_404_is_already_resolved_and_still_expires() {
    let mut actions = FakeActions::new();
    actions.fail_remote = Some(("hide:".into(), 404));
    let outcome = hide_and_expire_notification(
        &actions,
        NotificationHideExpireInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 2),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::AlreadyResolved);
    assert_eq!(outcome.expired_ids, vec!["notif"]);
    assert_eq!(actions.emitted(), vec![vec!["notif".to_string()]]);
}

#[tokio::test]
async fn hide_failure_skips_expire_and_emit() {
    let mut actions = FakeActions::new();
    actions.fail_remote = Some(("hide:".into(), 500));
    let outcome = hide_and_expire_notification(
        &actions,
        NotificationHideExpireInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 2),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::RemoteFailed);
    assert!(outcome.remote_error.is_some());
    assert!(outcome.expired_ids.is_empty());
    assert!(actions.expired().is_empty());
    assert!(actions.emitted().is_empty());
}

#[tokio::test]
async fn hide_expire_failure_is_remote_ok_local_failed() {
    let mut actions = FakeActions::new();
    actions.fail_expire_ids = vec!["notif".into()];
    let outcome = hide_and_expire_notification(
        &actions,
        NotificationHideExpireInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 2),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        outcome.status,
        NotificationActionStatus::RemoteOkLocalFailed
    );
    assert!(outcome.local_error.is_some());
    assert!(outcome.expired_ids.is_empty());
}

#[tokio::test]
async fn respond_v2_failure_expires_anyway() {
    let mut actions = FakeActions::new();
    actions.fail_remote = Some(("respond:".into(), 500));
    let outcome = respond_and_expire_notification(
        &actions,
        NotificationRespondInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 2),
            response_type: "accept".into(),
            response_data: Value::String("payload".into()).into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::RemoteFailed);
    assert_eq!(outcome.expired_ids, vec!["notif"]);
    assert_eq!(actions.emitted(), vec![vec!["notif".to_string()]]);
}

#[tokio::test]
async fn respond_v1_failure_does_not_expire() {
    let mut actions = FakeActions::new();
    actions.fail_remote = Some(("respond:".into(), 500));
    let outcome = respond_and_expire_notification(
        &actions,
        NotificationRespondInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 1),
            response_type: "accept".into(),
            response_data: Value::Null.into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::RemoteFailed);
    assert!(outcome.expired_ids.is_empty());
    assert!(actions.expired().is_empty());
}

#[tokio::test]
async fn respond_404_is_already_resolved_and_expires() {
    let mut actions = FakeActions::new();
    actions.fail_remote = Some(("respond:".into(), 404));
    let outcome = respond_and_expire_notification(
        &actions,
        NotificationRespondInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 1),
            response_type: "accept".into(),
            response_data: Value::Null.into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::AlreadyResolved);
    assert_eq!(outcome.expired_ids, vec!["notif"]);
}

#[tokio::test]
async fn boop_reply_dismisses_matching_rows_before_sending() {
    let mut actions = FakeActions::new();
    actions.boop_rows = vec![
        boop_row("previous", "user:usr_sender", false),
        boop_row("unrelated", "user:usr_other", false),
    ];
    let outcome = send_boop_reply_notification(
        &actions,
        NotificationBoopReplyInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 2),
            emoji_id: "emoji_wave".into(),
            inventory_item_id: String::new(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::Applied);
    assert_eq!(outcome.expired_ids, vec!["previous", "notif"]);
    assert_eq!(
        actions.remote_calls(),
        vec![
            "hide:previous",
            "boopSend:usr_sender:emoji_wave:",
            "hide:notif"
        ]
    );
    assert_eq!(
        actions.emitted(),
        vec![vec!["previous".to_string(), "notif".to_string()]]
    );
}

#[tokio::test]
async fn boop_reply_forwards_inventory_item_id() {
    let actions = FakeActions::new();
    let outcome = send_boop_reply_notification(
        &actions,
        NotificationBoopReplyInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 2),
            emoji_id: String::new(),
            inventory_item_id: " inv_miku ".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::Applied);
    assert_eq!(
        actions.remote_calls(),
        vec!["boopSend:usr_sender::inv_miku", "hide:notif"]
    );
}

#[tokio::test]
async fn boop_reply_send_failure_keeps_dismiss_expirations() {
    let mut actions = FakeActions::new();
    actions.boop_rows = vec![boop_row("previous", "user:usr_sender", false)];
    actions.fail_remote = Some(("boopSend:".into(), 500));
    let outcome = send_boop_reply_notification(
        &actions,
        NotificationBoopReplyInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 2),
            emoji_id: String::new(),
            inventory_item_id: String::new(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::RemoteFailed);
    assert_eq!(outcome.expired_ids, vec!["previous"]);
    assert_eq!(actions.expired(), vec!["previous"]);
    assert_eq!(actions.emitted(), vec![vec!["previous".to_string()]]);
}

#[tokio::test]
async fn boop_dismiss_hide_failure_still_expires_each_row() {
    let mut actions = FakeActions::new();
    actions.boop_rows = vec![boop_row("previous", "user:usr_sender", false)];
    actions.fail_remote = Some(("hide:".into(), 500));
    let outcome = dismiss_boop_notifications(
        &actions,
        NotificationBoopDismissInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            sender_user_id: "usr_sender".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::Applied);
    assert_eq!(outcome.expired_ids, vec!["previous"]);
    assert!(outcome.remote_error.is_some());
}

#[tokio::test]
async fn boop_reply_requires_sender_user_id() {
    let actions = FakeActions::new();
    let result = send_boop_reply_notification(
        &actions,
        NotificationBoopReplyInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: NotificationTarget {
                id: "notif".into(),
                version: 2,
                notification_type: "boop".into(),
                sender_user_id: String::new(),
            },
            emoji_id: String::new(),
            inventory_item_id: String::new(),
        },
    )
    .await;
    assert!(result.is_err());
    assert!(actions.remote_calls().is_empty());
}

#[tokio::test]
async fn invite_response_photo_reports_sent_photo() {
    let actions = FakeActions::new();
    let outcome = send_invite_response_notification(
        &actions,
        NotificationInviteResponseInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 2),
            response_slot: 1,
            image_data: "base64data".into(),
        },
    )
    .await
    .unwrap();
    assert!(outcome.sent_photo);
    assert_eq!(outcome.status, NotificationActionStatus::Applied);
    assert_eq!(
        actions.remote_calls(),
        vec!["inviteResponsePhoto:notif", "hide:notif"]
    );
    assert_eq!(outcome.expired_ids, vec!["notif"]);
}

#[tokio::test]
async fn invite_response_send_failure_skips_hide_and_expire() {
    let mut actions = FakeActions::new();
    actions.fail_remote = Some(("inviteResponse:".into(), 500));
    let outcome = send_invite_response_notification(
        &actions,
        NotificationInviteResponseInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 2),
            response_slot: 0,
            image_data: String::new(),
        },
    )
    .await
    .unwrap();
    assert!(!outcome.sent_photo);
    assert_eq!(outcome.status, NotificationActionStatus::RemoteFailed);
    assert_eq!(actions.remote_calls(), vec!["inviteResponse:notif"]);
    assert!(actions.expired().is_empty());
}

#[tokio::test]
async fn invite_response_sent_stays_applied_and_expires_when_hide_fails() {
    let mut actions = FakeActions::new();
    actions.fail_remote = Some(("hide:".into(), 500));
    let outcome = send_invite_response_notification(
        &actions,
        NotificationInviteResponseInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 1),
            response_slot: 0,
            image_data: String::new(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::Applied);
    assert!(outcome.remote_error.is_some());
    assert_eq!(
        actions.remote_calls(),
        vec!["inviteResponse:notif", "hide:notif"]
    );
    assert_eq!(outcome.expired_ids, vec!["notif"]);
    assert_eq!(actions.emitted(), vec![vec!["notif".to_string()]]);
}

#[tokio::test]
async fn request_invite_accept_sends_invite_with_rsvp_then_cleans_up() {
    let actions = FakeActions::new();
    let outcome = accept_request_invite_notification(
        &actions,
        NotificationRequestInviteAcceptInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 1),
            instance_id: "wrld_1:1234".into(),
            world_id: "wrld_1".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::Applied);
    let calls = actions.remote_calls();
    assert_eq!(calls.len(), 2);
    assert!(calls[0].starts_with("inviteSend:usr_sender:"));
    assert!(calls[0].contains("\"rsvp\":true"));
    assert!(calls[0].contains("\"worldName\":\"wrld_1\""));
    assert_eq!(calls[1], "hide:notif");
    assert_eq!(outcome.expired_ids, vec!["notif"]);
}

#[tokio::test]
async fn instance_invite_resolves_world_name_and_keeps_optional_fields() {
    let mut actions = FakeActions::new();
    actions.resolved_world_name = Some("Resolved World".into());

    let outcome = send_instance_invite_notification(
        &actions,
        NotificationInstanceInviteInput {
            endpoint: String::new(),
            receiver_user_id: "usr_receiver".into(),
            instance_id: "wrld_1:1234".into(),
            world_id: "wrld_1".into(),
            world_name: String::new(),
            message_slot: Some(4),
            image_data: String::new(),
            rsvp: Some(true),
        },
    )
    .await
    .unwrap();

    assert_eq!(outcome.status, NotificationActionStatus::Applied);
    assert!(!outcome.sent_photo);
    let calls = actions.remote_calls();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].starts_with("inviteSend:usr_receiver:"));
    assert!(calls[0].contains("\"worldName\":\"Resolved World\""));
    assert!(calls[0].contains("\"messageSlot\":4"));
    assert!(calls[0].contains("\"rsvp\":true"));
}

#[tokio::test]
async fn request_invite_accept_without_location_still_cleans_up() {
    let actions = FakeActions::new();
    let outcome = accept_request_invite_notification(
        &actions,
        NotificationRequestInviteAcceptInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 1),
            instance_id: String::new(),
            world_id: "wrld_1".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::Applied);
    assert_eq!(actions.remote_calls(), vec!["hide:notif"]);
    assert_eq!(outcome.expired_ids, vec!["notif"]);
}

#[tokio::test]
async fn request_invite_send_failure_skips_cleanup() {
    let mut actions = FakeActions::new();
    actions.fail_remote = Some(("inviteSend:".into(), 500));
    let outcome = accept_request_invite_notification(
        &actions,
        NotificationRequestInviteAcceptInput {
            owner_user_id: OwnerId::new("usr_self"),
            endpoint: String::new(),
            target: target("notif", 1),
            instance_id: "wrld_1:1234".into(),
            world_id: "wrld_1".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(outcome.status, NotificationActionStatus::RemoteFailed);
    assert_eq!(actions.expired(), Vec::<String>::new());
    assert_eq!(actions.remote_calls().len(), 1);
}
