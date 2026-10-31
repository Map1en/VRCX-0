use futures_util::future::BoxFuture;

use std::time::Duration;

use serde_json::Value;
use vrcx_0_application::social::{
    NotificationMarkSeenActions, NotificationMarkSeenBatchItem, NotificationRemoteActionError,
};
use vrcx_0_application_core::vrchat_api::VrchatScope;
use vrcx_0_application_core::{
    RemoteMutationGate, RuntimeAuthScope, RuntimeAuthScopeSnapshot, WebClient,
};
use vrcx_0_persistence::DatabaseService;

const NOTIFICATION_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub struct LocalNotificationMarkSeenActions<'a> {
    db: &'a DatabaseService,
    web: &'a WebClient,
    auth_scope: &'a RuntimeAuthScope,
    expected_scope: RuntimeAuthScopeSnapshot,
    remote_mutation_gate: &'a RemoteMutationGate,
}

impl<'a> LocalNotificationMarkSeenActions<'a> {
    pub fn new(
        db: &'a DatabaseService,
        web: &'a WebClient,
        auth_scope: &'a RuntimeAuthScope,
        expected_scope: RuntimeAuthScopeSnapshot,
        remote_mutation_gate: &'a RemoteMutationGate,
    ) -> Self {
        Self {
            db,
            web,
            auth_scope,
            expected_scope,
            remote_mutation_gate,
        }
    }

    fn ensure_generation(&self) -> crate::Result<()> {
        if self
            .auth_scope
            .snapshot()
            .generation_matches(&self.expected_scope)
        {
            Ok(())
        } else {
            Err(crate::Error::Custom(
                "Notification action authentication scope changed.".into(),
            ))
        }
    }
}

impl NotificationMarkSeenActions for LocalNotificationMarkSeenActions<'_> {
    fn mark_local(&self, ids: Vec<String>) -> crate::Result<()> {
        self.ensure_generation()?;
        vrcx_0_persistence::notifications::notification_mark_seen_local_bulk(
            self.db,
            self.expected_scope.current_user_id.clone(),
            ids,
        )
        .map_err(crate::Error::from)
    }

    fn mark_remote<'a>(
        &'a self,
        item: &'a NotificationMarkSeenBatchItem,
    ) -> BoxFuture<'a, Result<(), NotificationRemoteActionError>> {
        Box::pin(async move {
            self.ensure_generation()
                .map_err(NotificationRemoteActionError::terminal)?;
            self.remote_mutation_gate
                .wait(&self.expected_scope, NOTIFICATION_REMOTE_MUTATION_INTERVAL)
                .await;
            self.ensure_generation()
                .map_err(NotificationRemoteActionError::terminal)?;
            let (_, id, request) =
                vrcx_0_vrchat_client::notifications::notification_mark_seen_input(
                    self.expected_scope.endpoint.clone(),
                    self.expected_scope.current_user_id.clone(),
                    item.id.clone(),
                    item.version,
                )
                .map_err(NotificationRemoteActionError::terminal)?;
            let response = self
                .web
                .execute_api(request, VrchatScope::Vrchat)
                .await
                .map_err(NotificationRemoteActionError::terminal)?;
            let payload = serde_json::from_str::<Value>(&response.data)
                .unwrap_or_else(|_| Value::String(response.data.clone()));
            if response.status >= 400 || payload.get("error").is_some() {
                return Err(NotificationRemoteActionError::response(
                    &payload,
                    response.status,
                ));
            }
            self.ensure_generation()
                .map_err(NotificationRemoteActionError::terminal)?;
            vrcx_0_persistence::notifications::notification_mark_seen(
                self.db,
                self.expected_scope.current_user_id.clone(),
                id,
                item.version,
            )
            .map_err(crate::Error::from)
            .map_err(NotificationRemoteActionError::terminal)
        })
    }
}
