use serde::Serialize;
use serde_json::{json, Map, Value};
use vrcx_0_core::location::{launch_url, parse_location, ParsedLocation};
use vrcx_0_core::vrchat_endpoints::VRCHAT_SITE_ORIGIN;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::groups::profile_get_input as group_profile_get_input;
use vrcx_0_vrchat_client::http_api::{normalize_vrchat_api_endpoint, ApiScope};
use vrcx_0_vrchat_client::worlds::world_get_input;

use crate::{Result, WebClient};

use super::presence_facts::BackgroundPresenceFacts;
use super::shared::{first_non_empty, int_field, non_empty, parse_response_json, string_field};

const DEFAULT_APP_ID: &str = "1510639562177642557";
const GAME_STOP_DISCORD_CLOSE_ATTEMPTS: u8 = 5;
#[derive(Clone, Debug, Default)]
pub struct BackgroundDiscordPresenceState {
    is_active: bool,
    last_game_running: bool,
    initial_non_game_cleanup_sent: bool,
    disabled_cleanup_sent: bool,
    close_attempts_remaining: u8,
    last_location_details: DiscordLocationDetails,
}

impl BackgroundDiscordPresenceState {
    pub fn apply_set_active_result(&mut self, active: bool) {
        self.is_active = active;
        if !active {
            self.last_location_details = DiscordLocationDetails::default();
        }
    }

    pub fn apply_set_assets_result(&mut self, active: bool) {
        self.is_active = active;
    }
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundDiscordActivityPayload {
    pub app_id: String,
    pub activity: Value,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum BackgroundDiscordPresenceCommand {
    Noop {
        detail: String,
    },
    SetActive {
        active: bool,
        force: bool,
        detail: String,
    },
    SetAssets {
        payload: BackgroundDiscordActivityPayload,
    },
}
#[derive(Clone, Debug, Default)]
struct DiscordConfig {
    discord_active: bool,
    discord_instance: bool,
    discord_hide_invite: bool,
    discord_join_button: bool,
    discord_hide_image: bool,
    discord_show_platform: bool,
    discord_world_integration: bool,
    discord_world_name_as_discord_status: bool,
}

#[derive(Clone, Debug, Default)]
struct DiscordLocationDetails {
    tag: String,
    parsed: Option<ParsedLocation>,
    world_name: String,
    thumbnail_image_url: String,
    world_capacity: i64,
    world_link: String,
    group_name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RpcWorldConfig {
    app_id: &'static str,
    activity_type: i64,
    status_display_type: i64,
    big_icon: &'static str,
}
pub async fn build_background_discord_presence_command(
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
    facts: &BackgroundPresenceFacts,
    state: &mut BackgroundDiscordPresenceState,
    force: bool,
) -> Result<BackgroundDiscordPresenceCommand> {
    if !facts.is_game_running {
        if state.last_game_running {
            state.close_attempts_remaining = GAME_STOP_DISCORD_CLOSE_ATTEMPTS;
            state.last_location_details = DiscordLocationDetails::default();
            state.last_game_running = false;
        } else if !state.initial_non_game_cleanup_sent {
            state.initial_non_game_cleanup_sent = true;
            return Ok(BackgroundDiscordPresenceCommand::SetActive {
                active: false,
                force: true,
                detail: "Initial background Discord cleanup while VRChat is not running.".into(),
            });
        }

        if state.close_attempts_remaining > 0 {
            state.close_attempts_remaining = state.close_attempts_remaining.saturating_sub(1);
            return Ok(BackgroundDiscordPresenceCommand::SetActive {
                active: false,
                force: true,
                detail: "VRChat stopped; clearing Discord presence.".into(),
            });
        }
        if force || state.is_active {
            return Ok(BackgroundDiscordPresenceCommand::SetActive {
                active: false,
                force,
                detail: "VRChat is not running.".into(),
            });
        }
        return Ok(BackgroundDiscordPresenceCommand::Noop {
            detail: "VRChat is not running.".into(),
        });
    }

    state.last_game_running = true;
    state.initial_non_game_cleanup_sent = false;
    state.close_attempts_remaining = 0;
    let discord_config = load_discord_config(config)?;
    if !discord_config.discord_active {
        if force || state.is_active || !state.disabled_cleanup_sent {
            state.disabled_cleanup_sent = true;
            return Ok(BackgroundDiscordPresenceCommand::SetActive {
                active: false,
                force: true,
                detail: "Discord presence is disabled.".into(),
            });
        }
        return Ok(BackgroundDiscordPresenceCommand::Noop {
            detail: "Discord presence is disabled.".into(),
        });
    }
    state.disabled_cleanup_sent = false;

    let discord_location =
        if facts.current_location == "traveling" && !facts.current_destination.trim().is_empty() {
            facts.current_destination.trim()
        } else {
            facts.current_location.trim()
        };
    let parsed_discord_location = parse_location(discord_location);
    if !parsed_discord_location.is_real_instance {
        return Ok(BackgroundDiscordPresenceCommand::SetAssets {
            payload: build_running_fallback_activity(&discord_config, facts),
        });
    }

    let location_details =
        load_discord_location_details(web, db, facts, state, discord_location).await?;
    let Some(parsed) = location_details.parsed.clone() else {
        return Ok(BackgroundDiscordPresenceCommand::SetActive {
            active: false,
            force,
            detail: "Current location is not a Discord instance.".into(),
        });
    };

    Ok(BackgroundDiscordPresenceCommand::SetAssets {
        payload: build_discord_activity(&discord_config, facts, &location_details, &parsed),
    })
}

fn load_discord_config(config: &ConfigRepository) -> Result<DiscordConfig> {
    Ok(DiscordConfig {
        discord_active: config.get_bool("discordActive", false)?,
        discord_instance: config.get_bool("discordInstance", true)?,
        discord_hide_invite: config.get_bool("discordHideInvite", true)?,
        discord_join_button: config.get_bool("discordJoinButton", false)?,
        discord_hide_image: config.get_bool("discordHideImage", false)?,
        discord_show_platform: config.get_bool("discordShowPlatform", true)?,
        discord_world_integration: config.get_bool("discordWorldIntegration", true)?,
        discord_world_name_as_discord_status: config
            .get_bool("discordWorldNameAsDiscordStatus", false)?,
    })
}

fn build_running_fallback_activity(
    config: &DiscordConfig,
    facts: &BackgroundPresenceFacts,
) -> BackgroundDiscordActivityPayload {
    let status_info = status_info(
        string_field(&facts.current_user, "status").as_deref(),
        config.discord_hide_invite,
    );
    let platform = if config.discord_show_platform {
        platform_label(
            current_user_platform(&facts.current_user)
                .as_deref()
                .unwrap_or_default(),
            facts.is_game_running,
            !facts.is_steamvr_running,
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

async fn load_discord_location_details(
    web: &WebClient,
    db: &DatabaseService,
    facts: &BackgroundPresenceFacts,
    state: &mut BackgroundDiscordPresenceState,
    current_location: &str,
) -> Result<DiscordLocationDetails> {
    if state.last_location_details.tag == current_location
        && state.last_location_details.parsed.is_some()
    {
        return Ok(state.last_location_details.clone());
    }

    let parsed = parse_location(current_location);
    let mut details = DiscordLocationDetails {
        tag: parsed.tag.clone(),
        parsed: Some(parsed.clone()),
        ..Default::default()
    };
    if !parsed.world_id.is_empty() {
        let (_, request) = world_get_input(
            normalize_vrchat_api_endpoint(Some(&facts.endpoint)),
            parsed.world_id.clone(),
        )?;
        match web.execute_api(request, ApiScope::Vrchat, db).await {
            Ok(response) if (200..=299).contains(&response.status) => {
                if let Some(world) = parse_response_json(&response.data) {
                    details.world_name =
                        string_field(&world, "name").unwrap_or_else(|| parsed.world_id.clone());
                    details.thumbnail_image_url = string_field(&world, "thumbnailImageUrl")
                        .or_else(|| string_field(&world, "imageUrl"))
                        .unwrap_or_default();
                    details.world_capacity = int_field(&world, "capacity").unwrap_or(0);
                    if string_field(&world, "releaseStatus").as_deref() == Some("public") {
                        details.world_link =
                            format!("{VRCHAT_SITE_ORIGIN}/home/world/{}", parsed.world_id);
                    }
                }
            }
            Ok(response) => {
                tracing::warn!(
                    world_id = parsed.world_id,
                    status = response.status,
                    "background Discord world lookup failed"
                );
            }
            Err(error) => {
                tracing::warn!(
                    world_id = parsed.world_id,
                    error = %error,
                    "background Discord world lookup failed"
                );
            }
        }
        if details.world_name.is_empty() {
            details.world_name = if facts.world_name.trim().is_empty() {
                parsed.world_id.clone()
            } else {
                facts.world_name.clone()
            };
        }
    }

    if let Some(group_id) = parsed.group_id.as_ref().filter(|value| !value.is_empty()) {
        let (_, request) = group_profile_get_input(
            normalize_vrchat_api_endpoint(Some(&facts.endpoint)),
            group_id.clone(),
            false,
        )?;
        match web.execute_api(request, ApiScope::Vrchat, db).await {
            Ok(response) if (200..=299).contains(&response.status) => {
                if let Some(group) = parse_response_json(&response.data) {
                    details.group_name = string_field(&group, "name").unwrap_or_default();
                }
            }
            Ok(response) => {
                tracing::warn!(
                    group_id,
                    status = response.status,
                    "background Discord group lookup failed"
                );
            }
            Err(error) => {
                tracing::warn!(
                    group_id,
                    error = %error,
                    "background Discord group lookup failed"
                );
            }
        }
    }

    state.last_location_details = details.clone();
    Ok(details)
}

fn build_discord_activity(
    config: &DiscordConfig,
    facts: &BackgroundPresenceFacts,
    details: &DiscordLocationDetails,
    parsed: &ParsedLocation,
) -> BackgroundDiscordActivityPayload {
    let platform = if config.discord_show_platform {
        platform_label(
            current_user_platform(&facts.current_user)
                .as_deref()
                .unwrap_or_default(),
            facts.is_game_running,
            !facts.is_steamvr_running,
        )
    } else {
        String::new()
    };
    let access_name = build_access_name(parsed, &details.group_name, &platform);
    let status_info = status_info(
        string_field(&facts.current_user, "status").as_deref(),
        config.discord_hide_invite,
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
    let mut start_time = first_non_empty([
        facts.current_location_started_at.as_str(),
        facts.last_game_started_at.as_deref().unwrap_or(""),
    ])
    .to_string();
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
        details_text = "Private World".into();
        state_text.clear();
        start_time.clear();
        end_time.clear();
        app_id = DEFAULT_APP_ID.into();
        big_icon = "vrchat".into();
        activity_type = 0;
        status_display_type = 0;
    }

    if details_text.chars().count() < 2 {
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

fn platform_label(platform: &str, is_game_running: bool, is_game_no_vr: bool) -> String {
    if is_game_running {
        if is_game_no_vr {
            "(Desktop)".into()
        } else {
            "(VR)".into()
        }
    } else {
        match platform {
            "standalonewindows" | "windows" => "(PC)".into(),
            "android" => "(Android)".into(),
            "ios" => "(iOS)".into(),
            _ => String::new(),
        }
    }
}

#[derive(Clone, Copy)]
struct StatusInfo {
    status_name: &'static str,
    status_image: &'static str,
    hide_private: bool,
}

fn status_info(status: Option<&str>, hide_invite: bool) -> StatusInfo {
    match status.unwrap_or("active") {
        "join me" => StatusInfo {
            status_name: "Join Me",
            status_image: "joinme",
            hide_private: false,
        },
        "ask me" => StatusInfo {
            status_name: "Ask Me",
            status_image: "askme",
            hide_private: hide_invite,
        },
        "busy" => StatusInfo {
            status_name: "Busy",
            status_image: "busy",
            hide_private: true,
        },
        "offline" => StatusInfo {
            status_name: "Offline",
            status_image: "offline",
            hide_private: true,
        },
        _ => StatusInfo {
            status_name: "Active",
            status_image: "active",
            hide_private: false,
        },
    }
}

fn build_access_name(parsed: &ParsedLocation, group_name: &str, platform: &str) -> String {
    let suffix = format!("#{}{}", parsed.instance_name, platform);
    match parsed.access_type.as_str() {
        "public" => format!("Public {suffix}"),
        "invite+" => format!("Invite+ {suffix}"),
        "invite" => format!("Invite {suffix}"),
        "friends" => format!("Friends {suffix}"),
        "friends+" => format!("Friends+ {suffix}"),
        "group" => {
            let group_access = match parsed.group_access_type.as_deref() {
                Some("public") => "Public",
                Some("plus") => "Plus",
                Some("members") => "Members",
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
            format!("Group{group_suffix} {suffix}")
        }
        _ => String::new(),
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

fn timestamp_seconds(value: &str) -> Option<i64> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discord_non_game_tick_is_quiet_after_close_attempts() {
        let mut state = BackgroundDiscordPresenceState {
            last_game_running: true,
            is_active: true,
            ..Default::default()
        };
        let facts = BackgroundPresenceFacts {
            is_game_running: false,
            ..Default::default()
        };

        if !facts.is_game_running {
            if state.last_game_running {
                state.close_attempts_remaining = GAME_STOP_DISCORD_CLOSE_ATTEMPTS;
            }
            state.last_game_running = false;
        }

        assert_eq!(state.close_attempts_remaining, 5);
    }
    #[test]
    fn discord_rpc_world_uses_now_playing_details_and_thumbnail() {
        let config = DiscordConfig {
            discord_world_integration: true,
            discord_world_name_as_discord_status: true,
            discord_instance: true,
            discord_join_button: true,
            ..Default::default()
        };
        let facts = BackgroundPresenceFacts {
            is_game_running: true,
            current_location_started_at: "2026-05-19T00:00:00Z".into(),
            now_playing: json!({
                "url": "https://video.example/watch",
                "name": "Example Movie",
                "thumbnailUrl": "https://image.example/thumb.jpg",
                "startedAt": "2026-05-19T01:00:00Z",
                "length": 120,
            }),
            ..Default::default()
        };
        let parsed = parse_location("wrld_266523e8-9161-40da-acd0-6bd82e075833:12345");
        let details = DiscordLocationDetails {
            world_name: "Popcorn Palace".into(),
            thumbnail_image_url: "https://image.example/world.jpg".into(),
            world_capacity: 32,
            world_link: "https://vrchat.com/home/world/wrld_266523e8-9161-40da-acd0-6bd82e075833"
                .into(),
            parsed: Some(parsed.clone()),
            ..Default::default()
        };

        let payload = build_discord_activity(&config, &facts, &details, &parsed);
        let activity = payload.activity.as_object().unwrap();

        assert_eq!(payload.app_id, "1095440531821170820");
        assert_eq!(
            activity.get("details"),
            Some(&Value::String("Example Movie".into()))
        );
        assert_eq!(
            activity
                .get("assets")
                .and_then(|value| value.get("large_image")),
            Some(&Value::String("https://image.example/thumb.jpg".into()))
        );
        assert_eq!(
            activity
                .get("timestamps")
                .and_then(|value| value.get("start"))
                .and_then(Value::as_i64),
            timestamp_seconds("2026-05-19T01:00:00Z")
        );
        assert_eq!(
            activity
                .get("timestamps")
                .and_then(|value| value.get("end"))
                .and_then(Value::as_i64),
            timestamp_seconds("2026-05-19T01:02:00Z")
        );
    }
}
