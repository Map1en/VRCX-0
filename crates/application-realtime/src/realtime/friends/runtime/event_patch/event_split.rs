use super::patch_builders::{
    event_user_patch, has_embedded_location_user, is_online_location_proof,
};
use super::*;
use vrcx_0_core::friends::normalize_state_bucket;

#[derive(Clone, Copy)]
pub(super) enum EventSource {
    Websocket,
    ApiProfile,
    TrustedFriendAdd,
}

impl EventSource {
    pub(super) fn trusts_embedded_state(self) -> bool {
        matches!(
            self,
            EventSource::ApiProfile | EventSource::TrustedFriendAdd
        )
    }

    pub(super) fn emits_profile_diff_feed(self) -> bool {
        matches!(self, EventSource::Websocket)
    }
}

pub(super) fn profile_patch(content: &Value, user_id: &str) -> Value {
    event_user_patch(content, user_id).unwrap_or_else(|| json!({ "id": user_id }))
}

pub(super) struct LocationPresence {
    pub(super) has_embedded_user: bool,
    pub(super) has_online_location: bool,
    pub(super) has_offline_location: bool,
    pub(super) state_bucket: String,
    pub(super) authority: &'static str,
}

pub(super) fn location_presence(
    content: &Value,
    user_patch: &Value,
    previous: Option<&FriendRecord>,
) -> Option<LocationPresence> {
    let has_embedded_user = has_embedded_location_user(content);
    let has_online_location = location_event_has_online_proof(content, user_patch);
    let has_offline_location = location_event_has_offline_proof(content, user_patch);
    let state_bucket =
        resolve_location_event_state_bucket(previous, has_embedded_user, has_online_location)?;
    let authority = if has_embedded_user && has_online_location {
        "explicit"
    } else {
        "preserve"
    };
    Some(LocationPresence {
        has_embedded_user,
        has_online_location,
        has_offline_location,
        state_bucket,
        authority,
    })
}

fn resolve_location_event_state_bucket(
    previous: Option<&FriendRecord>,
    has_embedded_user: bool,
    has_online_location: bool,
) -> Option<String> {
    if has_embedded_user && has_online_location {
        return Some("online".into());
    }
    for candidate in previous
        .map(|previous| [previous.state_bucket.as_str(), previous.state.as_str()])
        .unwrap_or_default()
    {
        if let Some(normalized) = normalize_state_bucket(candidate) {
            return Some(normalized);
        }
    }
    None
}

fn location_event_has_online_proof(content: &Value, user_patch: &Value) -> bool {
    location_event_locations(content, user_patch)
        .iter()
        .flatten()
        .any(|value| is_online_location_proof(value))
}

fn location_event_has_offline_proof(content: &Value, user_patch: &Value) -> bool {
    location_event_locations(content, user_patch)
        .iter()
        .flatten()
        .any(|value| is_offline_location_proof(value))
}

fn location_event_locations<'a>(content: &'a Value, user_patch: &'a Value) -> [Option<&'a str>; 2] {
    let content_locations = [
        content.get("location").and_then(Value::as_str),
        content.get("travelingToLocation").and_then(Value::as_str),
    ];
    if content_locations
        .iter()
        .flatten()
        .any(|value| !value.trim().is_empty())
    {
        return content_locations;
    }
    [
        user_patch.get("location").and_then(Value::as_str),
        user_patch
            .get("travelingToLocation")
            .and_then(Value::as_str),
    ]
}

fn is_offline_location_proof(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "offline" | "offline:offline"
    )
}
