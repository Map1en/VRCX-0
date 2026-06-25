use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_core::location::parse_location;
use vrcx_0_persistence::{
    favorites as persistence_favorites, friends as persistence_friends, local_moderation, memos,
    social_aggregates,
};

use crate::server::VrcxMcpServer;

use super::common::{
    map_persistence_error, require_current_user_id, social_aggregates_result, structured_result,
    TimeWindowParams,
};

#[tool_router(router = friends_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(description = "Return observed friend relationship events for this profile.")]
    async fn get_friend_log(
        &self,
        Parameters(input): Parameters<FriendLogParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.get_friend_log_output(owner_user_id, input)?)
    }

    #[tool(description = "Read private local friend notes; note text is returned to the AI.")]
    async fn get_friend_note(
        &self,
        Parameters(input): Parameters<FriendNoteParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.get_friend_note_output(input)?)
    }

    #[tool(description = "Save a private local friend note; dry_run defaults to true.")]
    async fn set_friend_note(
        &self,
        Parameters(input): Parameters<SetFriendNoteParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.set_friend_note_output(input)?)
    }
    #[tool(description = "Return a combined local profile summary for one friend.")]
    async fn get_friend_profile(
        &self,
        Parameters(input): Parameters<FriendProfileParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.get_friend_profile_output(owner_user_id, input)?)
    }
    #[tool(description = "Return observed friend status, avatar, or bio change aggregates.")]
    async fn get_friend_changes(
        &self,
        Parameters(input): Parameters<FriendChangesParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_friend_changes(
            self.runtime.db.as_ref(),
            social_aggregates::FriendChangesInput {
                owner_user_id,
                target_user_id: None,
                time_window: input.time_window.into(),
                kind: input.kind.into(),
                limit: input.limit,
            },
        ))
    }
}

impl VrcxMcpServer {
    fn get_friend_log_output(
        &self,
        owner_user_id: String,
        input: FriendLogParams,
    ) -> Result<social_aggregates::FriendLogOutput, String> {
        social_aggregates::get_friend_log(
            self.runtime.db.as_ref(),
            social_aggregates::FriendLogInput {
                owner_user_id,
                target_user_id: input.target_user_id,
                types: input.types.unwrap_or_default(),
                time_window: input.time_window.unwrap_or_default().into(),
                limit: input.limit,
            },
        )
        .map_err(map_persistence_error)
    }

    fn get_friend_note_output(&self, input: FriendNoteParams) -> Result<FriendNoteOutput, String> {
        let rows = match normalize_optional_text(input.user_id) {
            Some(user_id) => memos::memo_get_user(self.runtime.db.as_ref(), user_id)
                .map_err(map_persistence_error)?
                .into_iter()
                .map(FriendNoteRow::from)
                .collect(),
            None => memos::memo_list_users(self.runtime.db.as_ref())
                .map_err(map_persistence_error)?
                .into_iter()
                .map(FriendNoteRow::from)
                .collect(),
        };
        Ok(FriendNoteOutput {
            rows,
            caveats: friend_note_caveats(),
        })
    }

    fn set_friend_note_output(
        &self,
        input: SetFriendNoteParams,
    ) -> Result<SetFriendNoteOutput, String> {
        let user_id = input.user_id.trim().to_string();
        if user_id.is_empty() {
            return Err("set_friend_note requires userId".into());
        }
        if !user_id.starts_with("usr_") {
            return Err("set_friend_note userId must be a VRChat user id (usr_...)".into());
        }
        let note = input.note;
        let dry_run = input.dry_run.unwrap_or(true);
        if dry_run {
            return Ok(SetFriendNoteOutput {
                user_id,
                memo: note,
                edited_at: String::new(),
                dry_run: true,
                caveats: friend_note_caveats(),
            });
        }
        let saved = memos::memo_save_user(self.runtime.db.as_ref(), user_id, note)
            .map_err(map_persistence_error)?;
        Ok(SetFriendNoteOutput {
            user_id: saved.entity_id,
            memo: saved.memo,
            edited_at: saved.edited_at,
            dry_run: false,
            caveats: friend_note_caveats(),
        })
    }
    fn get_friend_profile_output(
        &self,
        owner_user_id: String,
        input: FriendProfileParams,
    ) -> Result<FriendProfileOutput, String> {
        let user_id = input.user_id.trim().to_string();
        if user_id.is_empty() {
            return Err("get_friend_profile requires userId".into());
        }
        let time_window_params = input.time_window.unwrap_or_default();
        let time_window: social_aggregates::TimeWindow = time_window_params.clone().into();
        let current = self
            .runtime
            .realtime_runtime
            .friend_snapshot()
            .and_then(|snapshot| snapshot.friends_by_id.get(&user_id).cloned())
            .map(|friend| {
                let parsed = parse_location(&friend.location);
                let display_name = friend.display_name_or_id();
                FriendProfileCurrent {
                    user_id: friend.id,
                    display_name,
                    state: friend.state_bucket,
                    location: friend.location,
                    world_id: parsed.world_id,
                    status: friend.status,
                    status_description: friend.status_description,
                    bio: friend.bio,
                    platform: if friend.platform.is_empty() {
                        friend.last_platform
                    } else {
                        friend.platform
                    },
                    current_avatar_name: friend.current_avatar_name,
                }
            });
        let note = memos::memo_get_user(self.runtime.db.as_ref(), user_id.clone())
            .map_err(map_persistence_error)?
            .map(FriendNoteRow::from);
        let moderation = local_moderation::local_moderation_get(
            self.runtime.db.as_ref(),
            owner_user_id.clone(),
            user_id.clone(),
        )
        .map_err(map_persistence_error)?
        .map(FriendModerationStatus::from);
        let relationship =
            self.friend_relationship_profile(&owner_user_id, &user_id, time_window_params.clone())?;
        let copresence = social_aggregates::get_copresence_summary(
            self.runtime.db.as_ref(),
            social_aggregates::CopresenceSummaryInput {
                time_window: time_window.clone(),
                group_by: social_aggregates::CopresenceGroupBy::Friend,
                min_minutes: None,
                owner_user_id: Some(owner_user_id.clone()),
                friends_only: false,
            },
        )
        .map_err(map_persistence_error)?
        .rows
        .into_iter()
        .find(|row| row.user_id == user_id);
        let activity_pattern = social_aggregates::get_friend_activity_pattern(
            self.runtime.db.as_ref(),
            social_aggregates::FriendActivityPatternInput {
                owner_user_id: owner_user_id.clone(),
                user_id: Some(user_id.clone()),
                time_window: time_window.clone(),
                bucket: social_aggregates::ActivityBucket::HourOfDay,
            },
        )
        .map_err(map_persistence_error)?
        .rows
        .into_iter()
        .next();
        let recent_changes = self.friend_profile_changes(&owner_user_id, &user_id, time_window)?;
        let latest_bio = latest_bio_from_changes(&recent_changes);
        let current = match current {
            Some(mut current) => {
                if current.bio.trim().is_empty() {
                    if let Some(bio) = latest_bio {
                        current.bio = bio;
                    }
                }
                Some(current)
            }
            None => fallback_friend_profile_current(&user_id, &relationship, latest_bio),
        };
        Ok(FriendProfileOutput {
            user_id: user_id.clone(),
            current,
            relationship,
            note,
            moderation,
            copresence,
            activity_pattern,
            recent_changes,
            favorite_groups: self.friend_favorite_groups(&user_id)?,
            caveats: vec![
                "Friend profile combines local VRCX-0 observations and current realtime memory; missing fields mean unobserved or not loaded.".into(),
                "When realtime friend memory is unavailable, current uses the latest observed local profile fields where possible.".into(),
                "Moderation status is read-only here; MCP does not execute block or mute actions.".into(),
            ],
        })
    }
    fn friend_relationship_profile(
        &self,
        owner_user_id: &str,
        user_id: &str,
        time_window: TimeWindowParams,
    ) -> Result<FriendRelationshipProfile, String> {
        let current = persistence_friends::friend_log_current_list(
            self.runtime.db.as_ref(),
            owner_user_id.to_string(),
        )
        .map_err(map_persistence_error)?
        .into_iter()
        .find(|row| row.user_id == user_id);
        let log = self.get_friend_log_output(
            owner_user_id.to_string(),
            FriendLogParams {
                target_user_id: Some(user_id.to_string()),
                types: None,
                time_window: Some(time_window),
                limit: Some(100),
            },
        )?;
        let friended_at = social_aggregates::get_friend_log_first_created_at(
            self.runtime.db.as_ref(),
            owner_user_id,
            user_id,
            "Friend",
        )
        .map_err(map_persistence_error)?;
        let display_name_changes = log
            .rows
            .iter()
            .filter(|row| row.kind == "DisplayName")
            .take(5)
            .cloned()
            .collect();
        let trust_changes = log
            .rows
            .iter()
            .filter(|row| row.kind == "TrustLevel")
            .take(5)
            .cloned()
            .collect();
        Ok(FriendRelationshipProfile {
            is_current_friend: current.is_some(),
            display_name: current
                .as_ref()
                .map(|row| row.display_name.clone())
                .unwrap_or_default(),
            trust_level: current
                .as_ref()
                .map(|row| row.trust_level.clone())
                .unwrap_or_default(),
            friend_number: current.as_ref().map(|row| row.friend_number),
            friended_at,
            recent_events: log.rows.into_iter().take(10).collect(),
            display_name_changes,
            trust_changes,
        })
    }

    fn friend_profile_changes(
        &self,
        owner_user_id: &str,
        user_id: &str,
        time_window: social_aggregates::TimeWindow,
    ) -> Result<Vec<FriendProfileChangeSummary>, String> {
        let mut rows = Vec::new();
        for kind in [
            social_aggregates::FriendChangeKind::Status,
            social_aggregates::FriendChangeKind::Avatar,
            social_aggregates::FriendChangeKind::Bio,
        ] {
            let output = social_aggregates::get_friend_changes(
                self.runtime.db.as_ref(),
                social_aggregates::FriendChangesInput {
                    owner_user_id: owner_user_id.to_string(),
                    target_user_id: Some(user_id.to_string()),
                    time_window: time_window.clone(),
                    kind: kind.clone(),
                    limit: Some(200),
                },
            )
            .map_err(map_persistence_error)?;
            if let Some(row) = output.rows.into_iter().find(|row| row.user_id == user_id) {
                rows.push(FriendProfileChangeSummary {
                    kind: friend_change_kind_name(&kind).into(),
                    change_count: row.change_count,
                    last_changed_at: row.last_changed_at,
                    recent_events: row.recent_events,
                });
            }
        }
        Ok(rows)
    }

    fn friend_favorite_groups(&self, user_id: &str) -> Result<Vec<String>, String> {
        let mut groups =
            persistence_favorites::favorite_list(self.runtime.db.as_ref(), "friend".into())
                .map_err(map_persistence_error)?
                .into_iter()
                .filter(|row| row.get("userId").and_then(Value::as_str) == Some(user_id))
                .filter_map(|row| {
                    row.get("groupName")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .filter(|group| !group.trim().is_empty())
                .collect::<Vec<_>>();
        groups.sort();
        groups.dedup();
        Ok(groups)
    }
}
#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum FriendChangeKindParam {
    #[default]
    Status,
    Avatar,
    Bio,
}

impl From<FriendChangeKindParam> for social_aggregates::FriendChangeKind {
    fn from(value: FriendChangeKindParam) -> Self {
        match value {
            FriendChangeKindParam::Status => Self::Status,
            FriendChangeKindParam::Avatar => Self::Avatar,
            FriendChangeKindParam::Bio => Self::Bio,
        }
    }
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FriendLogParams {
    target_user_id: Option<String>,
    types: Option<Vec<String>>,
    time_window: Option<TimeWindowParams>,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FriendNoteParams {
    user_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SetFriendNoteParams {
    user_id: String,
    note: String,
    dry_run: Option<bool>,
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FriendProfileParams {
    user_id: String,
    time_window: Option<TimeWindowParams>,
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FriendChangesParams {
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    kind: FriendChangeKindParam,
    limit: Option<i64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FriendNoteOutput {
    rows: Vec<FriendNoteRow>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FriendNoteRow {
    user_id: String,
    memo: String,
    edited_at: String,
}

impl From<memos::UserMemoOutput> for FriendNoteRow {
    fn from(value: memos::UserMemoOutput) -> Self {
        Self {
            user_id: value.user_id,
            memo: value.memo,
            edited_at: value.edited_at,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetFriendNoteOutput {
    user_id: String,
    memo: String,
    edited_at: String,
    dry_run: bool,
    caveats: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FriendProfileOutput {
    user_id: String,
    current: Option<FriendProfileCurrent>,
    relationship: FriendRelationshipProfile,
    note: Option<FriendNoteRow>,
    moderation: Option<FriendModerationStatus>,
    copresence: Option<social_aggregates::CopresenceSummaryRow>,
    activity_pattern: Option<social_aggregates::FriendActivityPatternRow>,
    recent_changes: Vec<FriendProfileChangeSummary>,
    favorite_groups: Vec<String>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FriendProfileCurrent {
    user_id: String,
    display_name: String,
    state: String,
    location: String,
    world_id: String,
    status: String,
    status_description: String,
    bio: String,
    platform: String,
    current_avatar_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FriendRelationshipProfile {
    is_current_friend: bool,
    display_name: String,
    trust_level: String,
    friend_number: Option<i64>,
    friended_at: Option<String>,
    recent_events: Vec<social_aggregates::FriendLogRow>,
    display_name_changes: Vec<social_aggregates::FriendLogRow>,
    trust_changes: Vec<social_aggregates::FriendLogRow>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FriendModerationStatus {
    user_id: String,
    updated_at: String,
    display_name: String,
    block: bool,
    mute: bool,
}

impl From<local_moderation::LocalModerationOutput> for FriendModerationStatus {
    fn from(value: local_moderation::LocalModerationOutput) -> Self {
        Self {
            user_id: value.user_id,
            updated_at: value.updated_at,
            display_name: value.display_name,
            block: value.block,
            mute: value.mute,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FriendProfileChangeSummary {
    kind: String,
    change_count: i64,
    last_changed_at: String,
    recent_events: Vec<social_aggregates::FriendChangeEvent>,
}
fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn friend_note_caveats() -> Vec<String> {
    vec!["Notes are your private local memos; reading them sends their text to the AI.".into()]
}
fn friend_change_kind_name(kind: &social_aggregates::FriendChangeKind) -> &'static str {
    match kind {
        social_aggregates::FriendChangeKind::Status => "status",
        social_aggregates::FriendChangeKind::Avatar => "avatar",
        social_aggregates::FriendChangeKind::Bio => "bio",
    }
}

fn latest_bio_from_changes(rows: &[FriendProfileChangeSummary]) -> Option<String> {
    rows.iter()
        .find(|row| row.kind == "bio")
        .and_then(|row| row.recent_events.first())
        .map(|event| event.new_value.clone())
        .filter(|value| !value.trim().is_empty())
}

fn fallback_friend_profile_current(
    user_id: &str,
    relationship: &FriendRelationshipProfile,
    bio: Option<String>,
) -> Option<FriendProfileCurrent> {
    let bio = bio.unwrap_or_default();
    if relationship.display_name.trim().is_empty() && bio.trim().is_empty() {
        return None;
    }
    Some(FriendProfileCurrent {
        user_id: user_id.to_string(),
        display_name: relationship.display_name.clone(),
        state: String::new(),
        location: String::new(),
        world_id: String::new(),
        status: String::new(),
        status_description: String::new(),
        bio,
        platform: String::new(),
        current_avatar_name: String::new(),
    })
}
