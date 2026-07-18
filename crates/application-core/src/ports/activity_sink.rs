use crate::events::{
    FriendProjection, RealtimeInstanceClosedProjection, RealtimeInstanceQueueProjection,
    RealtimeNotificationProjection,
};

pub trait OverlayActivityInputSink: Send + Sync {
    fn set_friend_user_ids(&self, user_ids: Vec<String>);
    fn set_delivery_armed(&self, armed: bool);
    fn ingest_friend_projection(&self, projection: &FriendProjection);
    fn ingest_notification_projection(&self, projection: &RealtimeNotificationProjection);
    fn ingest_instance_queue_projection(&self, projection: &RealtimeInstanceQueueProjection);
    fn ingest_instance_closed_projection(&self, projection: &RealtimeInstanceClosedProjection);
}
