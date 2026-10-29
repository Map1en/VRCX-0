use chrono::{DateTime, Local, TimeZone};
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
    pub created_at: &'a str,
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

pub fn notification_group_key_in<Tz: TimeZone>(
    facts: &NotificationGroupFacts<'_>,
    timezone: &Tz,
) -> Option<String>
where
    Tz::Offset: std::fmt::Display,
{
    let kind = NotificationKind::from(facts.kind.trim());
    let scope_id = match group_scope(&kind)? {
        GroupScope::Group => group_id(facts),
        GroupScope::Kind => "*".to_string(),
    };
    if scope_id.is_empty() {
        return None;
    }
    let date = DateTime::parse_from_rfc3339(facts.created_at.trim())
        .ok()?
        .with_timezone(timezone)
        .format("%Y-%m-%d");
    Some(format!("{}:{scope_id}:{date}", kind.as_str()))
}

pub fn notification_group_key(facts: &NotificationGroupFacts<'_>) -> Option<String> {
    notification_group_key_in(facts, &Local)
}

#[cfg(test)]
mod tests {
    use chrono::FixedOffset;
    use serde_json::{json, Value};

    use super::{notification_group_key_in, NotificationGroupFacts};

    const SENDER: &str = "usr_12345678-1234-1234-1234-1234567890ab";
    const GROUP: &str = "grp_12345678-1234-1234-1234-1234567890ab";

    fn key_at(
        kind: &str,
        sender_user_id: &str,
        created_at: &str,
        data: &Value,
        offset_hours: i32,
    ) -> Option<String> {
        let timezone = FixedOffset::east_opt(offset_hours * 3600).unwrap();
        notification_group_key_in(
            &NotificationGroupFacts {
                kind,
                sender_user_id,
                created_at,
                data,
                details: &json!({}),
            },
            &timezone,
        )
    }

    fn key(kind: &str, sender_user_id: &str, data: &Value) -> Option<String> {
        key_at(kind, sender_user_id, "2026-10-29T10:00:00.000Z", data, 0)
    }

    #[test]
    fn groups_repeated_informational_kinds() {
        let empty = json!({});
        let group_data = json!({ "groupId": GROUP });

        assert_eq!(
            key("inviteResponse", SENDER, &empty).as_deref(),
            Some("inviteResponse:*:2026-10-29")
        );
        assert_eq!(
            key("requestInviteResponse", SENDER, &empty).as_deref(),
            Some("requestInviteResponse:*:2026-10-29")
        );
        for kind in [
            "group.announcement",
            "group.post",
            "group.informative",
            "group.event.created",
        ] {
            assert_eq!(
                key(kind, SENDER, &group_data),
                Some(format!("{kind}:{GROUP}:2026-10-29")),
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
            Some(format!("group.announcement:{GROUP}:2026-10-29"))
        );
        assert_eq!(key("group.announcement", SENDER, &empty), None);
        assert_eq!(key("group.announcement", "", &empty), None);
    }

    #[test]
    fn separates_days_in_the_local_timezone() {
        let empty = json!({});
        let at = |created_at: &str, offset_hours: i32| {
            key_at("group.post", GROUP, created_at, &empty, offset_hours)
        };

        assert_ne!(
            at("2026-10-29T23:30:00.000Z", 0),
            at("2026-10-30T00:30:00.000Z", 0)
        );
        assert_eq!(
            at("2026-10-29T23:30:00.000Z", 9),
            at("2026-10-30T00:30:00.000Z", 9)
        );
        assert_eq!(
            at("2026-10-29T23:30:00.000Z", 9),
            Some(format!("group.post:{GROUP}:2026-10-30"))
        );
    }

    #[test]
    fn skips_unparseable_timestamps() {
        assert_eq!(key_at("inviteResponse", SENDER, "", &json!({}), 0), None);
        assert_eq!(
            key_at("inviteResponse", SENDER, "yesterday", &json!({}), 0),
            None
        );
    }
}
