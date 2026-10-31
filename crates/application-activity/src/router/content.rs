use vrcx_0_contracts::activity::{ActivityEvent, ActivityFacts, ActivityKind};
use vrcx_0_core::friends::{normalize_user_status, UserStatus};
use vrcx_0_core::location::{format_display_location, parse_location};
use vrcx_0_core::text::first_non_empty_owned;
use vrcx_0_i18n::OverlayMessage;

use super::types::{ActivityContent, ActivityText};

pub(super) fn build_activity_content(event: &ActivityEvent) -> ActivityContent {
    let facts = &event.facts;
    let actor_display_name = event.actor.display_name.trim();
    let title_name = first_non_empty_owned([actor_display_name, event.actor.user_id.trim()]);
    let location = facts.location.trim().to_string();
    let world_name = facts.world_name.trim().to_string();
    let group_name = facts.group_name.trim().to_string();
    let parsed_location = parse_location(&location);
    let display_location = match facts.display_location.trim() {
        "" => format_display_location(&parsed_location, &world_name, &group_name),
        display_location => display_location.to_string(),
    };
    let message = facts.message.trim();

    let mut content = match event.kind {
        ActivityKind::OnPlayerJoining => titled_body(
            "instance",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_is_joining()),
        ),
        ActivityKind::OnPlayerJoined => titled_body(
            "instance",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_has_joined()),
        ),
        ActivityKind::OnPlayerLeft => titled_body(
            "instance",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_has_left()),
        ),
        ActivityKind::Gps => titled_body(
            "location",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_gps(&display_location)),
        ),
        ActivityKind::Online => {
            let body = if readable_name(&world_name).is_empty() {
                ActivityText::message(OverlayMessage::notifications_online())
            } else {
                ActivityText::message(OverlayMessage::notifications_online_location(
                    &display_location,
                ))
            };
            titled_body("status-online", &title_name, body)
        }
        ActivityKind::Offline => titled_body(
            "status-offline",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_offline()),
        ),
        ActivityKind::Status => {
            let status = facts.status.trim();
            titled_body(
                status_icon(status),
                &title_name,
                ActivityText::message(OverlayMessage::notifications_status_update(
                    status,
                    facts.status_description.trim(),
                )),
            )
        }
        ActivityKind::AvatarChange | ActivityKind::LobbyAvatarChange => titled_body(
            "avatar",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_avatar_change(
                facts.avatar_name.trim(),
            )),
        ),
        ActivityKind::Bio => titled_body(
            "bio",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_bio()),
        ),
        ActivityKind::Friend => titled_body(
            "friend",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_friend()),
        ),
        ActivityKind::Unfriend => titled_body(
            "friend",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_unfriend()),
        ),
        ActivityKind::DisplayName => titled_body(
            "profile",
            &first_non_empty_owned([facts.previous_display_name.trim(), title_name.as_str()]),
            ActivityText::message(OverlayMessage::notifications_display_name(
                actor_display_name,
            )),
        ),
        ActivityKind::TrustLevel => titled_body(
            "profile",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_trust_level(
                facts.trust_level.trim(),
            )),
        ),
        ActivityKind::Invite => titled_body(
            "invite",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_invite(
                &display_location,
                message,
            )),
        ),
        ActivityKind::RequestInvite => titled_body(
            "request",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_request_invite(message)),
        ),
        ActivityKind::InviteResponse => titled_body(
            "invite",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_invite_response(message)),
        ),
        ActivityKind::RequestInviteResponse => titled_body(
            "request",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_request_invite_response(
                message,
            )),
        ),
        ActivityKind::FriendRequest => titled_body(
            "friend",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_friend_request()),
        ),
        ActivityKind::Boop => titled_body("invite", &title_name, literal_body(message)),
        ActivityKind::GroupChange => titled_body("group", &title_name, literal_body(message)),
        ActivityKind::GroupAnnouncement => group_message(
            OverlayMessage::notifications_group_announcement_title(),
            facts,
        ),
        ActivityKind::GroupEventCreated => group_message(
            OverlayMessage::notifications_group_event_created_title(),
            facts,
        ),
        ActivityKind::GroupEventStarting => group_message(
            OverlayMessage::notifications_group_event_starting_title(),
            facts,
        ),
        ActivityKind::GroupInformative => group_message(
            OverlayMessage::notifications_group_informative_title(),
            facts,
        ),
        ActivityKind::GroupInvite => {
            group_message(OverlayMessage::notifications_group_invite_title(), facts)
        }
        ActivityKind::GroupJoinRequest => group_message(
            OverlayMessage::notifications_group_join_request_title(),
            facts,
        ),
        ActivityKind::GroupTransfer => group_message(
            OverlayMessage::notifications_group_transfer_request_title(),
            facts,
        ),
        ActivityKind::GroupQueueReady => activity_content(
            "group",
            ActivityText::message(OverlayMessage::notifications_group_queue_ready_title()),
            if display_location.is_empty() {
                literal_body(message)
            } else {
                ActivityText::message(OverlayMessage::notifications_group_queue_ready_location(
                    &display_location,
                ))
            },
        ),
        ActivityKind::GroupInstanceOpened => {
            let body = match facts.count {
                count if count > 1 => ActivityText::message(
                    OverlayMessage::notifications_group_instances_opened(count),
                ),
                _ if !display_location.is_empty() => ActivityText::message(
                    OverlayMessage::notifications_group_instance_opened_location(&display_location),
                ),
                _ => ActivityText::message(OverlayMessage::notifications_group_instance_opened()),
            };
            activity_content(
                "group",
                ActivityText::literal(first_non_empty_owned([
                    group_name.as_str(),
                    facts.group_id.trim(),
                ])),
                body,
            )
        }
        ActivityKind::InstanceClosed => activity_content(
            "instance",
            ActivityText::message(OverlayMessage::notifications_instance_closed_title()),
            literal_body(message),
        ),
        ActivityKind::Event => keyed_title_body(
            "system",
            OverlayMessage::notifications_event_title(),
            literal_body(message),
        ),
        ActivityKind::External => keyed_title_body(
            "system",
            OverlayMessage::notifications_external_title(),
            literal_body(message),
        ),
        ActivityKind::BlockedOnPlayerJoined => titled_body(
            "shield",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_blocked_player_joined()),
        ),
        ActivityKind::BlockedOnPlayerLeft => titled_body(
            "shield",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_blocked_player_left()),
        ),
        ActivityKind::MutedOnPlayerJoined => titled_body(
            "shield",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_muted_player_joined()),
        ),
        ActivityKind::MutedOnPlayerLeft => titled_body(
            "shield",
            &title_name,
            ActivityText::message(OverlayMessage::notifications_muted_player_left()),
        ),
        ActivityKind::VideoPlay => {
            let video = facts.video.trim();
            keyed_title_body(
                "media",
                OverlayMessage::notifications_video_play_title(),
                literal_body(&if actor_display_name.is_empty() {
                    video.to_string()
                } else {
                    format!("{video} ({actor_display_name})")
                }),
            )
        }
    };

    content.world_id = match facts.world_id.trim() {
        "" => parsed_location.world_id,
        world_id => world_id.to_string(),
    };
    content.location = location;
    content.display_location = display_location;
    content.world_name = world_name;
    content.group_id = facts.group_id.trim().to_string();
    content.group_name = group_name;
    content.status = facts.status.trim().to_string();
    content.status_description = facts.status_description.trim().to_string();
    content.avatar_name = facts.avatar_name.trim().to_string();
    content.image_url = facts.image_url.trim().to_string();
    content.detail = first_non_empty_owned([
        message,
        content.status_description.as_str(),
        content.avatar_name.as_str(),
        content.display_location.as_str(),
    ]);
    if let Some(body) = keyed_body(facts) {
        content.body = body;
    }
    content.summary = summary(&content.title.source_text(), &content.body.source_text());
    content
}

fn group_message(message: OverlayMessage, facts: &ActivityFacts) -> ActivityContent {
    let title = facts.title.trim();
    activity_content(
        "group",
        if title.is_empty() {
            ActivityText::message(message)
        } else {
            ActivityText::literal(title)
        },
        literal_body(&facts.message),
    )
}

fn titled_body(icon: &str, title: &str, body: ActivityText) -> ActivityContent {
    activity_content(icon, ActivityText::literal(title.trim()), body)
}

fn keyed_title_body(icon: &str, title: OverlayMessage, body: ActivityText) -> ActivityContent {
    activity_content(icon, ActivityText::message(title), body)
}

fn activity_content(icon: &str, title: ActivityText, body: ActivityText) -> ActivityContent {
    ActivityContent {
        icon: icon.to_string(),
        title,
        body,
        ..ActivityContent::default()
    }
}

fn keyed_body(facts: &ActivityFacts) -> Option<ActivityText> {
    if facts.message_key.is_empty() {
        return None;
    }
    match serde_json::from_value::<OverlayMessage>(serde_json::json!({
        "key": facts.message_key,
        "params": facts.message_params,
    })) {
        Ok(message) => Some(ActivityText::message(message)),
        Err(error) => {
            tracing::warn!(key = %facts.message_key, %error, "unknown activity message key");
            None
        }
    }
}

fn literal_body(value: &str) -> ActivityText {
    ActivityText::literal(value.trim())
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
    if normalize_user_status(status) == "online" {
        return "status-online";
    }
    match UserStatus::normalize(status) {
        Some(UserStatus::Active) => "status-online",
        Some(UserStatus::JoinMe) => "status-joinme",
        Some(UserStatus::AskMe) => "status-askme",
        Some(UserStatus::Busy) => "status-busy",
        Some(UserStatus::Offline) | None => "status",
    }
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
