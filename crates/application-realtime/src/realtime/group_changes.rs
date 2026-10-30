use serde_json::Value;
use vrcx_0_contracts::notifications::AppNotification;
use vrcx_0_core::json::{scalar_text_array, JsonExt};
use vrcx_0_core::realtime::RealtimeWsMessagePayload;
use vrcx_0_i18n::{CatalogKey, OverlayMessage};

use super::event_kind::RealtimeWsEventKind;

const GROUP_CHANGE_TYPE: &str = "groupChange";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum GroupChange {
    Left,
    MemberUpdated { role_ids: Vec<String> },
    RoleUpdated { role_name: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GroupChangeEvent {
    pub group_id: String,
    pub change: GroupChange,
    pub received_at: String,
}

pub(crate) fn group_change_event(
    owner_user_id: &str,
    event_kind: &RealtimeWsEventKind,
    payload: &RealtimeWsMessagePayload,
) -> Option<GroupChangeEvent> {
    let content = payload.json.get("content")?;
    let (group_id, change) = match event_kind {
        RealtimeWsEventKind::GroupLeft => (content.trimmed_text("groupId"), GroupChange::Left),
        RealtimeWsEventKind::GroupMemberUpdated => {
            let member = content.get("member")?;
            if member.trimmed_text("userId") != owner_user_id {
                return None;
            }
            (
                member.trimmed_text("groupId"),
                GroupChange::MemberUpdated {
                    role_ids: scalar_text_array(member.get("roleIds")),
                },
            )
        }
        RealtimeWsEventKind::GroupRoleUpdated => {
            let role = content.get("role")?;
            let role_name = role.trimmed_text("name");
            if role_name.is_empty() {
                return None;
            }
            (
                role.trimmed_text("groupId"),
                GroupChange::RoleUpdated { role_name },
            )
        }
        _ => return None,
    };
    if !group_id.starts_with("grp_") {
        return None;
    }
    Some(GroupChangeEvent {
        group_id,
        change,
        received_at: payload.received_at.clone(),
    })
}

pub(crate) fn group_change_notification(
    event: &GroupChangeEvent,
    group: &Value,
) -> AppNotification {
    let message = match &event.change {
        GroupChange::Left => OverlayMessage::notifications_group_left(),
        GroupChange::MemberUpdated { role_ids } => {
            let role_names = role_names(group, role_ids);
            if role_names.is_empty() {
                OverlayMessage::notifications_group_member_updated()
            } else {
                OverlayMessage::notifications_group_member_roles(role_names.join(", "))
            }
        }
        GroupChange::RoleUpdated { role_name } => {
            OverlayMessage::notifications_group_role_updated(role_name)
        }
    };
    let group_name = group.trimmed_text("name");
    AppNotification {
        id: format!(
            "{GROUP_CHANGE_TYPE}:{}:{}",
            event.group_id, event.received_at
        ),
        created_at: event.received_at.clone(),
        r#type: GROUP_CHANGE_TYPE.to_string(),
        subject_id: event.group_id.clone(),
        subject_name: if group_name.is_empty() {
            event.group_id.clone()
        } else {
            group_name
        },
        image_url: group.trimmed_text("iconUrl"),
        message_key: message.key().as_str().to_string(),
        message_params: message.params().clone(),
    }
}

fn role_names(group: &Value, role_ids: &[String]) -> Vec<String> {
    let roles = group
        .get("roles")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    role_ids
        .iter()
        .filter_map(|role_id| {
            roles
                .iter()
                .find(|role| role.trimmed_text("id") == *role_id)
                .map(|role| role.trimmed_text("name"))
        })
        .filter(|name| !name.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn payload(kind: &str, content: Value) -> (RealtimeWsEventKind, RealtimeWsMessagePayload) {
        let json = json!({ "type": kind, "content": content });
        let event_kind: RealtimeWsEventKind = serde_json::from_value(json["type"].clone()).unwrap();
        (
            event_kind,
            RealtimeWsMessagePayload {
                raw: json.to_string(),
                json,
                received_at: "2026-10-30T00:00:00Z".into(),
            },
        )
    }

    fn event(kind: &str, content: Value) -> Option<GroupChangeEvent> {
        let (event_kind, payload) = payload(kind, content);
        group_change_event("usr_me", &event_kind, &payload)
    }

    #[test]
    fn reads_group_events_and_ignores_other_members_and_bad_ids() {
        assert_eq!(
            event("group-left", json!({ "groupId": "grp_1" })).map(|event| event.change),
            Some(GroupChange::Left)
        );
        assert_eq!(
            event(
                "group-member-updated",
                json!({ "member": { "userId": "usr_me", "groupId": "grp_1", "roleIds": [" grol_a ", ""] } })
            )
            .map(|event| event.change),
            Some(GroupChange::MemberUpdated {
                role_ids: vec!["grol_a".into()]
            })
        );
        assert_eq!(
            event(
                "group-role-updated",
                json!({ "role": { "groupId": "grp_1", "name": "Staff" } })
            )
            .map(|event| event.change),
            Some(GroupChange::RoleUpdated {
                role_name: "Staff".into()
            })
        );
        assert!(event(
            "group-member-updated",
            json!({ "member": { "userId": "usr_other", "groupId": "grp_1" } })
        )
        .is_none());
        assert!(event("group-left", json!({ "groupId": "" })).is_none());
        assert!(event(
            "group-role-updated",
            json!({ "role": { "groupId": "grp_1" } })
        )
        .is_none());
    }

    #[test]
    fn builds_notifications_from_the_fetched_group() {
        let group = json!({
            "name": "Club",
            "iconUrl": "https://example.test/icon.png",
            "roles": [
                { "id": "grol_a", "name": "Staff" },
                { "id": "grol_b", "name": "Mod" }
            ]
        });
        let member = event(
            "group-member-updated",
            json!({ "member": { "userId": "usr_me", "groupId": "grp_1", "roleIds": ["grol_a", "grol_b", "grol_gone"] } }),
        )
        .unwrap();
        let notification = group_change_notification(&member, &group);
        assert_eq!(notification.id, "groupChange:grp_1:2026-10-30T00:00:00Z");
        assert_eq!(notification.r#type, "groupChange");
        assert_eq!(notification.subject_name, "Club");
        assert_eq!(notification.image_url, "https://example.test/icon.png");
        assert_eq!(notification.message_key, "notifications.group_member_roles");
        assert_eq!(
            notification.message_params,
            [("roles".to_string(), "Staff, Mod".to_string())].into()
        );

        let left = event("group-left", json!({ "groupId": "grp_1" })).unwrap();
        let notification = group_change_notification(&left, &Value::Null);
        assert_eq!(notification.subject_name, "grp_1");
        assert_eq!(notification.message_key, "notifications.group_left");
        assert!(notification.message_params.is_empty());

        let no_roles = event(
            "group-member-updated",
            json!({ "member": { "userId": "usr_me", "groupId": "grp_1", "roleIds": [] } }),
        )
        .unwrap();
        assert_eq!(
            group_change_notification(&no_roles, &group).message_key,
            "notifications.group_member_updated"
        );
    }
}
