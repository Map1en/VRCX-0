use std::sync::Arc;

use vrcx_0_application::social::{
    NotificationSyncFuture, NotificationSyncPort, NotificationSyncSource, NotificationSyncWrite,
};
use vrcx_0_application_core::vrchat_api::VrchatScope;
use vrcx_0_application_core::WebClient;
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::DatabaseService;

#[derive(Clone)]
pub struct LocalNotificationSyncAdapter {
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
}

impl LocalNotificationSyncAdapter {
    pub fn new(db: Arc<DatabaseService>, web: Arc<WebClient>) -> Self {
        Self { db, web }
    }
}

impl NotificationSyncPort for LocalNotificationSyncAdapter {
    fn fetch_page<'a>(
        &'a self,
        endpoint: &'a str,
        source: NotificationSyncSource,
        n: i32,
        offset: i32,
    ) -> NotificationSyncFuture<'a> {
        let request = match source {
            NotificationSyncSource::V1 => {
                vrcx_0_vrchat_client::notifications::notifications_v1_get_input(
                    endpoint.to_string(),
                    n,
                    offset,
                )
            }
            NotificationSyncSource::V2 => {
                vrcx_0_vrchat_client::notifications::notifications_v2_get_input(
                    endpoint.to_string(),
                    n,
                    offset,
                )
            }
            NotificationSyncSource::HiddenFriendRequests => {
                vrcx_0_vrchat_client::notifications::hidden_friend_requests_get_input(
                    endpoint.to_string(),
                    n,
                    offset,
                )
            }
        };
        Box::pin(async move { self.web.execute_api(request, VrchatScope::Vrchat).await })
    }

    fn persist(&self, write: NotificationSyncWrite) -> crate::Result<()> {
        vrcx_0_persistence::notifications::notification_friend_requests_sync(
            &self.db,
            write.owner_user_id.clone(),
            write
                .visible_friend_requests
                .into_iter()
                .map(vrcx_0_core::json::RawJson::into_value)
                .collect(),
            write.visible_complete,
            write
                .hidden_friend_requests
                .into_iter()
                .map(vrcx_0_core::json::RawJson::into_value)
                .collect(),
            write.hidden_complete,
        )?;
        vrcx_0_persistence::realtime::write_realtime_batch(
            &self.db,
            &OwnerId::new(write.owner_user_id),
            &vrcx_0_persistence::realtime::RealtimePersistenceBatch {
                notification_v1_upserts: write
                    .notification_v1_upserts
                    .into_iter()
                    .map(vrcx_0_core::json::RawJson::into_value)
                    .collect(),
                notification_v2_upserts: write
                    .notification_v2_upserts
                    .into_iter()
                    .map(vrcx_0_core::json::RawJson::into_value)
                    .collect(),
                ..vrcx_0_persistence::realtime::RealtimePersistenceBatch::default()
            },
        )
        .map(|_| ())
        .map_err(crate::Error::from)
    }
}
