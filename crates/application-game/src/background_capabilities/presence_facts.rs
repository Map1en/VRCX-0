use std::collections::{HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::location::{normalize_instance_type, parse_location, ParsedLocation};
use vrcx_0_persistence::DatabaseService;

use crate::{PlayerState, Result, RuntimeSnapshot};

use super::shared::{first_non_empty, non_empty, string_field, BackgroundCapabilitySession};

#[derive(Clone, Debug)]
pub struct BackgroundPresenceFactsInput {
    pub session: BackgroundCapabilitySession,
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub is_game_no_vr: bool,
    pub last_game_started_at: Option<String>,
    pub game_log_snapshot: RuntimeSnapshot,
    pub now_playing: Value,
    pub friends_by_id: HashMap<String, FriendRecord>,
    pub favorite_friend_groups_by_key: HashMap<String, Vec<String>>,
}
#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundPresenceFacts {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user: Value,
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub is_game_no_vr: bool,
    pub last_game_started_at: Option<String>,
    pub current_location: String,
    pub current_destination: String,
    pub current_location_started_at: String,
    pub parsed_location: ParsedLocation,
    pub instance_type: String,
    pub players: Vec<PresencePlayer>,
    pub player_count: usize,
    pub player_facts_known: bool,
    pub observed_player_event_count: usize,
    pub friend_count: usize,
    pub present_friend_ids: Vec<String>,
    pub present_favorite_group_keys: Vec<String>,
    pub can_invite_from_current_location: bool,
    pub world_name: String,
    pub now_playing: Value,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PresencePlayer {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
}

pub fn build_background_presence_facts(
    db: &DatabaseService,
    input: BackgroundPresenceFactsInput,
) -> Result<BackgroundPresenceFacts> {
    let current_user = ensure_current_user_id(
        input.session.current_user_snapshot,
        &input.session.current_user_id,
    );
    let game_snapshot = input.game_log_snapshot;
    let current_location = resolve_current_location(&game_snapshot, &current_user)
        .trim()
        .to_string();
    let parsed_location = parse_location(&current_location);
    let instance_type = normalize_instance_type(&parsed_location);
    let has_live_location = is_live_current_location(&current_location);
    let runtime_players = normalize_runtime_players(&game_snapshot.players);
    let runtime_player_count = runtime_players.len();
    let (players, observed_player_event_count) = if has_live_location && runtime_players.is_empty()
    {
        load_players_from_persistence(
            db,
            &input.session.current_user_id,
            &current_location,
            &game_snapshot.started_at,
        )?
    } else {
        (runtime_players, 0)
    };
    let player_facts_known =
        has_live_location && (runtime_player_count > 0 || observed_player_event_count > 0);
    let friend_ids: Vec<String> = players
        .iter()
        .filter_map(|player| {
            if !player.user_id.is_empty() && input.friends_by_id.contains_key(&player.user_id) {
                Some(player.user_id.clone())
            } else {
                None
            }
        })
        .collect();
    let present_favorite_group_keys = collect_present_favorite_group_keys(
        db,
        &input.session.current_user_id,
        &players,
        &input.favorite_friend_groups_by_key,
    )?;
    let can_invite_from_current_location = check_can_invite(
        &current_location,
        &parsed_location,
        &input.session.current_user_id,
    );

    Ok(BackgroundPresenceFacts {
        current_user_id: input.session.current_user_id,
        endpoint: input.session.endpoint,
        websocket: input.session.websocket,
        current_user,
        is_game_running: input.is_game_running,
        is_steamvr_running: input.is_steamvr_running,
        is_game_no_vr: input.is_game_no_vr,
        last_game_started_at: input.last_game_started_at,
        current_location,
        current_destination: game_snapshot.destination,
        current_location_started_at: game_snapshot.started_at,
        parsed_location,
        instance_type,
        player_count: players.len(),
        players,
        player_facts_known,
        observed_player_event_count,
        friend_count: friend_ids.len(),
        present_friend_ids: friend_ids,
        present_favorite_group_keys,
        can_invite_from_current_location,
        world_name: game_snapshot.world_name,
        now_playing: input.now_playing,
    })
}
fn ensure_current_user_id(mut current_user: Value, current_user_id: &str) -> Value {
    if let Some(object) = current_user.as_object_mut() {
        if !current_user_id.trim().is_empty() {
            object
                .entry("id")
                .or_insert_with(|| Value::String(current_user_id.trim().to_string()));
        }
    }
    current_user
}

fn resolve_current_location(snapshot: &RuntimeSnapshot, current_user: &Value) -> String {
    first_non_empty([
        snapshot.location.as_str(),
        snapshot.destination.as_str(),
        string_field(current_user, "$locationTag")
            .as_deref()
            .unwrap_or(""),
        string_field(current_user, "location")
            .as_deref()
            .unwrap_or(""),
        string_field(current_user, "worldId")
            .as_deref()
            .unwrap_or(""),
    ])
    .to_string()
}

fn normalize_runtime_players(players: &[PlayerState]) -> Vec<PresencePlayer> {
    players
        .iter()
        .enumerate()
        .filter_map(|(index, player)| {
            let user_id = player.user_id.trim().to_string();
            let display_name = player.display_name.trim().to_string();
            if user_id.is_empty() && display_name.is_empty() {
                return None;
            }
            Some(PresencePlayer {
                id: non_empty(&user_id, &format!("runtime:{index}")),
                user_id,
                display_name,
            })
        })
        .collect()
}

fn load_players_from_persistence(
    db: &DatabaseService,
    owner_user_id: &str,
    location: &str,
    started_at: &str,
) -> Result<(Vec<PresencePlayer>, usize)> {
    let rows = vrcx_0_persistence::player_list::player_list_join_leave_rows(
        db,
        owner_user_id,
        location.to_string(),
        started_at.to_string(),
    )?;
    let mut players: HashMap<String, PresencePlayer> = HashMap::new();
    let observed = rows.len();
    for (index, row) in rows.into_iter().enumerate() {
        let key = if row.user_id.trim().is_empty() {
            format!("display:{}", row.display_name)
        } else {
            row.user_id.clone()
        };
        if row.r#type == "OnPlayerLeft" {
            players.remove(&key);
        } else {
            players.insert(
                key,
                PresencePlayer {
                    id: non_empty(&row.user_id, &format!("persisted:{index}")),
                    user_id: row.user_id,
                    display_name: row.display_name,
                },
            );
        }
    }
    Ok((players.into_values().collect(), observed))
}

fn collect_present_favorite_group_keys(
    db: &DatabaseService,
    owner_user_id: &str,
    players: &[PresencePlayer],
    favorite_friend_groups_by_key: &HashMap<String, Vec<String>>,
) -> Result<Vec<String>> {
    let present_user_ids: HashSet<&str> = players
        .iter()
        .filter_map(|player| {
            if player.user_id.is_empty() {
                None
            } else {
                Some(player.user_id.as_str())
            }
        })
        .collect();
    if present_user_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut keys = HashSet::new();
    for (group_key, user_ids) in favorite_friend_groups_by_key {
        if user_ids
            .iter()
            .any(|user_id| present_user_ids.contains(user_id.as_str()))
        {
            keys.insert(group_key.clone());
        }
    }
    for row in
        vrcx_0_persistence::favorites::favorite_list(db, Some(owner_user_id), "friend".into())?
    {
        let user_id = string_field(&row, "userId").unwrap_or_default();
        let group_name = string_field(&row, "groupName").unwrap_or_default();
        if !group_name.is_empty() && present_user_ids.contains(user_id.as_str()) {
            keys.insert(format!("local:{group_name}"));
        }
    }
    let mut keys: Vec<String> = keys.into_iter().collect();
    keys.sort();
    Ok(keys)
}

fn check_can_invite(location: &str, parsed: &ParsedLocation, current_user_id: &str) -> bool {
    if location.is_empty()
        || !parsed.is_real_instance
        || parsed.world_id.is_empty()
        || parsed.instance_id.is_empty()
    {
        return false;
    }
    if parsed.access_type == "public" || parsed.access_type == "group" {
        return true;
    }
    if parsed.user_id.as_deref() == Some(current_user_id) {
        return true;
    }
    if parsed.access_type == "invite" || parsed.access_type == "friends" {
        return false;
    }
    true
}

fn is_live_current_location(location: &str) -> bool {
    let normalized = location.trim();
    !normalized.is_empty()
        && normalized != "offline"
        && normalized != "private"
        && normalized != "traveling"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_location_matches_group_plus_instance_type() {
        let parsed = parse_location("wrld_1:123~group(grp_1)~groupAccessType(plus)");

        assert_eq!(parsed.world_id, "wrld_1");
        assert_eq!(parsed.access_type, "group");
        assert_eq!(normalize_instance_type(&parsed), "groupPlus");
    }
}
