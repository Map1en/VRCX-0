use std::collections::HashMap;
use std::sync::{atomic::AtomicBool, Arc, Mutex};

use super::{
    run_background_current_user_refresh, run_background_group_instance_notification_refresh,
    run_background_group_instance_refresh, run_background_moderation_refresh,
    run_background_print_cleanup, run_background_profile_bio_scan,
    run_background_social_baseline_refresh, AuthenticatedSessionProjection, BackendRuntime,
    BackendRuntimePhase, BackendRuntimeSnapshot, BackendRuntimeTelemetryKind,
    BackgroundCapabilitySession, BackgroundCapabilitySessionIdentity, BackgroundTickContext,
    DatabaseService, RealtimeHostRuntime, RuntimeBackgroundJobs, RuntimeHostContext,
    RuntimeHostState, SocialBaselineRefreshOutput, WebClient,
};
use crate::GroupOrderSource;
use futures_util::future::BoxFuture;
use vrcx_0_application::social::{
    AuthenticatedRuntimeOrchestrator, ProfileBioScanPacer, SocialMaintenanceActions,
};
use vrcx_0_application_activity::ActivityFavoriteGroups;
use vrcx_0_core::OwnerId;
use vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint;

pub(super) struct RuntimeHostSocialMaintenanceActions {
    pub(super) db: Arc<DatabaseService>,
    pub(super) realtime_store: Arc<dyn vrcx_0_application_realtime::RealtimeStore>,
    pub(super) web: Arc<WebClient>,
    pub(super) session_slot: Arc<Mutex<AuthenticatedSessionProjection>>,
    pub(super) realtime_runtime: Arc<RealtimeHostRuntime>,
    pub(super) runtime_context: Arc<RuntimeHostContext>,
    pub(super) backend_runtime: BackendRuntime,
    pub(super) background_jobs: RuntimeBackgroundJobs,
    pub(super) authenticated_runtime: AuthenticatedRuntimeOrchestrator,
    pub(super) group_instances_refresh_running: Arc<AtomicBool>,
    pub(super) group_order_source: Arc<dyn GroupOrderSource>,
    pub(super) group_notification_group_ids: Mutex<Option<GroupNotificationGroupIds>>,
    pub(super) profile_bio_pacer: ProfileBioScanPacer,
}

pub(super) struct GroupNotificationGroupIds {
    owner_id: String,
    revision: u64,
    group_ids: Vec<String>,
}

impl RuntimeHostSocialMaintenanceActions {
    fn tick_context(&self) -> BackgroundTickContext<'_> {
        BackgroundTickContext {
            db: &self.db,
            realtime_store: &self.realtime_store,
            web: &self.web,
            session_slot: &self.session_slot,
            realtime_runtime: &self.realtime_runtime,
            runtime_context: &self.runtime_context,
            backend_runtime: &self.backend_runtime,
            background_jobs: &self.background_jobs,
            authenticated_runtime: &self.authenticated_runtime,
        }
    }
}

impl SocialMaintenanceActions for RuntimeHostSocialMaintenanceActions {
    fn active_scope_key(&self) -> Option<String> {
        if !is_authenticated_maintenance_active(
            &self.backend_runtime,
            &self.runtime_context,
            &self.session_slot,
        ) {
            return None;
        }
        background_capability_session_scope_key(&self.session_slot)
    }

    fn favorite_friend_group_membership(&self) -> Option<HashMap<String, Vec<String>>> {
        self.authenticated_runtime
            .favorite_friend_group_membership()
    }

    fn group_instance_notification_group_ids(&self) -> Vec<String> {
        let Some(session) = background_capability_session_identity(&self.session_slot) else {
            return Vec::new();
        };
        let runtime = self.runtime_context.activity_router();
        let revision = runtime.group_notification_inputs_revision();
        if let Ok(cached) = self.group_notification_group_ids.lock() {
            if let Some(cached) = cached.as_ref().filter(|cached| {
                cached.owner_id == session.current_user_id && cached.revision == revision
            }) {
                return cached.group_ids.clone();
            }
        }
        let snapshot = match vrcx_0_persistence::saved_group_favorites::snapshot(
            self.db.as_ref(),
            &OwnerId::new(&session.current_user_id),
        ) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                tracing::warn!(error = %error, "failed to read saved group notification membership");
                return Vec::new();
            }
        };
        let memberships = snapshot
            .collections
            .iter()
            .map(|collection| {
                (
                    format!("group:{}", collection.id),
                    collection.group_ids.clone(),
                )
            })
            .collect::<HashMap<_, _>>();
        let favorite_groups = ActivityFavoriteGroups::from_map(memberships);
        let group_ids = favorite_groups.group_instance_notification_group_ids(&runtime.filters());
        runtime.set_group_favorite_groups(favorite_groups);
        self.runtime_context
            .group_instance_monitor()
            .set_watched_groups(&group_ids);
        let config_key = format!(
            "groupInstanceNotificationGroupIds:{}",
            session.current_user_id
        );
        let value = serde_json::json!(group_ids);
        let config = self.runtime_context.config();
        if config
            .get_json(config_key.as_str(), serde_json::json!([]))
            .map_or(true, |current| current != value)
        {
            if let Err(error) = config.set_json(config_key.as_str(), &value) {
                tracing::warn!(error = %error, "failed to persist group instance notification IDs");
            }
        }
        if let Ok(mut cached) = self.group_notification_group_ids.lock() {
            *cached = Some(GroupNotificationGroupIds {
                owner_id: session.current_user_id,
                revision,
                group_ids: group_ids.clone(),
            });
        }
        group_ids
    }

    fn refresh_current_user(&self) -> BoxFuture<'_, ()> {
        Box::pin(run_background_current_user_refresh(
            &self.session_slot,
            &self.realtime_runtime,
            &self.runtime_context,
            &self.backend_runtime,
            &self.background_jobs,
        ))
    }

    fn refresh_group_instances(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let context = self.tick_context();
            run_background_group_instance_refresh(
                &context,
                &self.group_instances_refresh_running,
                self.group_order_source.as_ref(),
            )
            .await
        })
    }

    fn refresh_group_instance_notifications<'a>(
        &'a self,
        group_ids: &'a [String],
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let context = self.tick_context();
            run_background_group_instance_notification_refresh(
                &context,
                &self.group_instances_refresh_running,
                group_ids,
            )
            .await;
        })
    }

    fn refresh_social_baseline<'a>(
        &'a self,
        favorite_friend_groups_by_key: &'a mut HashMap<String, Vec<String>>,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let context = self.tick_context();
            run_background_social_baseline_refresh(&context, favorite_friend_groups_by_key).await;
        })
    }

    fn refresh_moderation(&self) -> BoxFuture<'_, ()> {
        Box::pin(run_background_moderation_refresh(
            &self.db,
            &self.web,
            &self.session_slot,
            &self.runtime_context,
            &self.backend_runtime,
            &self.background_jobs,
        ))
    }

    fn schedule_print_cleanup(&self) {
        run_background_print_cleanup(&self.tick_context());
    }

    fn scan_profile_bio(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            run_background_profile_bio_scan(&self.tick_context(), &self.profile_bio_pacer).await
        })
    }
}

impl RuntimeHostState {
    pub(super) fn start_social_maintenance_loops(&self) {
        self.social_maintenance.start();
    }

    pub async fn refresh_social_baseline_now(
        &self,
    ) -> vrcx_0_application_core::Result<SocialBaselineRefreshOutput> {
        let Some(session) = background_capability_session(&self.authenticated_session_projection)
        else {
            return Err(vrcx_0_application_core::Error::Custom(
                "Social baseline refresh requires an authenticated session.".into(),
            ));
        };
        let deps = vrcx_0_application_realtime::SocialBaselineDeps::new(
            Arc::clone(&self.realtime_store),
            Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeRemoteRequests),
            Arc::clone(&self.web),
            self.runtime_context.auth_scope.clone(),
        );
        let core = vrcx_0_application::social::refresh_social_baseline(
            deps,
            &self.realtime_runtime,
            &self.authenticated_runtime,
            &session,
        )
        .await?;
        let favorites_snapshot = core.favorites?.map(|favorites| favorites.snapshot);
        Ok(SocialBaselineRefreshOutput {
            stale: core.stale,
            friend_count: u32::try_from(core.friend_count).unwrap_or(u32::MAX),
            friend_log_changed: core.friend_log_changed,
            favorites_snapshot,
        })
    }

    pub(super) fn start_profile_maintenance_loops(&self) {
        if let Some(extension) = &self.profile_extension {
            extension.start_profile_maintenance(self);
        }
    }

    pub(super) fn emit_backend_runtime_telemetry(
        &self,
        kind: BackendRuntimeTelemetryKind,
        detail: impl Into<String>,
    ) {
        self.emit_backend_runtime_telemetry_snapshot(kind, detail, self.backend_runtime.snapshot());
    }

    pub(super) fn emit_backend_runtime_telemetry_snapshot(
        &self,
        kind: BackendRuntimeTelemetryKind,
        detail: impl Into<String>,
        snapshot: BackendRuntimeSnapshot,
    ) {
        vrcx_0_application_core::BackendRuntimeStatusPublisher::new(
            self.backend_runtime.clone(),
            self.runtime_context.event_bus.clone(),
        )
        .publish_telemetry(kind, detail, snapshot);
    }
}

pub(super) fn is_authenticated_maintenance_active(
    runtime: &BackendRuntime,
    runtime_context: &Arc<RuntimeHostContext>,
    session_slot: &Arc<Mutex<AuthenticatedSessionProjection>>,
) -> bool {
    let auth_scope = runtime_context.auth_scope.snapshot();
    if !is_authenticated_maintenance_active_snapshot(&runtime.snapshot()) {
        return false;
    }
    background_capability_session_identity(session_slot)
        .map(|session| background_session_matches_auth(&session, &auth_scope))
        .unwrap_or(false)
}

pub(super) fn is_authenticated_maintenance_active_snapshot(
    snapshot: &BackendRuntimeSnapshot,
) -> bool {
    snapshot.phase == BackendRuntimePhase::Running
        && snapshot.auth_status == vrcx_0_application_core::BackendRuntimeAuthStatus::Authenticated
}

pub(super) fn background_session_matches_auth(
    session: &BackgroundCapabilitySessionIdentity,
    auth_scope: &vrcx_0_application_core::RuntimeAuthScopeSnapshot,
) -> bool {
    auth_scope.active
        && session.auth_scope_generation == auth_scope.generation
        && session.current_user_id == auth_scope.current_user_id
        && normalize_vrchat_api_endpoint(Some(&session.endpoint)) == auth_scope.endpoint
}

pub(super) fn gui_maintenance_runtime_mode(backend_runtime: &BackendRuntime) -> &'static str {
    match backend_runtime.profile() {
        crate::RuntimeHostProfile::HeadlessData => "headless mode",
        crate::RuntimeHostProfile::Desktop => match backend_runtime.gui_mode() {
            Some(vrcx_0_application_core::GuiRuntimeMode::Foreground) => "normal GUI mode",
            Some(vrcx_0_application_core::GuiRuntimeMode::Background) => "background GUI mode",
            None => "normal GUI mode",
        },
    }
}

pub(super) fn emit_background_info(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    detail: impl Into<String>,
) {
    emit_background_output(
        runtime_context,
        backend_runtime,
        BackendRuntimeTelemetryKind::BackgroundInfo,
        detail,
    );
}

pub(super) fn emit_background_warning(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    detail: impl Into<String>,
) {
    emit_background_output(
        runtime_context,
        backend_runtime,
        BackendRuntimeTelemetryKind::BackgroundWarning,
        detail,
    );
}

fn emit_background_output(
    runtime_context: &Arc<RuntimeHostContext>,
    backend_runtime: &BackendRuntime,
    kind: BackendRuntimeTelemetryKind,
    detail: impl Into<String>,
) {
    let snapshot = backend_runtime.snapshot();
    if backend_runtime.profile() == crate::RuntimeHostProfile::HeadlessData
        || !matches!(snapshot.phase, BackendRuntimePhase::Running)
    {
        return;
    }
    vrcx_0_application_core::BackendRuntimeStatusPublisher::new(
        backend_runtime.clone(),
        runtime_context.event_bus.clone(),
    )
    .publish_telemetry(kind, detail, snapshot);
}

pub(super) fn background_capability_session(
    session_slot: &Arc<Mutex<AuthenticatedSessionProjection>>,
) -> Option<BackgroundCapabilitySession> {
    let slot = session_slot
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    slot.session
        .as_ref()
        .map(|session| BackgroundCapabilitySession {
            auth_scope_generation: session.auth_scope_generation,
            current_user_id: session.user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: session.current_user_snapshot.clone(),
        })
}

pub(super) fn background_capability_session_identity(
    session_slot: &Arc<Mutex<AuthenticatedSessionProjection>>,
) -> Option<BackgroundCapabilitySessionIdentity> {
    let slot = session_slot
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    slot.session
        .as_ref()
        .map(|session| BackgroundCapabilitySessionIdentity {
            auth_scope_generation: session.auth_scope_generation,
            current_user_id: session.user_id.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
        })
}

fn background_capability_session_scope_key(
    session_slot: &Arc<Mutex<AuthenticatedSessionProjection>>,
) -> Option<String> {
    background_capability_session_identity(session_slot).map(|session| {
        format!(
            "{}:{}:{}",
            session.auth_scope_generation,
            session.current_user_id,
            normalize_vrchat_api_endpoint(Some(&session.endpoint))
        )
    })
}

pub(super) fn background_capability_session_matches(
    session_slot: &Arc<Mutex<AuthenticatedSessionProjection>>,
    session: &BackgroundCapabilitySessionIdentity,
) -> bool {
    let slot = session_slot
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    slot.session
        .as_ref()
        .map(|current| {
            current.auth_scope_generation == session.auth_scope_generation
                && current.user_id == session.current_user_id
                && current.endpoint == session.endpoint
                && current.websocket == session.websocket
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod background_capability_session_identity_tests {
    use super::*;
    use serde_json::json;
    use vrcx_0_application::auth::AuthenticatedSessionSnapshot;

    #[test]
    fn maintenance_scope_reads_only_session_identity() {
        let session_slot = Arc::new(Mutex::new(AuthenticatedSessionProjection {
            revision: 1,
            session: Some(AuthenticatedSessionSnapshot {
                auth_scope_generation: 4,
                user_id: "usr_owner".into(),
                display_name: "Owner".into(),
                endpoint: "https://api.example.test/api/1".into(),
                websocket: "wss://pipeline.example.test".into(),
                current_user_snapshot: json!({"large": [1, 2, 3]}).into(),
            }),
        }));

        let identity = background_capability_session_identity(&session_slot).unwrap();

        assert_eq!(identity.auth_scope_generation, 4);
        assert_eq!(identity.current_user_id, "usr_owner");
        assert_eq!(identity.endpoint, "https://api.example.test/api/1");
        assert_eq!(identity.websocket, "wss://pipeline.example.test");
    }

    #[test]
    fn notification_scan_ids_follow_enabled_saved_group_scopes() {
        let favorite_groups = ActivityFavoriteGroups::from_map(HashMap::from([
            (
                "group:collection-a".to_string(),
                vec!["grp_alpha".to_string(), "grp_shared".to_string()],
            ),
            (
                "group:collection-b".to_string(),
                vec!["grp_beta".to_string(), "grp_shared".to_string()],
            ),
            (
                "group:collection-c".to_string(),
                vec!["grp_not_selected".to_string()],
            ),
        ]));
        let selected = vrcx_0_application_activity::ActivityFilters::from_json(json!({
            "version": 1,
            "desktop": {
                "types": {
                    "group.instanceOpened": {
                        "scope": "selectedFavorites",
                        "favoriteGroupKeys": [
                            "group:collection-a",
                            "group:deleted-collection"
                        ]
                    }
                }
            }
        }));

        assert_eq!(
            favorite_groups.group_instance_notification_group_ids(&selected),
            vec!["grp_alpha", "grp_shared"]
        );
        assert!(favorite_groups
            .group_instance_notification_group_ids(
                &vrcx_0_application_activity::ActivityFilters::default()
            )
            .is_empty());

        let all_favorites = vrcx_0_application_activity::ActivityFilters::from_json(json!({
            "version": 1,
            "tts": {
                "types": {
                    "group.instanceOpened": {
                        "scope": "allFavorites",
                        "favoriteGroupKeys": "all"
                    }
                }
            }
        }));
        assert_eq!(
            favorite_groups.group_instance_notification_group_ids(&all_favorites),
            vec!["grp_alpha", "grp_beta", "grp_not_selected", "grp_shared"]
        );
    }
}
