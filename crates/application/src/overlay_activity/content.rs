use serde_json::{json, Value};

use super::types::{
    OverlayActivityCandidate, OverlayActivityCategory, OverlayActivityContent, OverlayActivityText,
};

pub(super) fn build_activity_content(
    activity_type: &str,
    category: OverlayActivityCategory,
    candidate: &OverlayActivityCandidate,
    actor_display_name: &str,
) -> OverlayActivityContent {
    let payload = &candidate.payload;
    let title_name = first_non_empty([
        actor_display_name.to_string(),
        string_field(payload, "displayName"),
        string_field(payload, "senderUsername"),
        string_field(payload, "senderDisplayName"),
        string_field(payload, "userId"),
        string_field(payload, "senderUserId"),
    ]);
    let location = first_non_empty([
        string_field(payload, "location"),
        nested_string(payload, &["details", "location"]),
        nested_string(payload, &["details", "worldId"]),
        nested_string(payload, &["instanceLocation"]),
    ]);
    let world_name = first_non_empty([
        string_field(payload, "worldName"),
        nested_string(payload, &["details", "worldName"]),
    ]);
    let group_name = first_non_empty([
        string_field(payload, "groupName"),
        nested_string(payload, &["details", "groupName"]),
    ]);
    let display_location = display_location(&location, &world_name, &group_name);

    let mut content = match activity_type {
        "OnPlayerJoining" => titled_body(
            "instance",
            &title_name,
            text("notifications.is_joining", json!({}), "is joining"),
        ),
        "OnPlayerJoined" => titled_body(
            "instance",
            &title_name,
            text("notifications.has_joined", json!({}), "has joined"),
        ),
        "OnPlayerLeft" => titled_body(
            "instance",
            &title_name,
            text("notifications.has_left", json!({}), "has left"),
        ),
        "GPS" => titled_body(
            "location",
            &title_name,
            text(
                "notifications.gps",
                json!({ "location": display_location }),
                if display_location.is_empty() {
                    "is in an instance".to_string()
                } else {
                    format!("is in {display_location}")
                },
            ),
        ),
        "Online" => {
            let body = if display_location.is_empty() {
                text("notifications.online", json!({}), "online")
            } else {
                text(
                    "notifications.online_location",
                    json!({ "location": display_location }),
                    format!("online in {display_location}"),
                )
            };
            titled_body("status-online", &title_name, body)
        }
        "Offline" => titled_body(
            "status-offline",
            &title_name,
            text("notifications.offline", json!({}), "offline"),
        ),
        "Status" => {
            let status = string_field(payload, "status");
            let description = string_field(payload, "statusDescription");
            titled_body(
                status_icon(&status),
                &title_name,
                text(
                    "notifications.status_update",
                    json!({
                        "status": status,
                        "description": description,
                    }),
                    status_fallback(&status, &description),
                ),
            )
        }
        "AvatarChange" => {
            let avatar = first_non_empty([
                string_field(payload, "avatarName"),
                string_field(payload, "name"),
            ]);
            titled_body(
                "avatar",
                &title_name,
                text(
                    "notifications.avatar_change",
                    json!({ "avatar": avatar }),
                    if avatar.is_empty() {
                        "changed avatar".to_string()
                    } else {
                        format!("changed avatar to {avatar}")
                    },
                ),
            )
        }
        "Bio" => titled_body(
            "bio",
            &title_name,
            text("dashboard.widget.feed_bio", json!({}), "updated bio"),
        ),
        "Friend" => titled_body(
            "friend",
            &title_name,
            text("notifications.friend", json!({}), "friend"),
        ),
        "Unfriend" => titled_body(
            "friend",
            &title_name,
            text("notifications.unfriend", json!({}), "unfriend"),
        ),
        "DisplayName" => {
            let display_name = string_field(payload, "displayName");
            let title = first_non_empty([string_field(payload, "previousDisplayName"), title_name]);
            titled_body(
                "profile",
                &title,
                text(
                    "notifications.display_name",
                    json!({ "displayName": display_name }),
                    if display_name.is_empty() {
                        "changed display name".to_string()
                    } else {
                        format!("changed display name to {display_name}")
                    },
                ),
            )
        }
        "TrustLevel" => {
            let trust_level = string_field(payload, "trustLevel");
            titled_body(
                "profile",
                &title_name,
                text(
                    "notifications.trust_level",
                    json!({ "trustLevel": trust_level }),
                    if trust_level.is_empty() {
                        "trust level changed".to_string()
                    } else {
                        format!("trust level {trust_level}")
                    },
                ),
            )
        }
        "invite" => {
            let message = detail_message(payload);
            let fallback = join_non_empty(["has invited you to", &display_location, &message]);
            titled_body(
                "invite",
                &title_name,
                text(
                    "notifications.invite",
                    json!({ "location": display_location, "message": message }),
                    fallback,
                ),
            )
        }
        "requestInvite" => {
            let message = detail_message(payload);
            titled_body(
                "request",
                &title_name,
                text(
                    "notifications.request_invite",
                    json!({ "message": message }),
                    join_non_empty(["request invite", &message]),
                ),
            )
        }
        "inviteResponse" => {
            let message = detail_message(payload);
            titled_body(
                "invite",
                &title_name,
                text(
                    "notifications.invite_response",
                    json!({ "message": message }),
                    join_non_empty(["invite response", &message]),
                ),
            )
        }
        "requestInviteResponse" => {
            let message = detail_message(payload);
            titled_body(
                "request",
                &title_name,
                text(
                    "notifications.request_invite_response",
                    json!({ "message": message }),
                    join_non_empty(["request invite response", &message]),
                ),
            )
        }
        "friendRequest" => titled_body(
            "friend",
            &title_name,
            text("notifications.friend_request", json!({}), "friend request"),
        ),
        "boop" | "groupChange" => titled_body(
            group_or_direct_icon(activity_type),
            &title_name,
            literal_body(string_field(payload, "message")),
        ),
        "group.announcement" => group_message(
            "notifications.group_announcement_title",
            "Group announcement",
            payload,
        ),
        "group.informative" => group_message(
            "notifications.group_informative_title",
            "Group informative",
            payload,
        ),
        "group.invite" => {
            group_message("notifications.group_invite_title", "Group invite", payload)
        }
        "group.joinRequest" => group_message(
            "notifications.group_join_request_title",
            "Group join request",
            payload,
        ),
        "group.transfer" => group_message(
            "notifications.group_transfer_request_title",
            "Group transfer request",
            payload,
        ),
        "group.queueReady" => activity_content(
            "group",
            text(
                "notifications.group_queue_ready_title",
                json!({}),
                "Group queue ready",
            ),
            literal_body(string_field(payload, "message")),
        ),
        "instance.closed" => activity_content(
            "instance",
            text(
                "notifications.instance_closed_title",
                json!({}),
                "Instance closed",
            ),
            literal_body(string_field(payload, "message")),
        ),
        "Event" => titled_body(
            "system",
            "Event",
            literal_body(first_non_empty([
                string_field(payload, "data"),
                string_field(payload, "message"),
            ])),
        ),
        "External" => titled_body(
            "system",
            "External",
            literal_body(string_field(payload, "message")),
        ),
        "Blocked" => titled_body(
            "shield",
            &title_name,
            text("notifications.blocked", json!({}), "blocked"),
        ),
        "Unblocked" => titled_body(
            "shield",
            &title_name,
            text("notifications.unblocked", json!({}), "unblocked"),
        ),
        "Muted" => titled_body(
            "shield",
            &title_name,
            text("notifications.muted", json!({}), "muted"),
        ),
        "Unmuted" => titled_body(
            "shield",
            &title_name,
            text("notifications.unmuted", json!({}), "unmuted"),
        ),
        "BlockedOnPlayerJoined" => titled_body(
            "shield",
            &title_name,
            text(
                "notifications.blocked_player_joined",
                json!({}),
                "blocked user joined",
            ),
        ),
        "BlockedOnPlayerLeft" => titled_body(
            "shield",
            &title_name,
            text(
                "notifications.blocked_player_left",
                json!({}),
                "blocked user left",
            ),
        ),
        "MutedOnPlayerJoined" => titled_body(
            "shield",
            &title_name,
            text(
                "notifications.muted_player_joined",
                json!({}),
                "muted user joined",
            ),
        ),
        "MutedOnPlayerLeft" => titled_body(
            "shield",
            &title_name,
            text(
                "notifications.muted_player_left",
                json!({}),
                "muted user left",
            ),
        ),
        "VideoPlay" => titled_body(
            "media",
            "Now playing",
            literal_body(first_non_empty([
                string_field(payload, "videoName"),
                string_field(payload, "notyName"),
                string_field(payload, "message"),
                string_field(payload, "videoUrl"),
            ])),
        ),
        _ => category_content(category, &title_name, activity_type, payload),
    };

    content.location = location;
    content.world_name = world_name;
    content.group_name = group_name;
    content.status = string_field(payload, "status");
    content.status_description = string_field(payload, "statusDescription");
    content.avatar_name = first_non_empty([
        string_field(payload, "avatarName"),
        string_field(payload, "name"),
    ]);
    content.image_url = first_non_empty([
        string_field(payload, "thumbnailImageUrl"),
        nested_string(payload, &["details", "imageUrl"]),
        string_field(payload, "imageUrl"),
        string_field(payload, "currentAvatarThumbnailImageUrl"),
        string_field(payload, "currentAvatarImageUrl"),
        string_field(payload, "thumbnailUrl"),
    ]);
    content.detail = first_non_empty([
        detail_message(payload),
        content.status_description.clone(),
        content.avatar_name.clone(),
        display_location,
    ]);
    content.summary = summary(&content.title.fallback, &content.body.fallback);
    content
}

fn category_content(
    category: OverlayActivityCategory,
    title: &str,
    activity_type: &str,
    payload: &Value,
) -> OverlayActivityContent {
    let icon = match category {
        OverlayActivityCategory::ActionRequired => "invite",
        OverlayActivityCategory::CurrentInstance => "instance",
        OverlayActivityCategory::FavoriteMovement => "status",
        OverlayActivityCategory::ProfileChange => "profile",
        OverlayActivityCategory::GroupSocial => "group",
        OverlayActivityCategory::SystemSafety => "system",
        OverlayActivityCategory::Media => "media",
    };
    titled_body(
        icon,
        title,
        literal_body(first_non_empty([
            string_field(payload, "message"),
            activity_type.to_string(),
        ])),
    )
}

fn group_message(key: &str, fallback: &str, payload: &Value) -> OverlayActivityContent {
    activity_content(
        "group",
        text(key, json!({}), fallback),
        literal_body(string_field(payload, "message")),
    )
}

fn titled_body(icon: &str, title: &str, body: OverlayActivityText) -> OverlayActivityContent {
    activity_content(icon, literal_title(title), body)
}

fn activity_content(
    icon: &str,
    title: OverlayActivityText,
    body: OverlayActivityText,
) -> OverlayActivityContent {
    OverlayActivityContent {
        icon: icon.to_string(),
        title,
        body,
        ..OverlayActivityContent::default()
    }
}

fn text(key: &str, params: Value, fallback: impl Into<String>) -> OverlayActivityText {
    OverlayActivityText {
        key: key.to_string(),
        fallback: fallback.into(),
        params,
    }
}

fn literal_title(value: &str) -> OverlayActivityText {
    text("", json!({}), value.trim())
}

fn literal_body(value: String) -> OverlayActivityText {
    text("", json!({}), value.trim())
}

fn summary(title: &str, body: &str) -> String {
    match (!title.trim().is_empty(), !body.trim().is_empty()) {
        (true, true) => format!("{} {}", title.trim(), body.trim()),
        (true, false) => title.trim().to_string(),
        (false, true) => body.trim().to_string(),
        (false, false) => String::new(),
    }
}

fn status_fallback(status: &str, description: &str) -> String {
    let values = [status, description]
        .into_iter()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if values.is_empty() {
        "status update".to_string()
    } else {
        format!("status: {}", values.join(" - "))
    }
}

fn status_icon(status: &str) -> &'static str {
    match status.trim().to_ascii_lowercase().as_str() {
        "active" | "online" => "status-online",
        "join me" | "joinme" => "status-joinme",
        "ask me" | "askme" => "status-askme",
        "busy" => "status-busy",
        _ => "status",
    }
}

fn group_or_direct_icon(activity_type: &str) -> &'static str {
    if activity_type == "groupChange" {
        "group"
    } else {
        "invite"
    }
}

fn detail_message(payload: &Value) -> String {
    first_non_empty([
        nested_string(payload, &["details", "inviteMessage"]),
        nested_string(payload, &["details", "requestMessage"]),
        nested_string(payload, &["details", "responseMessage"]),
        string_field(payload, "message"),
    ])
}

fn display_location(location: &str, world_name: &str, group_name: &str) -> String {
    if !world_name.trim().is_empty() && !group_name.trim().is_empty() {
        return format!("{} ({})", world_name.trim(), group_name.trim());
    }
    if !world_name.trim().is_empty() {
        return world_name.trim().to_string();
    }
    location.trim().to_string()
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn nested_string(value: &Value, path: &[&str]) -> String {
    let mut current = value;
    for key in path {
        let Some(next) = current.get(key) else {
            return String::new();
        };
        current = next;
    }
    current
        .as_str()
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn first_non_empty<const N: usize>(values: [String; N]) -> String {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
}

fn join_non_empty<const N: usize>(values: [&str; N]) -> String {
    values
        .into_iter()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
