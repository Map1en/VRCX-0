use serde_json::Value;
use vrcx_0_core::location::{format_display_location, parse_location};
use vrcx_0_i18n::OverlayMessage;

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
    let parsed_location = parse_location(&location);
    let display_location = first_non_empty([
        string_field(payload, "displayLocation"),
        nested_string(payload, &["details", "displayLocation"]),
        format_display_location(&parsed_location, &world_name, &group_name),
    ]);

    let mut content = match activity_type {
        "OnPlayerJoining" => titled_body(
            "instance",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_is_joining()),
        ),
        "OnPlayerJoined" => titled_body(
            "instance",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_has_joined()),
        ),
        "OnPlayerLeft" => titled_body(
            "instance",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_has_left()),
        ),
        "GPS" => titled_body(
            "location",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_gps(&display_location)),
        ),
        "Online" => {
            let body = if readable_name(&world_name).is_empty() {
                OverlayActivityText::message(OverlayMessage::notifications_online())
            } else {
                OverlayActivityText::message(OverlayMessage::notifications_online_location(
                    &display_location,
                ))
            };
            titled_body("status-online", &title_name, body)
        }
        "Offline" => titled_body(
            "status-offline",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_offline()),
        ),
        "Status" => {
            let status = string_field(payload, "status");
            let description = string_field(payload, "statusDescription");
            titled_body(
                status_icon(&status),
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_status_update(
                    &status,
                    &description,
                )),
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
                OverlayActivityText::message(OverlayMessage::notifications_avatar_change(&avatar)),
            )
        }
        "Bio" => titled_body(
            "bio",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_bio()),
        ),
        "Friend" => titled_body(
            "friend",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_friend()),
        ),
        "Unfriend" => titled_body(
            "friend",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_unfriend()),
        ),
        "DisplayName" => {
            let display_name = string_field(payload, "displayName");
            let title = first_non_empty([string_field(payload, "previousDisplayName"), title_name]);
            titled_body(
                "profile",
                &title,
                OverlayActivityText::message(OverlayMessage::notifications_display_name(
                    &display_name,
                )),
            )
        }
        "TrustLevel" => {
            let trust_level = string_field(payload, "trustLevel");
            titled_body(
                "profile",
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_trust_level(
                    &trust_level,
                )),
            )
        }
        "invite" => {
            let message = detail_message(payload);
            titled_body(
                "invite",
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_invite(
                    &display_location,
                    &message,
                )),
            )
        }
        "requestInvite" => {
            let message = detail_message(payload);
            titled_body(
                "request",
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_request_invite(
                    &message,
                )),
            )
        }
        "inviteResponse" => {
            let message = detail_message(payload);
            titled_body(
                "invite",
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_invite_response(
                    &message,
                )),
            )
        }
        "requestInviteResponse" => {
            let message = detail_message(payload);
            titled_body(
                "request",
                &title_name,
                OverlayActivityText::message(
                    OverlayMessage::notifications_request_invite_response(&message),
                ),
            )
        }
        "friendRequest" => titled_body(
            "friend",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_friend_request()),
        ),
        "boop" | "groupChange" => titled_body(
            group_or_direct_icon(activity_type),
            &title_name,
            literal_body(string_field(payload, "message")),
        ),
        "group.announcement" => group_message(
            OverlayMessage::notifications_group_announcement_title(),
            payload,
        ),
        "group.informative" => group_message(
            OverlayMessage::notifications_group_informative_title(),
            payload,
        ),
        "group.invite" => {
            group_message(OverlayMessage::notifications_group_invite_title(), payload)
        }
        "group.joinRequest" => group_message(
            OverlayMessage::notifications_group_join_request_title(),
            payload,
        ),
        "group.transfer" => group_message(
            OverlayMessage::notifications_group_transfer_request_title(),
            payload,
        ),
        "group.queueReady" => activity_content(
            "group",
            OverlayActivityText::message(OverlayMessage::notifications_group_queue_ready_title()),
            literal_body(string_field(payload, "message")),
        ),
        "instance.closed" => activity_content(
            "instance",
            OverlayActivityText::message(OverlayMessage::notifications_instance_closed_title()),
            literal_body(string_field(payload, "message")),
        ),
        "Event" => keyed_title_body(
            "system",
            OverlayMessage::notifications_event_title(),
            literal_body(first_non_empty([
                string_field(payload, "data"),
                string_field(payload, "message"),
            ])),
        ),
        "External" => keyed_title_body(
            "system",
            OverlayMessage::notifications_external_title(),
            literal_body(string_field(payload, "message")),
        ),
        "Blocked" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_blocked()),
        ),
        "Unblocked" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_unblocked()),
        ),
        "Muted" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_muted()),
        ),
        "Unmuted" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_unmuted()),
        ),
        "BlockedOnPlayerJoined" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_blocked_player_joined()),
        ),
        "BlockedOnPlayerLeft" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_blocked_player_left()),
        ),
        "MutedOnPlayerJoined" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_muted_player_joined()),
        ),
        "MutedOnPlayerLeft" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_muted_player_left()),
        ),
        "VideoPlay" => keyed_title_body(
            "media",
            OverlayMessage::notifications_video_play_title(),
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
    content.world_id =
        first_non_empty([string_field(payload, "worldId"), parsed_location.world_id]);
    content.display_location = display_location.clone();
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
    content.summary = summary(&content.title.source_text(), &content.body.source_text());
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

fn group_message(message: OverlayMessage, payload: &Value) -> OverlayActivityContent {
    activity_content(
        "group",
        OverlayActivityText::message(message),
        literal_body(string_field(payload, "message")),
    )
}

fn titled_body(icon: &str, title: &str, body: OverlayActivityText) -> OverlayActivityContent {
    activity_content(icon, literal_title(title), body)
}

fn keyed_title_body(
    icon: &str,
    title: OverlayMessage,
    body: OverlayActivityText,
) -> OverlayActivityContent {
    activity_content(icon, OverlayActivityText::message(title), body)
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

fn literal_title(value: &str) -> OverlayActivityText {
    OverlayActivityText::literal(value.trim())
}

fn literal_body(value: String) -> OverlayActivityText {
    OverlayActivityText::literal(value.trim())
}

fn summary(title: &str, body: &str) -> String {
    match (!title.trim().is_empty(), !body.trim().is_empty()) {
        (true, true) => format!("{} {}", title.trim(), body.trim()),
        (true, false) => title.trim().to_string(),
        (false, true) => body.trim().to_string(),
        (false, false) => String::new(),
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

fn readable_name(value: &str) -> &str {
    let trimmed = value.trim();
    if is_location_id_like(trimmed) {
        ""
    } else {
        trimmed
    }
}

fn is_location_id_like(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed == "private"
        || trimmed == "private:private"
        || trimmed.starts_with("wrld_")
        || trimmed.starts_with("grp_")
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
