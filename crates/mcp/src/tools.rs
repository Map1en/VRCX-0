use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Datelike, Duration, TimeZone, Utc};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application::vrchat_api::{self, favorites::favorite_add_input, VrchatScope};
use vrcx_0_application::{MutualGraphFetchStartInput, MutualGraphFetchStatus};
use vrcx_0_core::location::parse_location;
use vrcx_0_persistence::{
    activity, favorites, friends, local_moderation, memos, mutual_graph, social_aggregates,
};

use crate::config::MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY;
use crate::runtime::McpRuntime;
use crate::server::VrcxMcpServer;

impl VrcxMcpServer {
    pub(crate) fn new(runtime: McpRuntime) -> Self {
        Self {
            runtime,
            tool_router: Self::tool_router(),
        }
    }
}

#[tool_router(router = tool_router)]
impl VrcxMcpServer {
    #[tool(description = "Return observed co-presence summary facts for friends in a time window.")]
    async fn get_copresence_summary(
        &self,
        Parameters(input): Parameters<CopresenceSummaryParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = self.runtime.current_user_id().unwrap_or_default();
        social_aggregates_result(social_aggregates::get_copresence_summary(
            self.runtime.db.as_ref(),
            social_aggregates::CopresenceSummaryInput {
                time_window: input.time_window.into(),
                group_by: input.group_by.into(),
                min_minutes: input.min_minutes,
                owner_user_id: Some(owner_user_id),
                friends_only: input.friends_only,
            },
        ))
    }

    #[tool(description = "Return observed friend online activity buckets by hour or weekday.")]
    async fn get_friend_activity_pattern(
        &self,
        Parameters(input): Parameters<FriendActivityPatternParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_friend_activity_pattern(
            self.runtime.db.as_ref(),
            social_aggregates::FriendActivityPatternInput {
                owner_user_id,
                user_id: input.user_id,
                time_window: input.time_window.into(),
                bucket: input.bucket.into(),
            },
        ))
    }

    #[tool(description = "Search recently visited worlds from the local game log.")]
    async fn search_worlds_visited(
        &self,
        Parameters(input): Parameters<SearchWorldsVisitedParams>,
    ) -> Result<CallToolResult, String> {
        social_aggregates_result(social_aggregates::search_worlds_visited(
            self.runtime.db.as_ref(),
            social_aggregates::SearchWorldsVisitedInput {
                time_window: input.time_window.into(),
                limit: input.limit.unwrap_or(25),
            },
        ))
    }

    #[tool(description = "Return current realtime friend presence from VRCX-0 memory.")]
    async fn get_online_friends(
        &self,
        Parameters(input): Parameters<OnlineFriendsParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.get_online_friends_output(input))
    }

    #[tool(
        description = "Add or remove a VRCX-0 local favorite for a world, friend, or avatar; dry_run defaults to true."
    )]
    async fn favorite_local(
        &self,
        Parameters(input): Parameters<FavoriteLocalParams>,
    ) -> Result<CallToolResult, String> {
        social_aggregates_result(social_aggregates::favorite_local(
            self.runtime.db.as_ref(),
            social_aggregates::FavoriteLocalInput {
                kind: input.kind,
                entity_id: input.entity_id,
                group: input.group,
                action: input.action.unwrap_or_else(|| "add".into()),
                dry_run: input.dry_run.unwrap_or(true),
            },
        ))
    }

    #[tool(
        description = "Add a world, friend, or avatar favorite to the signed-in VRChat account; dry_run defaults to true."
    )]
    async fn favorite_vrchat(
        &self,
        Parameters(input): Parameters<FavoriteVrchatParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.favorite_vrchat_output(input).await?)
    }

    #[tool(description = "List VRCX-0 local favorites for worlds, friends, or avatars.")]
    async fn get_favorites(
        &self,
        Parameters(input): Parameters<GetFavoritesParams>,
    ) -> Result<CallToolResult, String> {
        structured_result(self.get_favorites_output(input)?)
    }

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

    #[tool(description = "Return aggregated activity for the current VRCX-0 profile.")]
    async fn get_my_activity(
        &self,
        Parameters(input): Parameters<MyActivityParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.get_my_activity_output(owner_user_id, input)?)
    }

    #[tool(description = "Return a combined local profile summary for one friend.")]
    async fn get_friend_profile(
        &self,
        Parameters(input): Parameters<FriendProfileParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.get_friend_profile_output(owner_user_id, input)?)
    }

    #[tool(description = "Refresh stale mutual-friend graph data with throttled VRChat API reads.")]
    async fn refresh_mutual_graph(
        &self,
        Parameters(input): Parameters<RefreshMutualGraphParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.refresh_mutual_graph_output(owner_user_id, input)?)
    }

    #[tool(description = "Return mutual-friend graph edges and connection degrees.")]
    async fn get_social_graph(
        &self,
        Parameters(input): Parameters<SocialGraphParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_social_graph(
            self.runtime.db.as_ref(),
            social_aggregates::SocialGraphInput {
                owner_user_id,
                user_id: input.user_id,
                depth: input.depth.unwrap_or(1),
            },
        ))
    }

    #[tool(description = "Infer visible companions of a friend from feed_gps overlap.")]
    async fn get_companions_of(
        &self,
        Parameters(input): Parameters<CompanionsOfParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_companions_of(
            self.runtime.db.as_ref(),
            social_aggregates::CompanionsOfInput {
                owner_user_id,
                user_id: input.user_id,
                time_window: input.time_window.into(),
                limit: input.limit,
            },
        ))
    }

    #[tool(description = "Return invite and request-invite notification aggregates.")]
    async fn get_invite_history(
        &self,
        Parameters(input): Parameters<InviteHistoryParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_invite_history(
            self.runtime.db.as_ref(),
            social_aggregates::InviteHistoryInput {
                owner_user_id,
                time_window: input.time_window.into(),
                direction: input.direction.into(),
                limit: input.limit,
            },
        ))
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

    #[tool(
        description = "Surface friends whose observed co-presence dropped sharply versus the prior equal-length window (fading relationships); defaults to the last 30 days versus the prior 30 days."
    )]
    async fn get_fading_friends(
        &self,
        Parameters(input): Parameters<FadingFriendsParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_fading_friends(
            self.runtime.db.as_ref(),
            self.fading_friends_input(owner_user_id, input),
        ))
    }

    #[tool(
        description = "Return the hour-of-day or weekday buckets where the most friends are observed coming online (best time to catch people)."
    )]
    async fn get_best_time_to_play(
        &self,
        Parameters(input): Parameters<BestTimeToPlayParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_best_time_to_play(
            self.runtime.db.as_ref(),
            social_aggregates::BestTimeToPlayInput {
                owner_user_id,
                time_window: input.time_window.into(),
                bucket: input.bucket.into(),
                limit: input.limit,
            },
        ))
    }

    #[tool(
        description = "Fuzzy-recall people from the local game log by name fragment, time window, world, or who they shared an instance with; includes non-friends."
    )]
    async fn recall_encounter(
        &self,
        Parameters(input): Parameters<RecallEncounterParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::recall_encounter(
            self.runtime.db.as_ref(),
            social_aggregates::RecallEncounterInput {
                owner_user_id,
                name_query: input.name_query,
                world_id: input.world_id,
                co_present_with_user_id: input.co_present_with_user_id,
                time_window: input.time_window.unwrap_or_default().into(),
                limit: input.limit,
            },
        ))
    }

    #[tool(
        description = "Return a structured social overview for a period (activity, top companions, new friends, fading friends, top worlds, best times) for the AI to narrate."
    )]
    async fn summarize_social_period(
        &self,
        Parameters(input): Parameters<SummarizeSocialPeriodParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        structured_result(self.summarize_social_period_output(owner_user_id, input)?)
    }
}

impl VrcxMcpServer {
    fn get_online_friends_output(&self, input: OnlineFriendsParams) -> OnlineFriendsOutput {
        let states = input
            .states
            .unwrap_or_else(|| vec!["online".to_string(), "active".to_string()]);
        let normalized_states = states
            .iter()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>();
        let include_location = input.include_location.unwrap_or(true);

        let mut rows = self
            .runtime
            .realtime_runtime
            .friend_snapshot()
            .into_iter()
            .flat_map(|snapshot| snapshot.friends_by_id.into_values())
            .filter(|friend| normalized_states.contains(&friend.state_bucket))
            .map(|friend| {
                let parsed = parse_location(&friend.location);
                let display_name = friend.display_name_or_id();
                let world_name = friend
                    .extra
                    .get("worldName")
                    .or_else(|| friend.extra.get("world_name"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                OnlineFriendRow {
                    user_id: friend.id,
                    display_name,
                    state: friend.state_bucket,
                    location: include_location.then_some(friend.location),
                    world_id: include_location.then_some(parsed.world_id),
                    world_name: include_location.then_some(world_name),
                    instance_access_type: include_location.then_some(
                        social_aggregates::normalize_access_bucket(&parsed.access_type),
                    ),
                    status: friend.status,
                    platform: if friend.platform.is_empty() {
                        friend.last_platform
                    } else {
                        friend.platform
                    },
                }
            })
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            left.display_name
                .cmp(&right.display_name)
                .then_with(|| left.user_id.cmp(&right.user_id))
        });

        OnlineFriendsOutput {
            rows,
            caveats: vec![
                "Realtime friend presence is maintained from the active VRChat websocket session."
                    .into(),
                "Location visibility still follows VRChat privacy rules; private instances may be redacted."
                    .into(),
            ],
        }
    }

    fn get_favorites_output(&self, input: GetFavoritesParams) -> Result<FavoritesOutput, String> {
        let kind = normalize_favorite_kind(&input.kind)?;
        let rows = favorites::favorite_list(self.runtime.db.as_ref(), kind.clone())
            .map_err(map_persistence_error)?
            .into_iter()
            .filter_map(|row| favorite_row_from_value(&kind, &row))
            .collect();
        Ok(FavoritesOutput {
            rows,
            caveats: vec![
                "Favorites are VRCX-0 local favorite rows and may differ from remote VRChat favorites until synced."
                    .into(),
            ],
        })
    }

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

    fn get_my_activity_output(
        &self,
        owner_user_id: String,
        input: MyActivityParams,
    ) -> Result<MyActivityOutput, String> {
        let time_window = input.time_window.unwrap_or_default().into();
        let bounds = time_window_bounds_ms(&time_window)?;
        let sessions = activity::activity_sessions_get(self.runtime.db.as_ref(), owner_user_id)
            .map_err(map_persistence_error)?;
        let mut session_count = 0usize;
        let mut total_ms = 0i64;
        let mut longest_ms = 0i64;
        let mut by_weekday = BTreeMap::new();
        for session in sessions {
            let start = bounds
                .from
                .map_or(session.start, |from| session.start.max(from));
            let end = bounds.to.map_or(session.end, |to| session.end.min(to));
            if end <= start {
                continue;
            }
            session_count += 1;
            let duration_ms = end - start;
            total_ms += duration_ms;
            longest_ms = longest_ms.max(duration_ms);
            if let Some(start_at) = DateTime::<Utc>::from_timestamp_millis(start) {
                *by_weekday
                    .entry(start_at.weekday().to_string())
                    .or_insert(0) += duration_ms / 60_000;
            }
        }
        let total_minutes = total_ms / 60_000;
        Ok(MyActivityOutput {
            total_minutes,
            session_count,
            avg_session_minutes: if session_count == 0 {
                0
            } else {
                total_minutes / session_count as i64
            },
            longest_session_minutes: longest_ms / 60_000,
            by_weekday,
            caveats: vec![
                "Activity sessions are derived from this profile's local VRCX-0 activity cache."
                    .into(),
            ],
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

    fn refresh_mutual_graph_output(
        &self,
        owner_user_id: String,
        input: RefreshMutualGraphParams,
    ) -> Result<RefreshMutualGraphOutput, String> {
        let status = self.runtime.mutual_graph_fetch.status();
        if is_active_fetch_status(&status.status) {
            return Ok(RefreshMutualGraphOutput::from_status(
                false,
                "already running",
                0,
                status,
            ));
        }
        let snapshot = self
            .runtime
            .realtime_runtime
            .friend_snapshot()
            .ok_or_else(|| {
                "refresh_mutual_graph requires a loaded realtime friend snapshot".to_string()
            })?;
        let graph = mutual_graph::mutual_graph_snapshot_get(
            self.runtime.db.as_ref(),
            owner_user_id.clone(),
        )
        .map_err(map_persistence_error)?;
        let freshness = mutual_graph_freshness(&graph.meta);
        let meta_by_friend_id = graph
            .meta
            .into_iter()
            .map(|meta| (meta.friend_id.clone(), meta))
            .collect::<HashMap<_, _>>();
        let force = input.force.unwrap_or(false);
        let max_age_hours = input.max_age_hours.unwrap_or(24).max(1) as i64;
        let stale_after = Utc::now() - Duration::hours(max_age_hours);
        let friend_ids = snapshot
            .friends_by_id
            .keys()
            .filter(|friend_id| {
                let meta = meta_by_friend_id.get(*friend_id);
                if meta.is_some_and(|meta| meta.opted_out) {
                    return false;
                }
                force || meta.is_none_or(|meta| is_stale_mutual_meta(meta, stale_after))
            })
            .cloned()
            .collect::<Vec<_>>();
        if friend_ids.is_empty() {
            return Ok(RefreshMutualGraphOutput {
                refreshed: false,
                reason: if force {
                    "no eligible friends"
                } else {
                    "already fresh"
                }
                .into(),
                selected_friend_count: 0,
                status: self.runtime.mutual_graph_fetch.status(),
                fetched_friends: freshness.fetched_friends,
                opted_out_friends: freshness.opted_out_friends,
                newest_fetched_at: freshness.newest_fetched_at,
                oldest_fetched_at: freshness.oldest_fetched_at,
                caveats: mutual_graph_refresh_caveats(),
            });
        }
        let status = self
            .runtime
            .mutual_graph_fetch
            .start(
                MutualGraphFetchStartInput {
                    owner_user_id,
                    endpoint: self.runtime.current_endpoint(),
                    friend_ids: friend_ids.clone(),
                },
                self.runtime.db.clone(),
                self.runtime.web.clone(),
                self.runtime.tasks.clone(),
            )
            .map_err(|error| error.to_string())?;
        Ok(RefreshMutualGraphOutput {
            refreshed: true,
            reason: "started".into(),
            selected_friend_count: friend_ids.len(),
            status,
            fetched_friends: freshness.fetched_friends,
            opted_out_friends: freshness.opted_out_friends,
            newest_fetched_at: freshness.newest_fetched_at,
            oldest_fetched_at: freshness.oldest_fetched_at,
            caveats: mutual_graph_refresh_caveats(),
        })
    }

    fn friend_relationship_profile(
        &self,
        owner_user_id: &str,
        user_id: &str,
        time_window: TimeWindowParams,
    ) -> Result<FriendRelationshipProfile, String> {
        let current =
            friends::friend_log_current_list(self.runtime.db.as_ref(), owner_user_id.to_string())
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
        let mut groups = favorites::favorite_list(self.runtime.db.as_ref(), "friend".into())
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

    async fn favorite_vrchat_output(
        &self,
        input: FavoriteVrchatParams,
    ) -> Result<FavoriteVrchatOutput, String> {
        let kind = normalize_favorite_kind(&input.kind)?;
        let entity_id = input.entity_id.trim().to_string();
        let tags = input.tags.trim().to_string();
        if entity_id.is_empty() {
            return Err("favorite_vrchat requires entityId".into());
        }
        validate_favorite_entity_id(&kind, &entity_id)?;
        if tags.is_empty() {
            return Err(
                "favorite_vrchat requires tags such as worlds1, group_0, or avatars1".into(),
            );
        }
        let requested_write = !input.dry_run.unwrap_or(true);
        let writes_allowed = self
            .runtime
            .config
            .get_bool(MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY, false)
            .unwrap_or(false);
        if !requested_write || !writes_allowed {
            return Ok(FavoriteVrchatOutput {
                kind,
                entity_id,
                tags,
                dry_run: true,
                status: None,
                response: None,
                caveats: vrchat_favorite_caveats(requested_write && !writes_allowed),
            });
        }

        let endpoint = self.runtime.current_endpoint();
        let (_, _, request) =
            favorite_add_input(endpoint, kind.clone(), entity_id.clone(), tags.clone())
                .map_err(|error| error.to_string())?;
        let response = vrchat_api::execute_api_command(
            self.runtime.web.as_ref(),
            self.runtime.db.as_ref(),
            &self.runtime.diagnostics,
            &self.runtime.sync,
            "mcp__favorite_vrchat",
            request,
            VrchatScope::Vrchat,
        )
        .await
        .map_err(|error| error.to_string())?;
        Ok(FavoriteVrchatOutput {
            kind,
            entity_id,
            tags,
            dry_run: false,
            status: Some(response.status),
            response: Some(response.raw),
            caveats: vrchat_favorite_caveats(false),
        })
    }

    fn fading_friends_input(
        &self,
        owner_user_id: String,
        input: FadingFriendsParams,
    ) -> social_aggregates::FadingFriendsInput {
        let recent_days = input.recent_days.unwrap_or(30).clamp(1, 365);
        let now = Utc::now();
        let pivot = now - Duration::days(recent_days);
        let prior_from = pivot - Duration::days(recent_days);
        social_aggregates::FadingFriendsInput {
            owner_user_id,
            prior_from: rfc3339_z(prior_from),
            pivot: rfc3339_z(pivot),
            now: rfc3339_z(now),
            min_prior_minutes: input.min_prior_minutes,
            limit: input.limit,
        }
    }

    fn summarize_social_period_output(
        &self,
        owner_user_id: String,
        input: SummarizeSocialPeriodParams,
    ) -> Result<SocialPeriodSummaryOutput, String> {
        let time_window_params = input.time_window.unwrap_or_default();
        let time_window: social_aggregates::TimeWindow = time_window_params.clone().into();
        let db = self.runtime.db.as_ref();

        let activity = self.get_my_activity_output(
            owner_user_id.clone(),
            MyActivityParams {
                time_window: Some(time_window_params.clone()),
            },
        )?;

        let mut top_companions = social_aggregates::get_copresence_summary(
            db,
            social_aggregates::CopresenceSummaryInput {
                time_window: time_window.clone(),
                group_by: social_aggregates::CopresenceGroupBy::Friend,
                min_minutes: None,
                owner_user_id: Some(owner_user_id.clone()),
                friends_only: true,
            },
        )
        .map_err(map_persistence_error)?
        .rows;
        top_companions.truncate(5);

        let new_friends = social_aggregates::get_friend_log(
            db,
            social_aggregates::FriendLogInput {
                owner_user_id: owner_user_id.clone(),
                target_user_id: None,
                types: vec!["Friend".into()],
                time_window: time_window.clone(),
                limit: Some(50),
            },
        )
        .map_err(map_persistence_error)?
        .rows;

        let fading_friends = social_aggregates::get_fading_friends(
            db,
            self.summary_fading_input(&owner_user_id, &time_window)?,
        )
        .map_err(map_persistence_error)?
        .rows
        .into_iter()
        .take(5)
        .collect();

        let top_worlds = summarize_world_visits(
            social_aggregates::search_worlds_visited(
                db,
                social_aggregates::SearchWorldsVisitedInput {
                    time_window: time_window.clone(),
                    limit: 100,
                },
            )
            .map_err(map_persistence_error)?
            .rows,
        );

        let best_times = social_aggregates::get_best_time_to_play(
            db,
            social_aggregates::BestTimeToPlayInput {
                owner_user_id,
                time_window: time_window.clone(),
                bucket: social_aggregates::ActivityBucket::HourOfDay,
                limit: Some(3),
            },
        )
        .map_err(map_persistence_error)?
        .rows;

        Ok(SocialPeriodSummaryOutput {
            period: TimeWindowEcho {
                from: time_window.from,
                to: time_window.to,
            },
            activity,
            top_companions,
            new_friends,
            fading_friends,
            top_worlds,
            best_times,
            caveats: vec![
                "This is a structured fact bundle for narration; all figures are observer-centered and undercount private instances.".into(),
                "fadingFriends compares the recent half of the period against the earlier half (or the last 30 days versus the prior 30 when no period is given).".into(),
            ],
        })
    }

    fn summary_fading_input(
        &self,
        owner_user_id: &str,
        time_window: &social_aggregates::TimeWindow,
    ) -> Result<social_aggregates::FadingFriendsInput, String> {
        let bounds = time_window_bounds_ms(time_window)?;
        let (prior_from, pivot, now) = match (bounds.from, bounds.to) {
            (Some(from), Some(to)) if to > from => {
                let mid = from + (to - from) / 2;
                (
                    ms_to_rfc3339_z(from),
                    ms_to_rfc3339_z(mid),
                    ms_to_rfc3339_z(to),
                )
            }
            _ => {
                let now = Utc::now();
                let pivot = now - Duration::days(30);
                let prior_from = pivot - Duration::days(30);
                (rfc3339_z(prior_from), rfc3339_z(pivot), rfc3339_z(now))
            }
        };
        Ok(social_aggregates::FadingFriendsInput {
            owner_user_id: owner_user_id.to_string(),
            prior_from,
            pivot,
            now,
            min_prior_minutes: None,
            limit: Some(10),
        })
    }
}

#[derive(Clone, Debug, Default, schemars::JsonSchema)]
struct TimeWindowParams {
    from: Option<String>,
    to: Option<String>,
}

impl<'de> Deserialize<'de> for TimeWindowParams {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        // Accept the documented object form `{from, to}` but also tolerate a
        // bare natural-language string (e.g. "this week") that models often pass
        // despite the schema. Unrecognized strings fall back to all history.
        let value = Value::deserialize(deserializer)?;
        Ok(time_window_from_value(&value))
    }
}

impl From<TimeWindowParams> for social_aggregates::TimeWindow {
    fn from(value: TimeWindowParams) -> Self {
        Self {
            from: value.from,
            to: value.to,
        }
    }
}

fn time_window_from_value(value: &Value) -> TimeWindowParams {
    match value {
        Value::String(text) => parse_relative_window(text),
        Value::Object(map) => TimeWindowParams {
            from: map
                .get("from")
                .and_then(Value::as_str)
                .and_then(normalize_time_bound),
            to: map
                .get("to")
                .and_then(Value::as_str)
                .and_then(normalize_time_bound),
        },
        _ => TimeWindowParams::default(),
    }
}

/// Coerce a single `from`/`to` bound into RFC3339, since models pass shorthand
/// (`7d`, `now`), date-only (`2025-07-11`), or timezone-less datetimes despite
/// the schema. Returns `None` (unbounded) for anything unparseable so the tool
/// never sees an invalid RFC3339 string.
fn normalize_time_bound(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if DateTime::parse_from_rfc3339(trimmed).is_ok() {
        return Some(trimmed.to_string());
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered == "now" || lowered == "today" {
        return Some(Utc::now().to_rfc3339());
    }
    if let Ok(date) = chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        let naive = date.and_time(chrono::NaiveTime::MIN);
        return Some(Utc.from_utc_datetime(&naive).to_rfc3339());
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Some(Utc.from_utc_datetime(&naive).to_rfc3339());
        }
    }
    if let Some(duration) = parse_duration(&lowered) {
        return Some((Utc::now() - duration).to_rfc3339());
    }
    tracing::warn!(input = %raw, "assistant: unrecognized time bound, ignoring");
    None
}

fn parse_relative_window(text: &str) -> TimeWindowParams {
    let normalized = text.trim().to_ascii_lowercase();
    let now = Utc::now();
    let rfc = |dt: DateTime<Utc>| Some(dt.to_rfc3339());
    let window = |from, to| TimeWindowParams { from, to };

    match normalized.as_str() {
        "" | "all" | "all time" | "alltime" | "any" | "anytime" | "ever" | "always" => {
            return TimeWindowParams::default();
        }
        "today" => return window(rfc(start_of_day(now)), None),
        "yesterday" => {
            let start_today = start_of_day(now);
            return window(rfc(start_today - Duration::days(1)), rfc(start_today));
        }
        "this week" | "week" => return window(rfc(start_of_week(now)), None),
        "last week" | "past week" | "previous week" => {
            let this = start_of_week(now);
            return window(rfc(this - Duration::days(7)), rfc(this));
        }
        "this month" | "month" => return window(rfc(start_of_month(now)), None),
        "last month" | "past month" | "previous month" => {
            return window(rfc(start_of_prev_month(now)), rfc(start_of_month(now)));
        }
        _ => {}
    }

    if let Some(window) = parse_rolling_window(&normalized, now) {
        return window;
    }

    tracing::warn!(input = %text, "assistant: unrecognized time window string, using all history");
    TimeWindowParams::default()
}

fn parse_rolling_window(text: &str, now: DateTime<Utc>) -> Option<TimeWindowParams> {
    let duration = parse_duration(text)?;
    Some(TimeWindowParams {
        from: Some((now - duration).to_rfc3339()),
        to: None,
    })
}

/// Parse a duration from word forms (`7 days`, `last 3 weeks`) or compact forms
/// (`7d`, `2w`, `3mo`, `24h`, `1y`). Bare `m` is read as months — the common
/// intent for social-history windows. `text` is expected to be lowercased.
fn parse_duration(text: &str) -> Option<Duration> {
    let number: i64 = text
        .split(|ch: char| !ch.is_ascii_digit())
        .find(|token| !token.is_empty())
        .and_then(|token| token.parse().ok())?;
    let compact = compact_unit(text);
    if text.contains("hour") || compact == Some('h') {
        Some(Duration::hours(number))
    } else if text.contains("week") || compact == Some('w') {
        Some(Duration::days(number * 7))
    } else if text.contains("mo") || compact == Some('m') {
        Some(Duration::days(number * 30))
    } else if text.contains("year") || compact == Some('y') {
        Some(Duration::days(number * 365))
    } else if text.contains("day") || compact == Some('d') {
        Some(Duration::days(number))
    } else {
        None
    }
}

/// First alphabetic character that immediately follows a digit, e.g. `d` in
/// `7d`. Used to read compact duration units.
fn compact_unit(text: &str) -> Option<char> {
    let mut seen_digit = false;
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            seen_digit = true;
        } else if seen_digit && ch.is_ascii_alphabetic() {
            return Some(ch);
        }
    }
    None
}

fn start_of_day(now: DateTime<Utc>) -> DateTime<Utc> {
    now.date_naive()
        .and_hms_opt(0, 0, 0)
        .map(|naive| Utc.from_utc_datetime(&naive))
        .unwrap_or(now)
}

fn start_of_week(now: DateTime<Utc>) -> DateTime<Utc> {
    let days = now.weekday().num_days_from_monday() as i64;
    start_of_day(now) - Duration::days(days)
}

fn start_of_month(now: DateTime<Utc>) -> DateTime<Utc> {
    now.date_naive()
        .with_day(1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|naive| Utc.from_utc_datetime(&naive))
        .unwrap_or(now)
}

fn start_of_prev_month(now: DateTime<Utc>) -> DateTime<Utc> {
    let last_day_prev = start_of_month(now) - Duration::days(1);
    start_of_month(last_day_prev)
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum CopresenceGroupByParam {
    #[default]
    Friend,
    FriendWorld,
}

impl From<CopresenceGroupByParam> for social_aggregates::CopresenceGroupBy {
    fn from(value: CopresenceGroupByParam) -> Self {
        match value {
            CopresenceGroupByParam::Friend => Self::Friend,
            CopresenceGroupByParam::FriendWorld => Self::FriendWorld,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum ActivityBucketParam {
    #[default]
    HourOfDay,
    DayOfWeek,
}

impl From<ActivityBucketParam> for social_aggregates::ActivityBucket {
    fn from(value: ActivityBucketParam) -> Self {
        match value {
            ActivityBucketParam::HourOfDay => Self::HourOfDay,
            ActivityBucketParam::DayOfWeek => Self::DayOfWeek,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum InviteDirectionParam {
    Received,
    Sent,
    #[default]
    Both,
}

impl From<InviteDirectionParam> for social_aggregates::InviteDirection {
    fn from(value: InviteDirectionParam) -> Self {
        match value {
            InviteDirectionParam::Received => Self::Received,
            InviteDirectionParam::Sent => Self::Sent,
            InviteDirectionParam::Both => Self::Both,
        }
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
struct CopresenceSummaryParams {
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    group_by: CopresenceGroupByParam,
    min_minutes: Option<i64>,
    #[serde(default)]
    friends_only: bool,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FriendActivityPatternParams {
    user_id: Option<String>,
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    bucket: ActivityBucketParam,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SearchWorldsVisitedParams {
    #[serde(default)]
    time_window: TimeWindowParams,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct OnlineFriendsParams {
    states: Option<Vec<String>>,
    include_location: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FavoriteLocalParams {
    kind: String,
    entity_id: String,
    group: String,
    action: Option<String>,
    dry_run: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FavoriteVrchatParams {
    kind: String,
    entity_id: String,
    tags: String,
    dry_run: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct GetFavoritesParams {
    kind: String,
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
struct MyActivityParams {
    time_window: Option<TimeWindowParams>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FriendProfileParams {
    user_id: String,
    time_window: Option<TimeWindowParams>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RefreshMutualGraphParams {
    force: Option<bool>,
    max_age_hours: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SocialGraphParams {
    user_id: Option<String>,
    depth: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CompanionsOfParams {
    user_id: String,
    #[serde(default)]
    time_window: TimeWindowParams,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct InviteHistoryParams {
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    direction: InviteDirectionParam,
    limit: Option<i64>,
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

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FadingFriendsParams {
    recent_days: Option<i64>,
    min_prior_minutes: Option<i64>,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct BestTimeToPlayParams {
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    bucket: ActivityBucketParam,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RecallEncounterParams {
    name_query: Option<String>,
    world_id: Option<String>,
    co_present_with_user_id: Option<String>,
    time_window: Option<TimeWindowParams>,
    limit: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SummarizeSocialPeriodParams {
    time_window: Option<TimeWindowParams>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OnlineFriendsOutput {
    rows: Vec<OnlineFriendRow>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OnlineFriendRow {
    user_id: String,
    display_name: String,
    state: String,
    location: Option<String>,
    world_id: Option<String>,
    world_name: Option<String>,
    instance_access_type: Option<String>,
    status: String,
    platform: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoritesOutput {
    rows: Vec<FavoriteRow>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteRow {
    kind: String,
    entity_id: String,
    group: String,
    created_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteVrchatOutput {
    kind: String,
    entity_id: String,
    tags: String,
    dry_run: bool,
    status: Option<i32>,
    response: Option<Value>,
    caveats: Vec<String>,
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
struct MyActivityOutput {
    total_minutes: i64,
    session_count: usize,
    avg_session_minutes: i64,
    longest_session_minutes: i64,
    by_weekday: BTreeMap<String, i64>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SocialPeriodSummaryOutput {
    period: TimeWindowEcho,
    activity: MyActivityOutput,
    top_companions: Vec<social_aggregates::CopresenceSummaryRow>,
    new_friends: Vec<social_aggregates::FriendLogRow>,
    fading_friends: Vec<social_aggregates::FadingFriendRow>,
    top_worlds: Vec<WorldVisitSummary>,
    best_times: Vec<social_aggregates::BestTimeBucketRow>,
    caveats: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TimeWindowEcho {
    from: Option<String>,
    to: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldVisitSummary {
    world_id: String,
    world_name: String,
    visits: i64,
    total_minutes: i64,
    last_visited_at: String,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshMutualGraphOutput {
    refreshed: bool,
    reason: String,
    selected_friend_count: usize,
    status: MutualGraphFetchStatus,
    fetched_friends: usize,
    opted_out_friends: usize,
    newest_fetched_at: Option<String>,
    oldest_fetched_at: Option<String>,
    caveats: Vec<String>,
}

impl RefreshMutualGraphOutput {
    fn from_status(
        refreshed: bool,
        reason: impl Into<String>,
        selected_friend_count: usize,
        status: MutualGraphFetchStatus,
    ) -> Self {
        Self {
            refreshed,
            reason: reason.into(),
            selected_friend_count,
            status,
            fetched_friends: 0,
            opted_out_friends: 0,
            newest_fetched_at: None,
            oldest_fetched_at: None,
            caveats: mutual_graph_refresh_caveats(),
        }
    }
}

struct TimeWindowBoundsMs {
    from: Option<i64>,
    to: Option<i64>,
}

struct MutualGraphFreshness {
    fetched_friends: usize,
    opted_out_friends: usize,
    newest_fetched_at: Option<String>,
    oldest_fetched_at: Option<String>,
}

fn normalize_favorite_kind(kind: &str) -> Result<String, String> {
    // The tool description lists "worlds, friends, or avatars", so models often
    // pass the plural (and sometimes "user(s)" for friends). Accept those and
    // map them to the canonical singular form.
    let lowered = kind.trim().to_ascii_lowercase();
    let canonical = match lowered.strip_suffix('s').unwrap_or(&lowered) {
        "world" => "world",
        "friend" | "user" => "friend",
        "avatar" => "avatar",
        _ => return Err("favorite kind must be world, friend, or avatar".into()),
    };
    Ok(canonical.to_string())
}

fn validate_favorite_entity_id(kind: &str, entity_id: &str) -> Result<(), String> {
    let metadata =
        favorite_kind_metadata(kind).ok_or("favorite kind must be world, friend, or avatar")?;
    if entity_id.starts_with(metadata.entity_id_prefix) {
        Ok(())
    } else {
        Err(format!(
            "favorite_vrchat {kind} entityId must start with {}",
            metadata.entity_id_prefix
        ))
    }
}

fn favorite_row_from_value(kind: &str, row: &Value) -> Option<FavoriteRow> {
    let metadata = favorite_kind_metadata(kind)?;
    let entity_id = row
        .get(metadata.entity_id_key)
        .and_then(Value::as_str)?
        .to_string();
    Some(FavoriteRow {
        kind: kind.to_string(),
        entity_id,
        group: row
            .get("groupName")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        created_at: row
            .get("created_at")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

struct FavoriteKindMetadata {
    entity_id_key: &'static str,
    entity_id_prefix: &'static str,
}

fn favorite_kind_metadata(kind: &str) -> Option<FavoriteKindMetadata> {
    match kind {
        "world" => Some(FavoriteKindMetadata {
            entity_id_key: "worldId",
            entity_id_prefix: "wrld_",
        }),
        "friend" => Some(FavoriteKindMetadata {
            entity_id_key: "userId",
            entity_id_prefix: "usr_",
        }),
        "avatar" => Some(FavoriteKindMetadata {
            entity_id_key: "avatarId",
            entity_id_prefix: "avtr_",
        }),
        _ => None,
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn friend_note_caveats() -> Vec<String> {
    vec!["Notes are your private local memos; reading them sends their text to the AI.".into()]
}

fn time_window_bounds_ms(
    time_window: &social_aggregates::TimeWindow,
) -> Result<TimeWindowBoundsMs, String> {
    Ok(TimeWindowBoundsMs {
        from: time_window
            .from
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_rfc3339_ms)
            .transpose()?,
        to: time_window
            .to
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_rfc3339_ms)
            .transpose()?,
    })
}

fn parse_rfc3339_ms(value: &str) -> Result<i64, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis())
        .map_err(|error| format!("invalid RFC3339 time '{value}': {error}"))
}

fn rfc3339_z(value: DateTime<Utc>) -> String {
    value.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn ms_to_rfc3339_z(millis: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(millis)
        .map(rfc3339_z)
        .unwrap_or_default()
}

fn summarize_world_visits(rows: Vec<social_aggregates::VisitedWorldRow>) -> Vec<WorldVisitSummary> {
    let mut grouped: HashMap<String, WorldVisitSummary> = HashMap::new();
    for row in rows {
        let key = if row.world_id.is_empty() {
            row.location.clone()
        } else {
            row.world_id.clone()
        };
        if key.is_empty() {
            continue;
        }
        let entry = grouped.entry(key).or_insert_with(|| WorldVisitSummary {
            world_id: row.world_id.clone(),
            world_name: row.world_name.clone(),
            visits: 0,
            total_minutes: 0,
            last_visited_at: String::new(),
        });
        if entry.world_name.is_empty() && !row.world_name.is_empty() {
            entry.world_name = row.world_name.clone();
        }
        entry.visits += 1;
        entry.total_minutes += row.stay_minutes.max(0);
        if row.visited_at > entry.last_visited_at {
            entry.last_visited_at = row.visited_at;
        }
    }
    let mut worlds = grouped.into_values().collect::<Vec<_>>();
    worlds.sort_by(|left, right| {
        right
            .visits
            .cmp(&left.visits)
            .then_with(|| right.total_minutes.cmp(&left.total_minutes))
            .then_with(|| left.world_name.cmp(&right.world_name))
    });
    worlds.truncate(5);
    worlds
}

fn mutual_graph_freshness(meta: &[mutual_graph::MutualGraphMetaOutput]) -> MutualGraphFreshness {
    let mut freshness = MutualGraphFreshness {
        fetched_friends: 0,
        opted_out_friends: 0,
        newest_fetched_at: None,
        oldest_fetched_at: None,
    };
    for row in meta {
        if row.opted_out {
            freshness.opted_out_friends += 1;
            continue;
        }
        if row.last_fetched_at.trim().is_empty() {
            continue;
        }
        freshness.fetched_friends += 1;
        freshness.newest_fetched_at = Some(match freshness.newest_fetched_at {
            Some(current) => current.max(row.last_fetched_at.clone()),
            None => row.last_fetched_at.clone(),
        });
        freshness.oldest_fetched_at = Some(match freshness.oldest_fetched_at {
            Some(current) => current.min(row.last_fetched_at.clone()),
            None => row.last_fetched_at.clone(),
        });
    }
    freshness
}

fn is_stale_mutual_meta(
    meta: &mutual_graph::MutualGraphMetaOutput,
    stale_after: DateTime<Utc>,
) -> bool {
    DateTime::parse_from_rfc3339(&meta.last_fetched_at)
        .map(|value| value.with_timezone(&Utc) < stale_after)
        .unwrap_or(true)
}

fn is_active_fetch_status(status: &str) -> bool {
    matches!(status, "running" | "cancelling")
}

fn mutual_graph_refresh_caveats() -> Vec<String> {
    vec![
        "This triggers throttled VRChat API reads and updates only local mutual graph snapshots.".into(),
        "Large friend lists can take a long time; friends who opt out of Shared Connections are skipped.".into(),
    ]
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

fn map_persistence_error(error: vrcx_0_persistence::Error) -> String {
    match error {
        vrcx_0_persistence::Error::InvalidData(message) => message,
        other => {
            tracing::warn!("MCP persistence query failed: {other}");
            "internal data error while reading local VRCX-0 data".into()
        }
    }
}

fn structured_result(value: impl Serialize) -> Result<CallToolResult, String> {
    serde_json::to_value(value)
        .map(CallToolResult::structured)
        .map_err(|error| format!("serialize MCP tool result: {error}"))
}

fn social_aggregates_result<T: Serialize>(
    result: Result<T, vrcx_0_persistence::Error>,
) -> Result<CallToolResult, String> {
    match result {
        Ok(value) => structured_result(value),
        Err(vrcx_0_persistence::Error::InvalidData(message)) => Err(message),
        Err(error) => {
            tracing::warn!("MCP social query failed: {error}");
            Err("internal data error while reading local VRCX-0 data".into())
        }
    }
}

fn require_current_user_id(runtime: &McpRuntime) -> Result<String, String> {
    runtime
        .current_user_id()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "This tool requires an active realtime VRChat session (current user unknown).".into()
        })
}

fn vrchat_favorite_caveats(blocked_by_setting: bool) -> Vec<String> {
    let mut caveats = vec![
        "This writes to the signed-in VRChat account only when dry_run is false.".into(),
        "VRChat favorite groups have capacity limits and API failures are returned as-is.".into(),
    ];
    if blocked_by_setting {
        caveats.push(
            "A real write was requested but VRChat writes are disabled; enable them in VRCX-0 settings first."
                .into(),
        );
    }
    caveats
}

#[cfg(test)]
mod favorite_kind_tests {
    use super::*;

    #[test]
    fn accepts_singular_plural_and_user_synonym() {
        for input in ["world", "worlds", "World"] {
            assert_eq!(normalize_favorite_kind(input).unwrap(), "world");
        }
        for input in ["friend", "friends", "user", "users"] {
            assert_eq!(normalize_favorite_kind(input).unwrap(), "friend");
        }
        for input in ["avatar", "avatars"] {
            assert_eq!(normalize_favorite_kind(input).unwrap(), "avatar");
        }
    }

    #[test]
    fn rejects_unknown_kind() {
        assert!(normalize_favorite_kind("group").is_err());
        assert!(normalize_favorite_kind("").is_err());
    }
}

#[cfg(test)]
mod time_window_tests {
    use super::*;

    #[test]
    fn parses_object_form() {
        let value = serde_json::json!({ "from": "2026-01-01T00:00:00Z", "to": null });
        let window = time_window_from_value(&value);
        assert_eq!(window.from.as_deref(), Some("2026-01-01T00:00:00Z"));
        assert_eq!(window.to, None);
    }

    #[test]
    fn relative_strings_produce_a_lower_bound() {
        for phrase in [
            "today",
            "this week",
            "last month",
            "last 7 days",
            "past 3 weeks",
        ] {
            let window = time_window_from_value(&serde_json::json!(phrase));
            assert!(window.from.is_some(), "{phrase} should set a lower bound");
        }
    }

    #[test]
    fn all_history_phrases_stay_empty() {
        for phrase in ["all", "all time", "ever", ""] {
            let window = time_window_from_value(&serde_json::json!(phrase));
            assert!(
                window.from.is_none() && window.to.is_none(),
                "{phrase} should be unbounded"
            );
        }
    }

    #[test]
    fn unknown_string_falls_back_to_all_history() {
        let window = time_window_from_value(&serde_json::json!("whenever-ish"));
        assert!(window.from.is_none() && window.to.is_none());
    }

    #[test]
    fn object_bounds_are_coerced_to_rfc3339() {
        // Shorthand, date-only, and "now" must all become valid RFC3339.
        for value in [
            serde_json::json!({ "from": "7d" }),
            serde_json::json!({ "from": "7d", "to": "now" }),
            serde_json::json!({ "from": "2025-07-11", "to": "2025-07-18" }),
            serde_json::json!({ "from": "2025-07-11T10:00:00" }),
        ] {
            let window = time_window_from_value(&value);
            for bound in [window.from.as_deref(), window.to.as_deref()] {
                if let Some(bound) = bound {
                    assert!(
                        DateTime::parse_from_rfc3339(bound).is_ok(),
                        "bound '{bound}' should be valid RFC3339"
                    );
                }
            }
            assert!(
                window.from.is_some(),
                "from bound should be set for {value}"
            );
        }
    }

    #[test]
    fn valid_rfc3339_bounds_pass_through() {
        let value = serde_json::json!({ "from": "2025-07-11T10:00:00Z" });
        let window = time_window_from_value(&value);
        assert_eq!(window.from.as_deref(), Some("2025-07-11T10:00:00Z"));
    }

    #[test]
    fn unparseable_bound_becomes_unbounded() {
        let value = serde_json::json!({ "from": "soon", "to": "2025-07-18" });
        let window = time_window_from_value(&value);
        assert!(window.from.is_none(), "garbage 'from' should drop to None");
        assert!(window.to.is_some(), "valid 'to' should remain");
    }
}
