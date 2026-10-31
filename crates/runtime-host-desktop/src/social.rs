use std::sync::Arc;

use vrcx_0_application::social::{
    self as application, AuthenticatedRuntimeOrchestrator, ModerationSyncDeps,
    ModerationSyncMutationInput, ModerationSyncMutationOutput, ModerationSyncRefreshInput,
    ModerationSyncRefreshOutput, ModerationSyncRuntime, NotificationActionOutcome,
    NotificationBoopDismissInput, NotificationBoopReplyInput, NotificationHideExpireInput,
    NotificationInstanceInviteInput, NotificationInviteResponseInput,
    NotificationRequestInviteAcceptInput, NotificationRespondInput, SocialBaselineRefreshOutput,
    SocialFriendMutationInput, SocialFriendMutationOutcome, SocialFriendRequestAcceptInput,
    SocialFriendRequestCancelInput, SocialFriendRequestNotificationAcceptOutput,
    SocialMutationDeps, SocialUnfriendBatchInput, SocialUnfriendBatchResult,
};
use vrcx_0_application_core::{
    RemoteMutationGate, RuntimeAuthScope, RuntimeDiagnostics, RuntimeEventBus,
    RuntimeOperationStatus, RuntimeSyncEngine, WebClient, WorldCache,
};
use vrcx_0_application_realtime::{
    build_favorites_baseline, build_synced_friend_roster_baseline, RealtimeHostRuntime,
    SocialBaselineDeps, SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput,
    SocialFriendRosterBaselineInput, SocialFriendRosterBaselineOutput,
};
use vrcx_0_persistence::DatabaseService;

use crate::Result;

#[derive(Clone)]
pub struct DesktopSocialRuntime {
    db: Arc<DatabaseService>,
    realtime_store: Arc<vrcx_0_outbound_adapters::PersistenceRealtimeStore>,
    social_mutation_remote_requests: vrcx_0_outbound_adapters::VrchatSocialMutationRemoteRequests,
    media_upload_adapter: vrcx_0_outbound_adapters::LocalMediaUploadAdapter,
    moderation_sync_store: vrcx_0_outbound_adapters::LocalModerationSyncStore,
    moderation_sync_remote_requests: vrcx_0_outbound_adapters::VrchatModerationSyncRemoteRequests,
    web: Arc<WebClient>,
    remote: vrcx_0_outbound_adapters::VrchatRequestAdapter,
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
    realtime: Arc<RealtimeHostRuntime>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    event_bus: RuntimeEventBus,
    world_cache: Arc<WorldCache>,
    moderation_sync: ModerationSyncRuntime,
    authenticated: AuthenticatedRuntimeOrchestrator,
}

impl DesktopSocialRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
        realtime: Arc<RealtimeHostRuntime>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
        event_bus: RuntimeEventBus,
        world_cache: Arc<WorldCache>,
        moderation_sync: ModerationSyncRuntime,
        authenticated: AuthenticatedRuntimeOrchestrator,
    ) -> Self {
        let realtime_store = Arc::new(vrcx_0_outbound_adapters::PersistenceRealtimeStore::new(
            Arc::clone(&db),
        ));
        let media_upload_adapter =
            vrcx_0_outbound_adapters::LocalMediaUploadAdapter::new(Arc::clone(&web));
        let moderation_sync_store =
            vrcx_0_outbound_adapters::LocalModerationSyncStore::new(Arc::clone(&db));
        let remote = vrcx_0_outbound_adapters::VrchatRequestAdapter::new(Arc::clone(&web));
        Self {
            db,
            realtime_store,
            social_mutation_remote_requests:
                vrcx_0_outbound_adapters::VrchatSocialMutationRemoteRequests,
            media_upload_adapter,
            moderation_sync_store,
            moderation_sync_remote_requests:
                vrcx_0_outbound_adapters::VrchatModerationSyncRemoteRequests,
            web,
            remote,
            auth_scope,
            remote_mutations,
            realtime,
            diagnostics,
            sync,
            event_bus,
            world_cache,
            moderation_sync,
            authenticated,
        }
    }

    fn moderation_deps(&self) -> ModerationSyncDeps<'_> {
        ModerationSyncDeps::new(
            &self.moderation_sync_store,
            &self.moderation_sync_remote_requests,
            &self.remote,
            &self.auth_scope,
            self.remote_mutations.as_ref(),
        )
    }

    fn mutation_deps(&self) -> SocialMutationDeps<'_> {
        SocialMutationDeps::new(
            self.realtime_store.as_ref(),
            &self.social_mutation_remote_requests,
            &self.remote,
            &self.auth_scope,
            &self.remote_mutations,
            &self.realtime,
        )
    }

    fn baseline_deps(&self) -> SocialBaselineDeps {
        SocialBaselineDeps::new(
            self.realtime_store.clone(),
            Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeRemoteRequests),
            Arc::clone(&self.web),
            self.auth_scope.clone(),
        )
    }

    fn notification_actions(
        &self,
    ) -> Result<vrcx_0_outbound_adapters::LocalNotificationChainActions<'_>> {
        let expected_scope = self.auth_scope.snapshot();
        if !expected_scope.active || expected_scope.current_user_id.trim().is_empty() {
            return Err(vrcx_0_application_core::Error::Custom(
                "Notification action requires an authenticated session.".into(),
            )
            .into());
        }
        Ok(
            vrcx_0_outbound_adapters::LocalNotificationChainActions::new(
                self.db.as_ref(),
                self.web.as_ref(),
                &self.auth_scope,
                expected_scope,
                &self.event_bus,
                self.world_cache.as_ref(),
                &self.remote_mutations,
                &self.media_upload_adapter,
            ),
        )
    }

    pub fn record_baseline_refresh(
        &self,
        result: &vrcx_0_application_core::Result<SocialBaselineRefreshOutput>,
    ) {
        let command = "app__social_baseline_refresh";
        match result {
            Ok(output) => {
                let status = if output.stale {
                    RuntimeOperationStatus::Stale
                } else {
                    RuntimeOperationStatus::Ok
                };
                self.diagnostics.record_command(
                    command,
                    status,
                    format!(
                        "stale={} count={} friendLogChanged={}",
                        output.stale, output.friend_count, output.friend_log_changed
                    ),
                );
                self.sync.record(
                    "friends",
                    if output.stale {
                        RuntimeOperationStatus::Stale
                    } else {
                        RuntimeOperationStatus::Ready
                    },
                    if output.stale {
                        "Social baseline refresh skipped a stale request.".to_string()
                    } else {
                        format!("Social baseline refreshed {} friends.", output.friend_count)
                    },
                    0,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync.record_failure("friends", error.to_string());
            }
        }
    }

    pub async fn favorites_baseline(
        &self,
        input: SocialFavoritesBaselineInput,
    ) -> Result<SocialFavoritesBaselineOutput> {
        let command = "app__social_favorites_baseline_get";
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            "Favorites baseline started.",
        );
        let result = build_favorites_baseline(self.baseline_deps(), input).await;
        match &result {
            Ok(output) => {
                self.authenticated.update_favorites_baseline(output.clone());
                let status = if output.stale {
                    RuntimeOperationStatus::Stale
                } else {
                    RuntimeOperationStatus::Ok
                };
                let sync_status = if output.stale {
                    RuntimeOperationStatus::Stale
                } else {
                    RuntimeOperationStatus::Ready
                };
                self.diagnostics.record_command(
                    command,
                    status,
                    format!(
                        "user={} stale={} count={}",
                        output.user_id, output.stale, output.count
                    ),
                );
                self.sync.record(
                    "favorites",
                    sync_status,
                    if output.stale {
                        format!(
                            "Favorites baseline skipped stale request for {}.",
                            output.user_id
                        )
                    } else {
                        format!("Favorites baseline loaded for {}.", output.user_id)
                    },
                    0,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync.record_failure("favorites", error.to_string());
            }
        }
        Ok(result?)
    }

    pub async fn friend_roster_baseline(
        &self,
        input: SocialFriendRosterBaselineInput,
    ) -> Result<SocialFriendRosterBaselineOutput> {
        let command = "app__social_friend_roster_baseline_get";
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            "Friend roster baseline started.",
        );
        let result =
            build_synced_friend_roster_baseline(self.baseline_deps(), &self.realtime, input)
                .await
                .map(|baseline| baseline.output);
        match &result {
            Ok(output) => {
                let status = if output.stale {
                    RuntimeOperationStatus::Stale
                } else {
                    RuntimeOperationStatus::Ok
                };
                let sync_status = if output.stale {
                    RuntimeOperationStatus::Stale
                } else {
                    RuntimeOperationStatus::Ready
                };
                self.diagnostics.record_command(
                    command,
                    status,
                    format!(
                        "user={} stale={} count={}",
                        output.user_id, output.stale, output.count
                    ),
                );
                self.sync.record(
                    "friends",
                    sync_status,
                    if output.stale {
                        format!(
                            "Friend roster baseline skipped stale request for {}.",
                            output.user_id
                        )
                    } else {
                        format!("Friend roster baseline loaded for {}.", output.user_id)
                    },
                    0,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync.record_failure("friends", error.to_string());
            }
        }
        Ok(result?)
    }

    pub async fn moderation_refresh(
        &self,
        input: ModerationSyncRefreshInput,
    ) -> Result<ModerationSyncRefreshOutput> {
        let command = "app__moderation_sync_refresh";
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            "Moderation snapshot refresh started.",
        );
        let result = application::refresh_player_moderations(
            &self.moderation_sync,
            self.moderation_deps(),
            input,
        )
        .await;
        match &result {
            Ok(output) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Ok,
                    format!(
                        "user={} remote={} local={}",
                        output.user_id, output.remote_count, output.local_count
                    ),
                );
                self.sync.record(
                    "moderation",
                    RuntimeOperationStatus::Ready,
                    format!(
                        "Moderation snapshot refreshed for {} with {} local rows.",
                        output.user_id, output.local_count
                    ),
                    0,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync.record_failure("moderation", error.to_string());
            }
        }
        Ok(result?)
    }

    pub async fn moderation_update(
        &self,
        input: ModerationSyncMutationInput,
    ) -> Result<ModerationSyncMutationOutput> {
        let command = "app__moderation_sync_update";
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            "Moderation mutation started.",
        );
        let result = application::update_player_moderation(
            &self.moderation_sync,
            self.moderation_deps(),
            input,
        )
        .await;
        match &result {
            Ok(output) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Ok,
                    format!(
                        "target={} type={} enabled={}",
                        output.target_user_id, output.r#type, output.enabled
                    ),
                );
                self.sync.record(
                    "moderation",
                    RuntimeOperationStatus::Ready,
                    format!(
                        "Moderation {} {} for {}.",
                        output.r#type,
                        if output.enabled {
                            "enabled"
                        } else {
                            "disabled"
                        },
                        output.target_user_id
                    ),
                    0,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync.record_failure("moderation", error.to_string());
            }
        }
        Ok(result?)
    }

    fn record_mutation_outcome(
        &self,
        command: &str,
        result: &vrcx_0_application_core::Result<SocialFriendMutationOutcome>,
    ) {
        match result {
            Ok(outcome) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Ok,
                    format!(
                        "target={} status={:?}",
                        outcome.target_user_id, outcome.status
                    ),
                );
                self.sync.record(
                    "socialMutation",
                    RuntimeOperationStatus::Ready,
                    format!("{command} completed for {}.", outcome.target_user_id),
                    0,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync
                    .record_failure("socialMutation", error.to_string());
            }
        }
    }

    pub async fn unfriend(
        &self,
        input: SocialFriendMutationInput,
    ) -> Result<SocialFriendMutationOutcome> {
        let command = "app__social_unfriend";
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            format!("Unfriending {}.", input.target_user_id),
        );
        let result = application::unfriend(self.mutation_deps(), input).await;
        self.record_mutation_outcome(command, &result);
        Ok(result?)
    }

    pub async fn unfriend_selection(
        &self,
        input: SocialUnfriendBatchInput,
    ) -> Result<SocialUnfriendBatchResult> {
        let command = "app__social_unfriend_selection";
        let target_count = input.targets.len();
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            format!("Unfriending {target_count} user(s)."),
        );
        let result = application::unfriend_selection(self.mutation_deps(), input).await;
        match &result {
            Ok(output) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Ok,
                    format!(
                        "succeeded={}, failed={}, localFailed={}",
                        output.succeeded, output.failed, output.local_failed
                    ),
                );
                self.sync.record(
                    "socialMutation",
                    RuntimeOperationStatus::Ready,
                    format!(
                        "{command} completed for {} user(s); {} failed.",
                        output.succeeded, output.failed
                    ),
                    0,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync
                    .record_failure("socialMutation", error.to_string());
            }
        }
        Ok(result?)
    }

    pub async fn send_friend_request(
        &self,
        input: SocialFriendMutationInput,
    ) -> Result<SocialFriendMutationOutcome> {
        let command = "app__social_friend_request_send";
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            format!("Sending friend request to {}.", input.target_user_id),
        );
        let result = application::send_friend_request(self.mutation_deps(), input).await;
        self.record_mutation_outcome(command, &result);
        Ok(result?)
    }

    pub async fn cancel_friend_request(
        &self,
        input: SocialFriendRequestCancelInput,
    ) -> Result<SocialFriendMutationOutcome> {
        let command = "app__social_friend_request_cancel";
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            format!("Canceling friend request to {}.", input.target_user_id),
        );
        let result = application::cancel_friend_request(self.mutation_deps(), input).await;
        self.record_mutation_outcome(command, &result);
        Ok(result?)
    }

    pub async fn accept_friend_request_notification(
        &self,
        input: SocialFriendRequestAcceptInput,
    ) -> Result<SocialFriendRequestNotificationAcceptOutput> {
        let command = "app__social_friend_request_notification_accept";
        let target_user_id = input.target_user_id.clone();
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            format!("Accepting friend request from {target_user_id}."),
        );
        let result =
            application::accept_friend_request_notification(self.mutation_deps(), input).await;
        match &result {
            Ok(output) => self.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Ok,
                format!("target={target_user_id} status={:?}", output.status),
            ),
            Err(error) => self.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Error,
                error.to_string(),
            ),
        }
        Ok(result?)
    }

    pub async fn hide_and_expire_notification(
        &self,
        input: NotificationHideExpireInput,
    ) -> Result<NotificationActionOutcome> {
        Ok(application::hide_and_expire_notification(&self.notification_actions()?, input).await?)
    }

    pub async fn accept_request_invite_notification(
        &self,
        input: NotificationRequestInviteAcceptInput,
    ) -> Result<NotificationActionOutcome> {
        Ok(
            application::accept_request_invite_notification(&self.notification_actions()?, input)
                .await?,
        )
    }

    pub async fn send_instance_invite_notification(
        &self,
        input: NotificationInstanceInviteInput,
    ) -> Result<NotificationActionOutcome> {
        Ok(
            application::send_instance_invite_notification(&self.notification_actions()?, input)
                .await?,
        )
    }

    pub async fn send_invite_response_notification(
        &self,
        input: NotificationInviteResponseInput,
    ) -> Result<NotificationActionOutcome> {
        Ok(
            application::send_invite_response_notification(&self.notification_actions()?, input)
                .await?,
        )
    }

    pub async fn dismiss_boop_notifications(
        &self,
        input: NotificationBoopDismissInput,
    ) -> Result<NotificationActionOutcome> {
        Ok(application::dismiss_boop_notifications(&self.notification_actions()?, input).await?)
    }

    pub async fn send_boop_reply_notification(
        &self,
        input: NotificationBoopReplyInput,
    ) -> Result<NotificationActionOutcome> {
        Ok(application::send_boop_reply_notification(&self.notification_actions()?, input).await?)
    }

    pub async fn respond_and_expire_notification(
        &self,
        input: NotificationRespondInput,
    ) -> Result<NotificationActionOutcome> {
        Ok(
            application::respond_and_expire_notification(&self.notification_actions()?, input)
                .await?,
        )
    }
}
