use std::collections::HashMap;
use std::sync::Arc;

use vrcx_0_application_core::BackgroundCapabilitySession;
use vrcx_0_application_realtime::{
    build_favorites_baseline_from_friend_ids, build_synced_friend_roster_baseline,
    FavoriteBaselineSnapshot, RealtimeHostRuntime, SocialFavoritesBaselineRequest,
    SocialFriendRosterBaselineInput,
};
use vrcx_0_core::json::RawJson;

use super::{
    favorite_group_membership_from_baseline, friend_ids_by_roster_id_from_records,
    AuthenticatedRuntimeOrchestrator,
};

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialBaselineRefreshOutput {
    pub stale: bool,
    pub friend_count: u32,
    pub friend_log_changed: bool,
    pub favorites_snapshot: Option<FavoriteBaselineSnapshot>,
}

pub struct SocialBaselineFavoritesRefresh {
    pub snapshot: FavoriteBaselineSnapshot,
    pub groups: HashMap<String, Vec<String>>,
}

pub struct SocialBaselineRefreshCore {
    pub stale: bool,
    pub friend_count: usize,
    pub friend_log_changed: bool,
    pub favorites: Result<Option<SocialBaselineFavoritesRefresh>, vrcx_0_application_core::Error>,
}

pub async fn refresh_social_baseline(
    realtime_runtime: &Arc<RealtimeHostRuntime>,
    authenticated_runtime: &AuthenticatedRuntimeOrchestrator,
    session: &BackgroundCapabilitySession,
) -> vrcx_0_application_core::Result<SocialBaselineRefreshCore> {
    let deps = authenticated_runtime.social_baseline_deps();
    let baseline = build_synced_friend_roster_baseline(
        deps.clone(),
        realtime_runtime,
        SocialFriendRosterBaselineInput {
            user_id: session.current_user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: RawJson::from(session.current_user_snapshot.as_value().clone()),
            is_first_load: false,
        },
    )
    .await?;
    let output = baseline.output;
    let Some(friends_by_id) = baseline.friends_by_id else {
        return Ok(SocialBaselineRefreshCore {
            stale: true,
            friend_count: output.count as usize,
            friend_log_changed: output.friend_log_changed,
            favorites: Ok(None),
        });
    };
    let friend_ids_by_roster_id = friend_ids_by_roster_id_from_records(friends_by_id);
    if output.friend_log_changed {
        realtime_runtime.emit_friend_log_changed();
    }
    let favorites = match build_favorites_baseline_from_friend_ids(
        deps,
        SocialFavoritesBaselineRequest {
            user_id: session.current_user_id.clone(),
            endpoint: session.endpoint.clone(),
            current_user_snapshot: RawJson::from(session.current_user_snapshot.as_value().clone()),
        },
        &friend_ids_by_roster_id,
    )
    .await
    {
        Ok(favorites_output) => {
            authenticated_runtime.update_favorites_baseline(favorites_output.clone());
            Ok(favorites_output.snapshot.map(|snapshot| {
                let groups = favorite_group_membership_from_baseline(&snapshot);
                SocialBaselineFavoritesRefresh { snapshot, groups }
            }))
        }
        Err(error) => Err(error),
    };
    Ok(SocialBaselineRefreshCore {
        stale: false,
        friend_count: output.count as usize,
        friend_log_changed: output.friend_log_changed,
        favorites,
    })
}
