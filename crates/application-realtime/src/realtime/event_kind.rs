use compact_str::CompactString;
use serde::Deserialize;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(from = "CompactString")]
pub(crate) enum RealtimeWsEventKind {
    FriendAdd,
    FriendDelete,
    FriendUpdate,
    FriendOnline,
    FriendActive,
    FriendOffline,
    FriendLocation,
    Notification,
    NotificationV2,
    NotificationV2Delete,
    NotificationV2Update,
    SeeNotification,
    HideNotification,
    ResponseNotification,
    InstanceQueueJoined,
    InstanceQueuePosition,
    InstanceQueueReady,
    InstanceQueueLeft,
    UserUpdate,
    UserLocation,
    InstanceClosed,
    ContentRefresh,
    EconomyUpdate,
    GroupLeft,
    GroupMemberUpdated,
    GroupRoleUpdated,
    Unknown(CompactString),
}

impl RealtimeWsEventKind {
    pub(crate) fn from_payload(payload: &RealtimeWsMessagePayload) -> Option<Self> {
        Self::deserialize(payload.json.get("type")?).ok()
    }

    fn known(name: &str) -> Option<Self> {
        match name {
            "friend-add" => Some(Self::FriendAdd),
            "friend-delete" => Some(Self::FriendDelete),
            "friend-update" => Some(Self::FriendUpdate),
            "friend-online" => Some(Self::FriendOnline),
            "friend-active" => Some(Self::FriendActive),
            "friend-offline" => Some(Self::FriendOffline),
            "friend-location" => Some(Self::FriendLocation),
            "notification" => Some(Self::Notification),
            "notification-v2" => Some(Self::NotificationV2),
            "notification-v2-delete" => Some(Self::NotificationV2Delete),
            "notification-v2-update" => Some(Self::NotificationV2Update),
            "see-notification" => Some(Self::SeeNotification),
            "hide-notification" => Some(Self::HideNotification),
            "response-notification" => Some(Self::ResponseNotification),
            "instance-queue-joined" => Some(Self::InstanceQueueJoined),
            "instance-queue-position" => Some(Self::InstanceQueuePosition),
            "instance-queue-ready" => Some(Self::InstanceQueueReady),
            "instance-queue-left" => Some(Self::InstanceQueueLeft),
            "user-update" => Some(Self::UserUpdate),
            "user-location" => Some(Self::UserLocation),
            "instance-closed" => Some(Self::InstanceClosed),
            "content-refresh" => Some(Self::ContentRefresh),
            "economy-update" => Some(Self::EconomyUpdate),
            "group-left" => Some(Self::GroupLeft),
            "group-member-updated" => Some(Self::GroupMemberUpdated),
            "group-role-updated" => Some(Self::GroupRoleUpdated),
            _ => None,
        }
    }

    pub(crate) fn is_friend(&self) -> bool {
        matches!(
            self,
            Self::FriendAdd
                | Self::FriendDelete
                | Self::FriendUpdate
                | Self::FriendOnline
                | Self::FriendActive
                | Self::FriendOffline
                | Self::FriendLocation
        )
    }

    pub(crate) fn is_notification(&self) -> bool {
        matches!(
            self,
            Self::Notification
                | Self::NotificationV2
                | Self::NotificationV2Delete
                | Self::NotificationV2Update
                | Self::SeeNotification
                | Self::HideNotification
                | Self::ResponseNotification
        )
    }
}

impl From<CompactString> for RealtimeWsEventKind {
    fn from(name: CompactString) -> Self {
        Self::known(&name).unwrap_or(Self::Unknown(name))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::fs::File;
    use std::io::{BufRead, BufReader};

    use serde_json::{json, Value};
    use vrcx_0_core::realtime::{RealtimeMessageParseOutcome, RealtimeMessageParser};

    use super::RealtimeWsEventKind;

    #[test]
    fn serde_maps_all_modeled_event_names() {
        for (name, expected) in [
            ("friend-add", RealtimeWsEventKind::FriendAdd),
            ("friend-delete", RealtimeWsEventKind::FriendDelete),
            ("friend-update", RealtimeWsEventKind::FriendUpdate),
            ("friend-online", RealtimeWsEventKind::FriendOnline),
            ("friend-active", RealtimeWsEventKind::FriendActive),
            ("friend-offline", RealtimeWsEventKind::FriendOffline),
            ("friend-location", RealtimeWsEventKind::FriendLocation),
            ("notification", RealtimeWsEventKind::Notification),
            ("notification-v2", RealtimeWsEventKind::NotificationV2),
            (
                "notification-v2-delete",
                RealtimeWsEventKind::NotificationV2Delete,
            ),
            (
                "notification-v2-update",
                RealtimeWsEventKind::NotificationV2Update,
            ),
            ("see-notification", RealtimeWsEventKind::SeeNotification),
            ("hide-notification", RealtimeWsEventKind::HideNotification),
            (
                "response-notification",
                RealtimeWsEventKind::ResponseNotification,
            ),
            (
                "instance-queue-joined",
                RealtimeWsEventKind::InstanceQueueJoined,
            ),
            (
                "instance-queue-position",
                RealtimeWsEventKind::InstanceQueuePosition,
            ),
            (
                "instance-queue-ready",
                RealtimeWsEventKind::InstanceQueueReady,
            ),
            (
                "instance-queue-left",
                RealtimeWsEventKind::InstanceQueueLeft,
            ),
            ("user-update", RealtimeWsEventKind::UserUpdate),
            ("user-location", RealtimeWsEventKind::UserLocation),
            ("instance-closed", RealtimeWsEventKind::InstanceClosed),
            ("content-refresh", RealtimeWsEventKind::ContentRefresh),
            ("economy-update", RealtimeWsEventKind::EconomyUpdate),
            ("group-left", RealtimeWsEventKind::GroupLeft),
            (
                "group-member-updated",
                RealtimeWsEventKind::GroupMemberUpdated,
            ),
            ("group-role-updated", RealtimeWsEventKind::GroupRoleUpdated),
        ] {
            let kind: RealtimeWsEventKind = serde_json::from_value(json!(name)).unwrap();
            assert_eq!(kind, expected, "{name}");
        }
    }

    #[test]
    fn serde_preserves_unknown_event_name_without_mutating_payload() {
        let raw = r#"{"type":"future-event","content":"{\"value\":1}"}"#;
        let mut parser = RealtimeMessageParser::default();
        let RealtimeMessageParseOutcome::Valid(payload) =
            parser.parse_text(raw, "2026-08-14T00:00:00Z")
        else {
            panic!("message should parse");
        };

        assert_eq!(
            RealtimeWsEventKind::from_payload(&payload),
            Some(RealtimeWsEventKind::Unknown("future-event".into()))
        );
        assert_eq!(payload.raw, raw);
        assert_eq!(payload.json["content"], json!({ "value": 1 }));
    }

    #[test]
    fn missing_or_non_string_event_name_has_no_kind() {
        for json in [json!({}), json!({ "type": null }), json!({ "type": 1 })] {
            let payload = vrcx_0_core::realtime::RealtimeWsMessagePayload {
                raw: json.to_string(),
                json,
                received_at: "2026-08-14T00:00:00Z".to_string(),
            };
            assert_eq!(RealtimeWsEventKind::from_payload(&payload), None);
        }
    }

    #[test]
    #[ignore = "requires VRCX0_WS_EVENTS raw capture"]
    fn raw_capture_uses_modeled_event_kinds() {
        let path = std::env::var("VRCX0_WS_EVENTS").expect("VRCX0_WS_EVENTS must be set");
        let file = File::open(path).expect("raw capture should open");
        let mut parser = RealtimeMessageParser::default();
        let mut message_count = 0_u64;
        let mut unknown = BTreeSet::new();

        for line in BufReader::new(file).lines() {
            let line = line.expect("raw capture line should be readable");
            let record: Value = serde_json::from_str(&line).expect("capture record should be JSON");
            if record.get("kind").and_then(Value::as_str) == Some("connect") {
                parser = RealtimeMessageParser::default();
                continue;
            }
            let Some(raw) = record.get("raw").and_then(Value::as_str) else {
                continue;
            };
            let received_at = record
                .get("receivedAt")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match parser.parse_text(raw, received_at) {
                RealtimeMessageParseOutcome::Duplicate => {}
                RealtimeMessageParseOutcome::Invalid { error } => {
                    panic!("raw websocket message should parse: {error}");
                }
                RealtimeMessageParseOutcome::Valid(payload) => {
                    message_count += 1;
                    match RealtimeWsEventKind::from_payload(&payload) {
                        Some(RealtimeWsEventKind::Unknown(name)) => {
                            unknown.insert(name);
                        }
                        Some(_) => {}
                        None => panic!("raw websocket message should have a string type"),
                    }
                }
            }
        }

        assert!(
            message_count > 0,
            "capture should contain websocket messages"
        );
        assert!(
            unknown.is_empty(),
            "unmodeled websocket event types: {unknown:?}"
        );
    }
}
