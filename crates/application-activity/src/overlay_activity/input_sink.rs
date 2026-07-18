use vrcx_0_application_core::OverlayActivityInputSink;
use vrcx_0_application_core::{
    FriendProjection, RealtimeInstanceClosedProjection, RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection,
};

use super::OverlayActivityRuntime;

impl OverlayActivityInputSink for OverlayActivityRuntime {
    fn set_friend_user_ids(&self, user_ids: Vec<String>) {
        OverlayActivityRuntime::set_friend_user_ids(self, user_ids);
    }

    fn set_delivery_armed(&self, armed: bool) {
        OverlayActivityRuntime::set_delivery_armed(self, armed);
    }

    fn ingest_friend_projection(&self, projection: &FriendProjection) {
        OverlayActivityRuntime::ingest_friend_projection(self, projection);
    }

    fn ingest_notification_projection(&self, projection: &RealtimeNotificationProjection) {
        OverlayActivityRuntime::ingest_notification_projection(self, projection);
    }

    fn ingest_instance_queue_projection(&self, projection: &RealtimeInstanceQueueProjection) {
        OverlayActivityRuntime::ingest_instance_queue_projection(self, projection);
    }

    fn ingest_instance_closed_projection(&self, projection: &RealtimeInstanceClosedProjection) {
        OverlayActivityRuntime::ingest_instance_closed_projection(self, projection);
    }
}
