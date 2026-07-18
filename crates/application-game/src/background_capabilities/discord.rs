use serde::Serialize;
use serde_json::Value;
use vrcx_0_core::location::{parse_location, ParsedLocation};
use vrcx_0_core::vrchat_endpoints::VRCHAT_SITE_ORIGIN;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::groups::profile_get_input as group_profile_get_input;
use vrcx_0_vrchat_client::http_api::{normalize_vrchat_api_endpoint, ApiScope};
use vrcx_0_vrchat_client::worlds::world_get_input;

use crate::{Result, WebClient};

use super::presence_facts::BackgroundPresenceFacts;
use super::shared::{int_field, parse_response_json, string_field};

mod activity_builders;
#[cfg(test)]
mod tests;

use activity_builders::{build_discord_activity, build_running_fallback_activity};

const GAME_STOP_DISCORD_CLOSE_ATTEMPTS: u8 = 5;
#[derive(Clone, Debug, Default)]
pub struct BackgroundDiscordPresenceState {
    is_active: bool,
    last_game_running: bool,
    initial_non_game_cleanup_sent: bool,
    disabled_cleanup_sent: bool,
    close_attempts_remaining: u8,
    last_location_details: DiscordLocationDetails,
    last_payload: Option<BackgroundDiscordActivityPayload>,
}

impl BackgroundDiscordPresenceState {
    pub fn apply_set_active_result(&mut self, active: bool) {
        self.is_active = active;
        if !active {
            self.last_location_details = DiscordLocationDetails::default();
            self.last_payload = None;
        }
    }

    pub fn apply_set_assets_result(
        &mut self,
        payload: &BackgroundDiscordActivityPayload,
        active: bool,
    ) {
        self.is_active = active;
        self.last_payload = active.then(|| payload.clone());
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundDiscordActivityPayload {
    pub app_id: String,
    pub activity: Value,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscordPresenceLabels {
    pub access_public: String,
    pub access_invite_plus: String,
    pub access_invite: String,
    pub access_friends: String,
    pub access_friends_plus: String,
    pub access_group: String,
    pub group_access_public: String,
    pub group_access_plus: String,
    pub group_access_members: String,
    pub status_active: String,
    pub status_join_me: String,
    pub status_ask_me: String,
    pub status_busy: String,
    pub status_offline: String,
    pub platform_desktop: String,
    pub platform_vr: String,
    pub private_world: String,
}

impl Default for DiscordPresenceLabels {
    fn default() -> Self {
        Self {
            access_public: "Public".into(),
            access_invite_plus: "Invite+".into(),
            access_invite: "Invite".into(),
            access_friends: "Friends".into(),
            access_friends_plus: "Friends+".into(),
            access_group: "Group".into(),
            group_access_public: "Public".into(),
            group_access_plus: "Plus".into(),
            group_access_members: "Members".into(),
            status_active: "Active".into(),
            status_join_me: "Join Me".into(),
            status_ask_me: "Ask Me".into(),
            status_busy: "Do Not Disturb".into(),
            status_offline: "Offline".into(),
            platform_desktop: "Desktop".into(),
            platform_vr: "VR".into(),
            private_world: "Private World".into(),
        }
    }
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

pub async fn build_background_discord_presence_command(
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
    facts: &BackgroundPresenceFacts,
    labels: &DiscordPresenceLabels,
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
        let payload = build_running_fallback_activity(&discord_config, facts, labels);
        return Ok(set_assets_or_noop(state, payload, force));
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

    let payload =
        build_discord_activity(&discord_config, facts, labels, &location_details, &parsed);
    Ok(set_assets_or_noop(state, payload, force))
}

fn set_assets_or_noop(
    state: &BackgroundDiscordPresenceState,
    payload: BackgroundDiscordActivityPayload,
    force: bool,
) -> BackgroundDiscordPresenceCommand {
    if !force && state.is_active && state.last_payload.as_ref() == Some(&payload) {
        return BackgroundDiscordPresenceCommand::Noop {
            detail: "Discord activity is unchanged.".into(),
        };
    }
    BackgroundDiscordPresenceCommand::SetAssets { payload }
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
