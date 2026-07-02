use serde_json::{json, Value};
use vrcx_0_application::OverlayActivityDelivery;

#[derive(Clone, Debug)]
pub(crate) struct RenderedNotification {
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) text: String,
    pub(crate) display_location: String,
    pub(crate) image_url: String,
}

impl RenderedNotification {
    pub(crate) fn tts_payload(&self, delivery: &OverlayActivityDelivery) -> Value {
        json!({
            "sourceId": &delivery.entry.source_id,
            "activityType": &delivery.entry.activity_type,
            "desktop": delivery.desktop,
            "vr": delivery.vr,
            "title": &self.title,
            "body": &self.body,
            "text": &self.text,
            "imageUrl": &self.image_url,
            "actorUserId": &delivery.entry.actor_user_id,
        })
    }
}
