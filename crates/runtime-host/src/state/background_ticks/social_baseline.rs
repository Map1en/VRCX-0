use std::{collections::HashMap, sync::Arc};

use serde_json::Value;
use vrcx_0_application_core::{BackgroundCapabilitySession, FriendProjection, RuntimeEventBus};
use vrcx_0_application_realtime::{
    build_favorites_baseline_from_friend_records, build_synced_friend_roster_baseline,
    RealtimeHostRuntime, SocialBaselineDeps, SocialFavoritesBaselineRequest,
    SocialFriendRosterBaselineInput,
};
use vrcx_0_core::json::RawJson;

use crate::authenticated_runtime::favorite_group_membership_from_baseline;
use crate::AuthenticatedRuntimeOrchestrator;

use super::super::{
    background_capability_session, emit_background_info, emit_background_warning,
    gui_maintenance_runtime_mode, BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
    BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
};
use super::BackgroundTickContext;

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialBaselineRefreshOutput {
    pub stale: bool,
    pub friend_count: usize,
    pub friend_log_changed: bool,
    pub favorites_snapshot: Option<Value>,
}

pub(in crate::state) struct SocialBaselineFavoritesRefresh {
    pub(in crate::state) snapshot: Value,
    pub(in crate::state) groups: HashMap<String, Vec<String>>,
}

pub(in crate::state) struct SocialBaselineRefreshCore {
    pub(in crate::state) stale: bool,
    pub(in crate::state) friend_count: usize,
    pub(in crate::state) friend_log_changed: bool,
    pub(in crate::state) favorites:
        Result<Option<SocialBaselineFavoritesRefresh>, vrcx_0_application_core::Error>,
}

pub(in crate::state) async fn run_social_baseline_refresh_core(
    deps: SocialBaselineDeps,
    realtime_runtime: &Arc<RealtimeHostRuntime>,
    event_bus: &RuntimeEventBus,
    authenticated_runtime: &AuthenticatedRuntimeOrchestrator,
    session: &BackgroundCapabilitySession,
) -> vrcx_0_application_core::Result<SocialBaselineRefreshCore> {
    let baseline = build_synced_friend_roster_baseline(
        deps.clone(),
        realtime_runtime,
        SocialFriendRosterBaselineInput {
            user_id: session.current_user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: RawJson::from(session.current_user_snapshot.clone()),
            is_first_load: false,
        },
    )
    .await?;
    let output = baseline.output;
    let Some(friends_by_id) = baseline.friends_by_id else {
        return Ok(SocialBaselineRefreshCore {
            stale: true,
            friend_count: output.count,
            friend_log_changed: output.friend_log_changed,
            favorites: Ok(None),
        });
    };
    if output.friend_log_changed {
        event_bus.emit_realtime_friend_projection(FriendProjection {
            friend_log_changed: true,
            ..FriendProjection::new(0, 0)
        });
    }
    let favorites = match build_favorites_baseline_from_friend_records(
        deps,
        SocialFavoritesBaselineRequest {
            user_id: session.current_user_id.clone(),
            endpoint: session.endpoint.clone(),
            current_user_snapshot: RawJson::from(session.current_user_snapshot.clone()),
        },
        &friends_by_id,
    )
    .await
    {
        Ok(favorites_output) => {
            authenticated_runtime.update_favorites_baseline(favorites_output.clone());
            Ok(favorites_output.snapshot.map(|snapshot| {
                let groups = favorite_group_membership_from_baseline(&snapshot);
                let value = snapshot.into_value();
                authenticated_runtime.apply_favorites_snapshot(&value);
                SocialBaselineFavoritesRefresh {
                    snapshot: value,
                    groups,
                }
            }))
        }
        Err(error) => Err(error),
    };
    Ok(SocialBaselineRefreshCore {
        stale: false,
        friend_count: output.count,
        friend_log_changed: output.friend_log_changed,
        favorites,
    })
}

pub(in crate::state) async fn run_background_social_baseline_refresh(
    context: &BackgroundTickContext<'_>,
    favorite_friend_groups_by_key: &mut HashMap<String, Vec<String>>,
) {
    context.background_jobs.mark_running(
        BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
        "Refreshing background friend and favorite facts.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
            "Background social baseline refresh is waiting for an authenticated session.",
            BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
        );
        return;
    };
    let deps = SocialBaselineDeps {
        db: Arc::clone(context.db),
        web: Arc::clone(context.web),
        auth_scope: context.runtime_context.auth_scope.clone(),
        session: context.runtime_context.session.clone(),
    };
    let core = match run_social_baseline_refresh_core(
        deps,
        context.realtime_runtime,
        &context.runtime_context.event_bus,
        context.authenticated_runtime,
        &session,
    )
    .await
    {
        Ok(core) => core,
        Err(error) => {
            tracing::warn!(
                runtime_mode = %gui_maintenance_runtime_mode(context.backend_runtime),
                error = %error,
                "GUI maintenance friend baseline refresh failed"
            );
            emit_background_warning(
                context.runtime_context,
                context.backend_runtime,
                format!("social baseline refresh failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB, error.to_string());
            return;
        }
    };
    if core.stale {
        context.background_jobs.mark_scheduled(
            BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
            "Superseded background friend baseline was ignored.",
            BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
        );
        return;
    }
    if let Ok(Some(favorites)) = core.favorites {
        *favorite_friend_groups_by_key = favorites.groups;
    }
    let detail = format!(
        "friend and favorite facts refreshed: {} friends.",
        core.friend_count
    );
    emit_background_info(
        context.runtime_context,
        context.backend_runtime,
        detail.clone(),
    );
    context
        .background_jobs
        .mark_completed(BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB, detail);
    context.background_jobs.mark_scheduled(
        BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
        "Next background friend and favorite facts refresh is waiting.",
        BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
    );
}
