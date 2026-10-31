use futures_util::future::BoxFuture;

use std::time::Duration;

use vrcx_0_application::media::{prepare_media_upload_request, MediaUploadPreprocessor};
use vrcx_0_application::social::{
    BoopNotificationRow, NotificationChainActions, NotificationChainRemoteCall,
    NotificationChainRemoteError,
};
use vrcx_0_application_core::vrchat_api::VrchatScope;
use vrcx_0_application_core::{
    AuthenticatedMutationContext, RealtimeNotificationProjection, RuntimeEventBus, WebClient,
    WorldCache,
};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::DatabaseService;

const BOOP_DISMISS_QUERY_LIMIT: i64 = 50_000;
const NOTIFICATION_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub struct LocalNotificationChainActions<'a> {
    db: &'a DatabaseService,
    web: &'a WebClient,
    mutation: AuthenticatedMutationContext<'a>,
    event_bus: &'a RuntimeEventBus,
    world_cache: &'a WorldCache,
    media_upload_preprocessor: &'a dyn MediaUploadPreprocessor,
}

impl<'a> LocalNotificationChainActions<'a> {
    pub fn new(
        db: &'a DatabaseService,
        web: &'a WebClient,
        mutation: AuthenticatedMutationContext<'a>,
        event_bus: &'a RuntimeEventBus,
        world_cache: &'a WorldCache,
        media_upload_preprocessor: &'a dyn MediaUploadPreprocessor,
    ) -> Self {
        Self {
            db,
            web,
            mutation,
            event_bus,
            world_cache,
            media_upload_preprocessor,
        }
    }
}

impl NotificationChainActions for LocalNotificationChainActions<'_> {
    fn ensure_scope(&self, owner_user_id: &OwnerId, endpoint: &str) -> crate::Result<()> {
        self.mutation.ensure_current()?;
        let stale = || {
            crate::Error::Custom(
                "Notification action request is stale for the current auth scope.".into(),
            )
        };
        if self.mutation.scope().current_user_id != owner_user_id.as_str() {
            return Err(stale());
        }
        if !endpoint.is_empty()
            && vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint(Some(endpoint))
                != self.mutation.scope().endpoint
        {
            return Err(stale());
        }
        Ok(())
    }

    fn ensure_active_scope(&self, endpoint: &str) -> crate::Result<()> {
        self.ensure_scope(
            &OwnerId::new(self.mutation.scope().current_user_id.clone()),
            endpoint,
        )
    }

    fn execute_remote(
        &self,
        call: NotificationChainRemoteCall,
    ) -> BoxFuture<'_, Result<(), NotificationChainRemoteError>> {
        Box::pin(async move {
            let terminal = |error: &dyn ToString| NotificationChainRemoteError {
                message: error.to_string(),
                status: 0,
            };
            self.mutation
                .wait_for_remote(NOTIFICATION_REMOTE_MUTATION_INTERVAL)
                .await
                .map_err(|error| terminal(&error))?;
            let endpoint = self.mutation.scope().endpoint.clone();
            let (request, scope) = match call {
                NotificationChainRemoteCall::HideNotification(target) => {
                    let (_, request) =
                        vrcx_0_vrchat_client::notifications::notification_hide_remote_input(
                            endpoint,
                            target.id,
                            target.version,
                            target.notification_type,
                            target.sender_user_id,
                        )
                        .map_err(|error| terminal(&error))?;
                    (request, VrchatScope::Vrchat)
                }
                NotificationChainRemoteCall::Respond {
                    id,
                    response_type,
                    response_data,
                } => {
                    let (_, request) =
                        vrcx_0_vrchat_client::notifications::notification_respond_input(
                            endpoint,
                            id,
                            response_type,
                            response_data,
                        )
                        .map_err(|error| terminal(&error))?;
                    (request, VrchatScope::Vrchat)
                }
                NotificationChainRemoteCall::InviteResponse { id, response_slot } => {
                    let (_, request) =
                        vrcx_0_vrchat_client::notifications::invite_response_send_input(
                            endpoint,
                            id,
                            response_slot,
                        )
                        .map_err(|error| terminal(&error))?;
                    (request, VrchatScope::Vrchat)
                }
                NotificationChainRemoteCall::InviteResponsePhoto {
                    id,
                    response_slot,
                    image_data,
                } => {
                    let (_, request) =
                        vrcx_0_vrchat_client::notifications::invite_response_photo_input(
                            endpoint,
                            id,
                            response_slot,
                            image_data,
                        )
                        .map_err(|error| terminal(&error))?;
                    let request =
                        prepare_media_upload_request(self.media_upload_preprocessor, request)
                            .map_err(|error| terminal(&error))?;
                    (request, VrchatScope::VrchatMedia)
                }
                NotificationChainRemoteCall::InviteSend {
                    receiver_user_id,
                    params,
                } => {
                    let (_, request) = vrcx_0_vrchat_client::notifications::invite_send_input(
                        endpoint,
                        receiver_user_id,
                        params,
                    )
                    .map_err(|error| terminal(&error))?;
                    (request, VrchatScope::Vrchat)
                }
                NotificationChainRemoteCall::InviteSendPhoto {
                    receiver_user_id,
                    params,
                    image_data,
                } => {
                    let (_, request) = vrcx_0_vrchat_client::notifications::invite_photo_input(
                        endpoint,
                        receiver_user_id,
                        params,
                        image_data,
                    )
                    .map_err(|error| terminal(&error))?;
                    let request =
                        prepare_media_upload_request(self.media_upload_preprocessor, request)
                            .map_err(|error| terminal(&error))?;
                    (request, VrchatScope::VrchatMedia)
                }
                NotificationChainRemoteCall::BoopSend {
                    user_id,
                    emoji_id,
                    inventory_item_id,
                } => {
                    let (_, request) = vrcx_0_vrchat_client::notifications::boop_send_input(
                        endpoint,
                        user_id,
                        emoji_id,
                        inventory_item_id,
                    )
                    .map_err(|error| terminal(&error))?;
                    (request, VrchatScope::Vrchat)
                }
            };
            let response = self
                .web
                .execute_api(request, scope)
                .await
                .map_err(|error| terminal(&error))?;
            let parsed = vrcx_0_contracts::VrchatJsonResponse::from(&response);
            if parsed.is_failure() {
                return Err(NotificationChainRemoteError {
                    message: parsed.error_message_or("VRChat notification request failed"),
                    status: parsed.status,
                });
            }
            self.mutation
                .ensure_current()
                .map_err(|error| terminal(&error))?;
            Ok(())
        })
    }

    fn resolve_world_name<'a>(&'a self, world_id: &'a str) -> BoxFuture<'a, Option<String>> {
        Box::pin(async move {
            if self.mutation.ensure_current().is_err() {
                return None;
            }
            let name = self
                .world_cache
                .resolve_name(self.web, &self.mutation.scope().endpoint, world_id)
                .await;
            self.mutation.ensure_current().ok().and(name)
        })
    }

    fn expire_local(&self, id: String) -> crate::Result<()> {
        self.mutation.ensure_current()?;
        vrcx_0_persistence::notifications::notification_expire(
            self.db,
            self.mutation.scope().current_user_id.clone(),
            id,
        )
        .map_err(crate::Error::from)
    }

    fn query_boop_rows(&self) -> crate::Result<Vec<BoopNotificationRow>> {
        self.mutation.ensure_current()?;
        Ok(vrcx_0_persistence::notifications::notification_list_query(
            self.db,
            vrcx_0_persistence::notifications::NotificationListQueryInput {
                user_id: self.mutation.scope().current_user_id.clone(),
                search: String::new(),
                filters: vec!["boop".into()],
                per_table_limit: BOOP_DISMISS_QUERY_LIMIT,
                limit: BOOP_DISMISS_QUERY_LIMIT,
                include_unseen: false,
            },
        )?
        .into_iter()
        .map(|row| BoopNotificationRow {
            id: row.id,
            version: row.version,
            notification_type: row.r#type,
            sender_user_id: row.sender_user_id,
            link: row.link,
            expired: row.expired,
        })
        .collect())
    }

    fn emit_expired(&self, expired_ids: Vec<String>) {
        self.event_bus
            .emit_realtime_notification_projection(RealtimeNotificationProjection {
                generation: 0,
                expired_ids,
                seen_ids: Vec::new(),
                clear_menu_if_no_unseen: true,
                ..RealtimeNotificationProjection::default()
            });
    }
}
