use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

macro_rules! activity_kinds {
    ($($variant:ident => $key:literal),+ $(,)?) => {
        #[derive(
            Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize,
            specta::Type,
        )]
        pub enum ActivityKind {
            $(#[serde(rename = $key)] $variant),+
        }

        impl ActivityKind {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            pub const fn key(self) -> &'static str {
                match self {
                    $(Self::$variant => $key),+
                }
            }
        }
    };
}

activity_kinds! {
    Invite => "invite",
    RequestInvite => "requestInvite",
    InviteResponse => "inviteResponse",
    RequestInviteResponse => "requestInviteResponse",
    FriendRequest => "friendRequest",
    Boop => "boop",
    GroupQueueReady => "group.queueReady",
    InstanceClosed => "instance.closed",
    OnPlayerJoining => "OnPlayerJoining",
    OnPlayerJoined => "OnPlayerJoined",
    OnPlayerLeft => "OnPlayerLeft",
    LobbyAvatarChange => "LobbyAvatarChange",
    Online => "Online",
    Offline => "Offline",
    Gps => "GPS",
    Status => "Status",
    Friend => "Friend",
    Unfriend => "Unfriend",
    DisplayName => "DisplayName",
    TrustLevel => "TrustLevel",
    AvatarChange => "AvatarChange",
    Bio => "Bio",
    GroupChange => "groupChange",
    GroupInstanceOpened => "group.instanceOpened",
    GroupAnnouncement => "group.announcement",
    GroupEventCreated => "group.event.created",
    GroupEventStarting => "group.event.starting",
    GroupInformative => "group.informative",
    GroupInvite => "group.invite",
    GroupJoinRequest => "group.joinRequest",
    GroupTransfer => "group.transfer",
    Event => "Event",
    External => "External",
    BlockedOnPlayerJoined => "BlockedOnPlayerJoined",
    BlockedOnPlayerLeft => "BlockedOnPlayerLeft",
    MutedOnPlayerJoined => "MutedOnPlayerJoined",
    MutedOnPlayerLeft => "MutedOnPlayerLeft",
    VideoPlay => "VideoPlay",
}

impl ActivityKind {
    pub fn from_key(key: &str) -> Option<Self> {
        let key = key.trim();
        Self::ALL.iter().copied().find(|kind| kind.key() == key)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivityEvent {
    pub kind: ActivityKind,
    pub source_id: String,
    pub created_at: String,
    pub actor: ActivityActor,
    pub subject: ActivitySubject,
    pub in_current_instance: bool,
    pub facts: ActivityFacts,
}

impl ActivityEvent {
    pub fn new(
        kind: ActivityKind,
        source_id: impl Into<String>,
        created_at: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            source_id: source_id.into(),
            created_at: created_at.into(),
            actor: ActivityActor::default(),
            subject: ActivitySubject::None,
            in_current_instance: false,
            facts: ActivityFacts::default(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActivityActor {
    pub user_id: String,
    pub display_name: String,
}

impl ActivityActor {
    pub fn new(user_id: impl Into<String>, display_name: impl Into<String>) -> Self {
        Self {
            user_id: user_id.into(),
            display_name: display_name.into(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ActivitySubject {
    #[default]
    None,
    User(String),
    Group(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActivityFacts {
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub display_location: String,
    pub group_id: String,
    pub group_name: String,
    pub title: String,
    pub message: String,
    pub status: String,
    pub status_description: String,
    pub avatar_name: String,
    pub previous_display_name: String,
    pub trust_level: String,
    pub video: String,
    pub image_url: String,
    pub count: u64,
    pub message_key: String,
    pub message_params: BTreeMap<String, String>,
}

pub fn stable_source_hash(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::ActivityKind;

    #[test]
    fn every_kind_round_trips_through_its_wire_key() {
        for kind in ActivityKind::ALL {
            assert_eq!(ActivityKind::from_key(kind.key()), Some(*kind));
            assert_eq!(
                serde_json::to_value(kind).unwrap(),
                serde_json::Value::String(kind.key().to_string())
            );
        }
        assert_eq!(ActivityKind::from_key("Avatar"), None);
    }
}
