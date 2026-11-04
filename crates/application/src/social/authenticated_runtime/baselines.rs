use std::collections::HashMap;
use std::sync::Arc;

use crate::auth::{
    AuthenticatedRuntimePhase, AuthenticatedRuntimePhaseSnapshot, AuthenticatedRuntimeSession,
};
use vrcx_0_application_core::{Error, Result, RuntimeAuthScopeSnapshot, TaskStopToken};
use vrcx_0_application_realtime::{
    build_favorites_baseline_from_friend_ids, build_synced_friend_roster_baseline,
    FavoriteBaselineSnapshot, SocialFavoritesBaselineOutput, SocialFavoritesBaselineRequest,
    SocialFriendRosterBaselineInput, SocialFriendRosterBaselineOutput,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::time::now_iso;

use super::state::{friend_baseline_metadata, ready_step, AuthenticatedRuntimeState, RuntimeStep};
use super::AuthenticatedRuntimeOrchestrator;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct FavoriteGroupMemberships {
    pub friend_groups_by_key: HashMap<String, Vec<String>>,
    pub world_groups_by_key: HashMap<String, Vec<String>>,
}

pub fn friend_ids_by_roster_id_from_records(
    friends_by_id: HashMap<String, FriendRecord>,
) -> HashMap<String, String> {
    friends_by_id
        .into_iter()
        .map(|(roster_id, friend)| {
            let friend_id = friend.id.trim().to_string();
            let friend_id = if friend_id.is_empty() {
                roster_id.clone()
            } else {
                friend_id
            };
            (roster_id, friend_id)
        })
        .collect()
}

impl AuthenticatedRuntimeOrchestrator {
    pub(super) async fn run_friend_baseline(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
    ) -> Option<HashMap<String, String>> {
        let mut attempt = 1;
        loop {
            match self
                .try_friend_baseline(session, scope, run_id, stop_token, attempt)
                .await
            {
                Ok(Some(friend_ids_by_roster_id)) => return Some(friend_ids_by_roster_id),
                Ok(None) => return None,
                Err(error) => {
                    if !self
                        .wait_before_retry(
                            run_id,
                            RuntimeStep::Friends,
                            attempt,
                            error.to_string(),
                            scope,
                            stop_token,
                        )
                        .await
                    {
                        return None;
                    }
                    attempt = attempt.saturating_add(1);
                }
            }
        }
    }

    pub(super) async fn try_friend_baseline(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
        attempt: u32,
    ) -> Result<Option<HashMap<String, String>>> {
        if !self.is_active(run_id, scope, stop_token) {
            return Ok(None);
        }
        self.set_step_running(run_id, RuntimeStep::Friends, attempt);
        let result = build_synced_friend_roster_baseline(
            self.social_baseline_deps(),
            &self.realtime_runtime,
            SocialFriendRosterBaselineInput {
                user_id: session.user_id.clone(),
                endpoint: session.endpoint.clone(),
                websocket: session.websocket.clone(),
                current_user_snapshot: session.current_user.clone(),
                is_first_load: true,
            },
        )
        .await
        .and_then(|baseline| {
            let output = baseline.output;
            match baseline.friends_by_id {
                Some(friends_by_id) => {
                    Ok((output, friend_ids_by_roster_id_from_records(friends_by_id)))
                }
                None => Err(Error::Custom(if output.detail.trim().is_empty() {
                    "Friend roster baseline was stale.".into()
                } else {
                    output.detail
                })),
            }
        });
        if !self.is_active(run_id, scope, stop_token) {
            return Ok(None);
        }

        match result {
            Ok((mut output, friend_ids_by_roster_id)) => {
                if output.detail.trim().is_empty() {
                    output.detail = format!(
                        "Friend roster baseline loaded for {}.",
                        session.display_name
                    );
                }
                self.update_friend_baseline(run_id, attempt, output);
                Ok(Some(friend_ids_by_roster_id))
            }
            Err(error) => {
                self.emit_auth_failure_if_needed(scope, "runtime/social-baseline/friends", &error);
                Err(error)
            }
        }
    }

    pub(super) async fn run_favorites_baseline(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
        friend_ids_by_roster_id: &HashMap<String, String>,
    ) {
        let mut attempt = 1;
        loop {
            if !self.is_active(run_id, scope, stop_token) {
                return;
            }
            self.set_step_running(run_id, RuntimeStep::Favorites, attempt);
            let result = build_favorites_baseline_from_friend_ids(
                self.social_baseline_deps(),
                SocialFavoritesBaselineRequest {
                    user_id: session.user_id.clone(),
                    endpoint: session.endpoint.clone(),
                    current_user_snapshot: session.current_user.clone(),
                },
                friend_ids_by_roster_id,
            )
            .await;
            if !self.is_active(run_id, scope, stop_token) {
                return;
            }

            match result.and_then(require_favorites_baseline) {
                Ok(output) => {
                    if let Some(snapshot) = output.snapshot.as_ref() {
                        self.apply_favorites_snapshot(snapshot);
                    }
                    self.update_favorites_step_baseline(run_id, attempt, output);
                    self.mark_ready_if_complete(run_id);
                    return;
                }
                Err(error) => {
                    self.emit_auth_failure_if_needed(
                        scope,
                        "runtime/social-baseline/favorites",
                        &error,
                    );
                    if !self
                        .wait_before_retry(
                            run_id,
                            RuntimeStep::Favorites,
                            attempt,
                            error.to_string(),
                            scope,
                            stop_token,
                        )
                        .await
                    {
                        return;
                    }
                    attempt = attempt.saturating_add(1);
                }
            }
        }
    }
}

pub(super) fn commit_friend_baseline(
    state: &mut AuthenticatedRuntimeState,
    attempt: u32,
    output: SocialFriendRosterBaselineOutput,
) -> AuthenticatedRuntimePhaseSnapshot {
    state.phase.friends = ready_step(attempt, format!("{} friends loaded.", output.count));
    state.phase.friend_baseline_revision = state.phase.friend_baseline_revision.saturating_add(1);
    state.friend_baseline = Some(friend_baseline_metadata(&output));
    state.phase.friend_baseline = None;
    state.phase.favorites_baseline = None;
    state.phase.updated_at = now_iso();
    let mut emitted = state.phase.clone();
    emitted.friend_baseline = Some(output);
    emitted
}

pub(super) fn commit_favorites_baseline(
    state: &mut AuthenticatedRuntimeState,
    attempt: u32,
    output: SocialFavoritesBaselineOutput,
) -> AuthenticatedRuntimePhaseSnapshot {
    state.phase.favorites = ready_step(attempt, format!("{} favorites loaded.", output.count));
    state.favorite_group_memberships = output
        .snapshot
        .as_ref()
        .map(favorite_group_memberships_from_baseline)
        .map(Arc::new);
    state.favorites_baseline = Some(output.clone());
    state.phase.friend_baseline = None;
    state.phase.favorites_baseline = None;
    state.phase.updated_at = now_iso();
    let mut emitted = state.phase.clone();
    emitted.favorites_baseline = Some(output);
    emitted
}

pub(super) fn accept_favorites_baseline(
    state: &mut AuthenticatedRuntimeState,
    output: SocialFavoritesBaselineOutput,
) -> Option<FavoriteBaselineSnapshot> {
    if output.stale
        || state.phase.user_id != output.user_id
        || !matches!(
            state.phase.phase,
            AuthenticatedRuntimePhase::Starting | AuthenticatedRuntimePhase::Ready
        )
    {
        return None;
    }
    let snapshot = output.snapshot.clone()?;
    state.favorite_group_memberships = Some(Arc::new(favorite_group_memberships_from_baseline(
        &snapshot,
    )));
    state.favorites_baseline = Some(output);
    state.phase.updated_at = now_iso();
    Some(snapshot)
}

fn require_favorites_baseline(
    output: SocialFavoritesBaselineOutput,
) -> Result<SocialFavoritesBaselineOutput> {
    if output.stale || output.snapshot.is_none() {
        return Err(Error::Custom("Favorites baseline was stale.".into()));
    }
    Ok(output)
}

pub fn favorite_group_membership_from_baseline(
    snapshot: &FavoriteBaselineSnapshot,
) -> HashMap<String, Vec<String>> {
    let mut groups = HashMap::new();
    append_typed_favorite_group_membership(
        &mut groups,
        &snapshot.grouped_favorite_friend_ids_by_group_key,
        "",
    );
    append_typed_favorite_group_membership(&mut groups, &snapshot.local_friend_favorites, "local:");
    groups
}

pub fn favorite_world_group_membership_from_baseline(
    snapshot: &FavoriteBaselineSnapshot,
) -> HashMap<String, Vec<String>> {
    let mut groups = HashMap::new();
    append_typed_favorite_group_membership(
        &mut groups,
        &snapshot.grouped_favorite_world_ids_by_group_key,
        "",
    );
    append_typed_favorite_group_membership(&mut groups, &snapshot.local_world_favorites, "local:");
    groups
}

pub(super) fn favorite_group_memberships_from_baseline(
    snapshot: &FavoriteBaselineSnapshot,
) -> FavoriteGroupMemberships {
    FavoriteGroupMemberships {
        friend_groups_by_key: favorite_group_membership_from_baseline(snapshot),
        world_groups_by_key: favorite_world_group_membership_from_baseline(snapshot),
    }
}

pub(super) fn append_typed_favorite_group_membership(
    groups: &mut HashMap<String, Vec<String>>,
    memberships: &std::collections::BTreeMap<String, Vec<String>>,
    key_prefix: &str,
) {
    for (group_key, entity_ids) in memberships {
        let entity_ids = entity_ids
            .iter()
            .map(|entity_id| entity_id.trim())
            .filter(|entity_id| !entity_id.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !entity_ids.is_empty() {
            groups.insert(format!("{key_prefix}{group_key}"), entity_ids);
        }
    }
}
