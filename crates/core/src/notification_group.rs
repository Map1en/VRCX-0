use serde_json::Value;

use crate::json::JsonExt;
use crate::notification_kind::NotificationKind;

enum GroupScope {
    Group,
    Kind,
}

fn group_scope(kind: &NotificationKind) -> Option<GroupScope> {
    match kind {
        NotificationKind::InviteResponse | NotificationKind::RequestInviteResponse => {
            Some(GroupScope::Kind)
        }
        NotificationKind::GroupAnnouncement
        | NotificationKind::GroupPost
        | NotificationKind::GroupInformative
        | NotificationKind::GroupEventCreated => Some(GroupScope::Group),
        _ => None,
    }
}

pub struct NotificationGroupFacts<'a> {
    pub kind: &'a str,
    pub sender_user_id: &'a str,
    pub data: &'a Value,
    pub details: &'a Value,
}

fn group_id(facts: &NotificationGroupFacts<'_>) -> String {
    let sender = facts.sender_user_id.trim();
    [
        facts.data.text_field("groupId"),
        facts.details.text_field("groupId"),
        if sender.starts_with("grp_") {
            sender.to_string()
        } else {
            String::new()
        },
    ]
    .into_iter()
    .map(|value| value.trim().to_string())
    .find(|value| !value.is_empty())
    .unwrap_or_default()
}

pub fn notification_group_key(facts: &NotificationGroupFacts<'_>) -> Option<String> {
    let kind = NotificationKind::from(facts.kind.trim());
    let scope_id = match group_scope(&kind)? {
        GroupScope::Group => group_id(facts),
        GroupScope::Kind => "*".to_string(),
    };
    if scope_id.is_empty() {
        return None;
    }
    Some(format!("{}:{scope_id}", kind.as_str()))
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{notification_group_key, NotificationGroupFacts};

    const SENDER: &str = "usr_12345678-1234-1234-1234-1234567890ab";
    const GROUP: &str = "grp_12345678-1234-1234-1234-1234567890ab";

    fn key(kind: &str, sender_user_id: &str, data: &Value) -> Option<String> {
        notification_group_key(&NotificationGroupFacts {
            kind,
            sender_user_id,
            data,
            details: &json!({}),
        })
    }

    #[test]
    fn groups_repeated_informational_kinds() {
        let empty = json!({});
        let group_data = json!({ "groupId": GROUP });

        assert_eq!(
            key("inviteResponse", SENDER, &empty).as_deref(),
            Some("inviteResponse:*")
        );
        assert_eq!(
            key("requestInviteResponse", SENDER, &empty).as_deref(),
            Some("requestInviteResponse:*")
        );
        for kind in [
            "group.announcement",
            "group.post",
            "group.informative",
            "group.event.created",
        ] {
            assert_eq!(
                key(kind, SENDER, &group_data),
                Some(format!("{kind}:{GROUP}")),
                "{kind}"
            );
        }
    }

    #[test]
    fn never_groups_kinds_that_need_a_response() {
        let group_data = json!({ "groupId": GROUP });
        for kind in [
            "friendRequest",
            "invite",
            "boop",
            "requestInvite",
            "group.invite",
            "group.joinRequest",
            "group.transfer",
            "group.queueReady",
            "group.event.starting",
            "message",
            "moderation.warning.group",
            "instance.closed",
            "",
        ] {
            assert_eq!(key(kind, SENDER, &group_data), None, "{kind}");
        }
    }

    #[test]
    fn group_kinds_fall_back_to_a_group_sender() {
        let empty = json!({});

        assert_eq!(
            key("group.announcement", GROUP, &empty),
            Some(format!("group.announcement:{GROUP}"))
        );
        assert_eq!(key("group.announcement", SENDER, &empty), None);
        assert_eq!(key("group.announcement", "", &empty), None);
    }
}
