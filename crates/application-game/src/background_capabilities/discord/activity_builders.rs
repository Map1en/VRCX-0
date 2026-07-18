use serde_json::{json, Map, Value};
use vrcx_0_core::location::{launch_url, ParsedLocation};

use super::super::presence_facts::BackgroundPresenceFacts;
use super::super::shared::{int_field, non_empty, string_field};
use super::{
    BackgroundDiscordActivityPayload, DiscordConfig, DiscordLocationDetails, DiscordPresenceLabels,
};

pub(super) const DEFAULT_APP_ID: &str = "1510639562177642557";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RpcWorldConfig {
    app_id: &'static str,
    activity_type: i64,
    status_display_type: i64,
    big_icon: &'static str,
}

pub(super) fn build_running_fallback_activity(
    config: &DiscordConfig,
    facts: &BackgroundPresenceFacts,
    labels: &DiscordPresenceLabels,
) -> BackgroundDiscordActivityPayload {
    let status_info = status_info(
        string_field(&facts.current_user, "status").as_deref(),
        config.discord_hide_invite,
        labels,
    );
    let platform = if config.discord_show_platform {
        platform_label(
            current_user_platform(&facts.current_user)
                .as_deref()
                .unwrap_or_default(),
            facts.is_game_running,
            facts.is_game_no_vr,
            labels,
        )
    } else {
        String::new()
    };
    let details = "VRChat".to_string();
    let activity = compact_object(json!({
        "type": 0,
        "name": "VRChat",
        "details": details,
        "state": platform.trim(),
        "status_display_type": 0,
        "timestamps": create_activity_timestamps(facts.last_game_started_at.as_deref(), None),
        "assets": create_activity_assets("vrchat", status_info.status_image, status_info.status_name),
    }));
    BackgroundDiscordActivityPayload {
        app_id: DEFAULT_APP_ID.into(),
        detail: if platform.trim().is_empty() {
            details
        } else {
            format!("{details} - {}", platform.trim())
        },
        activity,
    }
}

pub(super) fn build_discord_activity(
    config: &DiscordConfig,
    facts: &BackgroundPresenceFacts,
    labels: &DiscordPresenceLabels,
    details: &DiscordLocationDetails,
    parsed: &ParsedLocation,
) -> BackgroundDiscordActivityPayload {
    let platform = if config.discord_show_platform {
        platform_label(
            current_user_platform(&facts.current_user)
                .as_deref()
                .unwrap_or_default(),
            facts.is_game_running,
            facts.is_game_no_vr,
            labels,
        )
    } else {
        String::new()
    };
    let access_name = build_access_name(parsed, &details.group_name, &platform, labels);
    let status_info = status_info(
        string_field(&facts.current_user, "status").as_deref(),
        config.discord_hide_invite,
        labels,
    );
    let mut hide_private = config.discord_hide_invite
        && (parsed.access_type == "invite"
            || parsed.access_type == "invite+"
            || parsed.group_access_type.as_deref() == Some("members"));
    if status_info.hide_private {
        hide_private = true;
    }

    let mut details_text = non_empty(
        &details.world_name,
        non_empty(
            &facts.world_name,
            non_empty(&parsed.world_id, "VRChat").as_str(),
        )
        .as_str(),
    );
    let mut state_text = access_name;
    let mut start_time = clamp_game_session_start_time(facts);
    let mut end_time = String::new();
    let mut activity_type = 0;
    let mut status_display_type = if config.discord_world_name_as_discord_status {
        2
    } else {
        0
    };
    let mut app_id = DEFAULT_APP_ID.to_string();
    let mut big_icon = if !config.discord_hide_image && !details.thumbnail_image_url.is_empty() {
        details.thumbnail_image_url.clone()
    } else {
        "vrchat".into()
    };
    let mut details_url = details.world_link.clone();
    let mut party_id = format!("{}:{}", parsed.world_id, parsed.instance_name);
    let mut party_size = facts.player_count as i64;
    let mut party_max_size = details.world_capacity.max(party_size);
    if party_size == 0 {
        party_max_size = 0;
    }
    if !config.discord_instance {
        party_size = 0;
        party_max_size = 0;
        state_text.clear();
    }
    let mut button_text = "Join".to_string();
    let mut button_url = if parsed.access_type == "public" {
        launch_url(parsed)
    } else {
        String::new()
    };
    if !config.discord_join_button {
        button_text.clear();
        button_url.clear();
    }

    if config.discord_world_integration {
        if let Some(rpc_config) = rpc_world_config(&parsed.world_id) {
            activity_type = rpc_config.activity_type;
            status_display_type = rpc_config.status_display_type;
            app_id = rpc_config.app_id.into();
            big_icon = rpc_config.big_icon.into();
            if is_popcorn_palace_world(&parsed.world_id) && !config.discord_hide_image {
                if let Some(thumbnail_url) = string_field(&facts.now_playing, "thumbnailUrl") {
                    big_icon = thumbnail_url;
                }
            }
            if let Some(now_playing_name) = string_field(&facts.now_playing, "name") {
                details_text = now_playing_name;
            }
            if now_playing_has_content(&facts.now_playing) {
                let (now_playing_start, now_playing_end) =
                    now_playing_activity_times(&facts.now_playing);
                if !now_playing_start.is_empty() {
                    start_time = now_playing_start;
                    end_time = now_playing_end;
                }
            }
        }
    }

    if hide_private {
        party_id.clear();
        party_size = 0;
        party_max_size = 0;
        button_text.clear();
        button_url.clear();
        details_url.clear();
        details_text = labels.private_world.clone();
        state_text.clear();
        start_time.clear();
        end_time.clear();
        app_id = DEFAULT_APP_ID.into();
        big_icon = "vrchat".into();
        activity_type = 0;
        status_display_type = 0;
    }

    while details_text.chars().count() < 2 {
        details_text.push('\u{FFA0}');
    }

    let activity = compact_object(json!({
        "type": activity_type,
        "name": "VRChat",
        "details": details_text,
        "details_url": details_url,
        "state": state_text,
        "status_display_type": status_display_type,
        "timestamps": create_activity_timestamps(Some(start_time.as_str()), Some(end_time.as_str())),
        "assets": create_activity_assets(big_icon, status_info.status_image, status_info.status_name),
        "party": create_activity_party(party_id, party_size, party_max_size),
        "buttons": create_activity_buttons(button_text, button_url),
    }));

    let detail = format!(
        "{}{}",
        details_text,
        activity
            .get("state")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(|state| format!(" - {state}"))
            .unwrap_or_default()
    );
    BackgroundDiscordActivityPayload {
        app_id,
        activity,
        detail,
    }
}

fn current_user_platform(current_user: &Value) -> Option<String> {
    current_user
        .get("presence")
        .and_then(|presence| string_field(presence, "platform"))
        .or_else(|| string_field(current_user, "platform"))
        .or_else(|| string_field(current_user, "last_platform"))
}

fn platform_label(
    platform: &str,
    is_game_running: bool,
    is_game_no_vr: bool,
    labels: &DiscordPresenceLabels,
) -> String {
    if is_game_running {
        if is_game_no_vr {
            format!(" ({})", labels.platform_desktop)
        } else {
            format!(" ({})", labels.platform_vr)
        }
    } else {
        match platform {
            "web" => String::new(),
            "standalonewindows" => " (PC)".into(),
            "android" => " (Android)".into(),
            "ios" => " (iOS)".into(),
            "" => String::new(),
            value => format!(" ({value})"),
        }
    }
}

#[derive(Clone, Copy)]
struct StatusInfo<'a> {
    status_name: &'a str,
    status_image: &'static str,
    hide_private: bool,
}

fn status_info<'a>(
    status: Option<&str>,
    hide_invite: bool,
    labels: &'a DiscordPresenceLabels,
) -> StatusInfo<'a> {
    match status.unwrap_or_default() {
        "active" => StatusInfo {
            status_name: &labels.status_active,
            status_image: "active",
            hide_private: false,
        },
        "join me" => StatusInfo {
            status_name: &labels.status_join_me,
            status_image: "joinme",
            hide_private: false,
        },
        "ask me" => StatusInfo {
            status_name: &labels.status_ask_me,
            status_image: "askme",
            hide_private: hide_invite,
        },
        "busy" => StatusInfo {
            status_name: &labels.status_busy,
            status_image: "busy",
            hide_private: true,
        },
        _ => StatusInfo {
            status_name: &labels.status_offline,
            status_image: "offline",
            hide_private: true,
        },
    }
}

pub(super) fn build_access_name(
    parsed: &ParsedLocation,
    group_name: &str,
    platform: &str,
    labels: &DiscordPresenceLabels,
) -> String {
    let suffix = format!("#{}{}", parsed.instance_name, platform);
    match parsed.access_type.as_str() {
        "public" => format!("{} {suffix}", labels.access_public),
        "invite+" => format!("{} {suffix}", labels.access_invite_plus),
        "invite" => format!("{} {suffix}", labels.access_invite),
        "friends" => format!("{} {suffix}", labels.access_friends),
        "friends+" => format!("{} {suffix}", labels.access_friends_plus),
        "group" => {
            let group_access = match parsed.group_access_type.as_deref() {
                Some("public") => labels.group_access_public.as_str(),
                Some("plus") => labels.group_access_plus.as_str(),
                Some("members") => labels.group_access_members.as_str(),
                _ => "",
            };
            let group_suffix = if !group_name.is_empty() && !group_access.is_empty() {
                format!(" {group_access}({group_name})")
            } else if !group_access.is_empty() {
                format!(" {group_access}")
            } else if !group_name.is_empty() {
                format!(" ({group_name})")
            } else {
                String::new()
            };
            format!("{}{group_suffix} {suffix}", labels.access_group)
        }
        _ => String::new(),
    }
}

fn clamp_game_session_start_time(facts: &BackgroundPresenceFacts) -> String {
    let location_start = facts.current_location_started_at.trim();
    let game_start = facts.last_game_started_at.as_deref().unwrap_or("").trim();
    let Some(game_start_seconds) = timestamp_seconds(game_start).filter(|value| *value > 0) else {
        return location_start.to_string();
    };
    let location_start_seconds = timestamp_seconds(location_start).unwrap_or(0);
    if location_start_seconds == 0 || location_start_seconds < game_start_seconds {
        game_start.to_string()
    } else {
        location_start.to_string()
    }
}

fn create_activity_timestamps(start_time: Option<&str>, end_time: Option<&str>) -> Option<Value> {
    let mut timestamps = Map::new();
    if let Some(start) = start_time
        .and_then(timestamp_seconds)
        .filter(|value| *value > 0)
    {
        timestamps.insert("start".into(), json!(start));
    }
    if let Some(end) = end_time
        .and_then(timestamp_seconds)
        .filter(|value| *value > 0)
    {
        timestamps.insert("end".into(), json!(end));
    }
    if timestamps.is_empty() {
        None
    } else {
        Some(Value::Object(timestamps))
    }
}

pub(super) fn timestamp_seconds(value: &str) -> Option<i64> {
    if let Ok(number) = value.parse::<i64>() {
        return Some(if number > 10_000_000_000 {
            number / 1000
        } else {
            number
        });
    }
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.timestamp())
}

fn create_activity_assets(
    big_icon: impl Into<String>,
    status_image: &str,
    status_name: &str,
) -> Option<Value> {
    let mut assets = Map::new();
    let big_icon = big_icon.into();
    if !big_icon.is_empty() {
        assets.insert("large_image".into(), Value::String(big_icon));
    }
    if !status_image.is_empty() {
        assets.insert("small_image".into(), Value::String(status_image.into()));
    }
    if !status_name.is_empty() {
        assets.insert("small_text".into(), Value::String(status_name.into()));
    }
    if assets.is_empty() {
        None
    } else {
        Some(Value::Object(assets))
    }
}

fn create_activity_party(
    party_id: impl Into<String>,
    party_size: i64,
    party_max_size: i64,
) -> Option<Value> {
    let party_id = party_id.into();
    if party_id.is_empty() || party_size <= 0 || party_max_size <= 0 {
        return None;
    }
    Some(json!({
        "id": party_id,
        "size": [party_size, party_max_size],
    }))
}

fn create_activity_buttons(
    button_text: impl Into<String>,
    button_url: impl Into<String>,
) -> Option<Value> {
    let button_text = button_text.into();
    let button_url = button_url.into();
    if button_text.is_empty() || button_url.is_empty() {
        return None;
    }
    Some(json!([{ "label": button_text, "url": button_url }]))
}

fn compact_object(value: Value) -> Value {
    let Some(object) = value.as_object() else {
        return value;
    };
    let compacted = object
        .iter()
        .filter_map(|(key, value)| {
            let keep = match value {
                Value::Null => false,
                Value::String(value) => !value.is_empty(),
                _ => true,
            };
            keep.then(|| (key.clone(), value.clone()))
        })
        .collect();
    Value::Object(compacted)
}

fn now_playing_has_content(now_playing: &Value) -> bool {
    string_field(now_playing, "url").is_some() || string_field(now_playing, "name").is_some()
}

fn now_playing_activity_times(now_playing: &Value) -> (String, String) {
    let start_time = string_field(now_playing, "startedAt")
        .or_else(|| string_field(now_playing, "created_at"))
        .unwrap_or_default();
    let Some(start_seconds) = timestamp_seconds(&start_time).filter(|value| *value > 0) else {
        return (start_time, String::new());
    };
    let length = int_field(now_playing, "length").unwrap_or(0);
    let end_time = if length > 0 {
        (start_seconds + length).to_string()
    } else {
        String::new()
    };
    (start_time, end_time)
}

fn is_popcorn_palace_world(world_id: &str) -> bool {
    matches!(
        world_id,
        "wrld_266523e8-9161-40da-acd0-6bd82e075833" | "wrld_27c7e6b2-d938-447e-a270-3d1a873e2cf3"
    )
}

fn rpc_world_config(world_id: &str) -> Option<RpcWorldConfig> {
    match world_id {
        "wrld_f20326da-f1ac-45fc-a062-609723b097b1"
        | "wrld_10e5e467-fc65-42ed-8957-f02cace1398c"
        | "wrld_04899f23-e182-4a8d-b2c7-2c74c7c15534" => Some(RpcWorldConfig {
            app_id: "784094509008551956",
            activity_type: 2,
            status_display_type: 2,
            big_icon: "pypy",
        }),
        "wrld_42377cf1-c54f-45ed-8996-5875b0573a83"
        | "wrld_dd6d2888-dbdc-47c2-bc98-3d631b2acd7c" => Some(RpcWorldConfig {
            app_id: "846232616054030376",
            activity_type: 2,
            status_display_type: 2,
            big_icon: "vr_dancing",
        }),
        "wrld_52bdcdab-11cd-4325-9655-0fb120846945"
        | "wrld_2d40da63-8f1f-4011-8a9e-414eb8530acd" => Some(RpcWorldConfig {
            app_id: "939473404808007731",
            activity_type: 2,
            status_display_type: 2,
            big_icon: "zuwa_zuwa_dance",
        }),
        "wrld_74970324-58e8-4239-a17b-2c59dfdf00db"
        | "wrld_db9d878f-6e76-4776-8bf2-15bcdd7fc445"
        | "wrld_435bbf25-f34f-4b8b-82c6-cd809057eb8e"
        | "wrld_f767d1c8-b249-4ecc-a56f-614e433682c8" => Some(RpcWorldConfig {
            app_id: "968292722391785512",
            activity_type: 3,
            status_display_type: 2,
            big_icon: "ls_media",
        }),
        "wrld_266523e8-9161-40da-acd0-6bd82e075833"
        | "wrld_27c7e6b2-d938-447e-a270-3d1a873e2cf3" => Some(RpcWorldConfig {
            app_id: "1095440531821170820",
            activity_type: 3,
            status_display_type: 2,
            big_icon: "popcorn_palace",
        }),
        _ => None,
    }
}
