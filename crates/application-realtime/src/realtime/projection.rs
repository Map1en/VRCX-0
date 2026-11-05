use std::sync::Arc;

use serde::Serialize;
use vrcx_0_application_core::RuntimeEventBus;
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_contracts::RuntimeEventPayload;
use vrcx_0_core::OwnerId;

use super::projection_types::{FriendProjection, RealtimeEntryCorrectionFields};

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeFeedUpsert {
    pub sequence: i64,
    pub entry: FeedLiveEntry,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeFeedPatch {
    pub sequence: i64,
    pub id: String,
    pub fields: RealtimeEntryCorrectionFields,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeFeedProjection {
    pub generation: u64,
    pub owner_user_id: OwnerId,
    #[serde(default)]
    pub upserts: Vec<RealtimeFeedUpsert>,
    #[serde(default)]
    pub patches: Vec<RealtimeFeedPatch>,
}

impl RuntimeEventPayload for RealtimeFeedProjection {
    const EVENT_NAME: &'static str = "realtimeFeedProjection";
}

pub trait FriendProjectionObserver: Send + Sync {
    fn on_friend_projection(&self, projection: &FriendProjection);
}

#[derive(Clone)]
pub struct FriendProjectionSink {
    event_bus: RuntimeEventBus,
    observer: Option<Arc<dyn FriendProjectionObserver>>,
}

impl FriendProjectionSink {
    pub fn new(
        event_bus: RuntimeEventBus,
        observer: Option<Arc<dyn FriendProjectionObserver>>,
    ) -> Self {
        Self {
            event_bus,
            observer,
        }
    }

    pub fn emit(&self, projection: FriendProjection) {
        if let Some(observer) = &self.observer {
            observer.on_friend_projection(&projection);
        }
        self.event_bus.emit(projection);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use serde_json::Value;
    use vrcx_0_application_core::RuntimeEventSink;
    use vrcx_0_contracts::RuntimeEventPayload;

    use super::*;

    struct OrderingObserver(Arc<Mutex<Vec<&'static str>>>);

    impl FriendProjectionObserver for OrderingObserver {
        fn on_friend_projection(&self, projection: &FriendProjection) {
            assert_eq!(projection.generation, 7);
            self.0.lock().unwrap().push("observer");
        }
    }

    struct OrderingTransport(Arc<Mutex<Vec<&'static str>>>);

    impl RuntimeEventSink for OrderingTransport {
        fn emit(&self, event: &str, payload: Value) {
            assert_eq!(event, FriendProjection::EVENT_NAME);
            assert_eq!(payload["generation"], 7);
            self.0.lock().unwrap().push("transport");
        }
    }

    #[test]
    fn friend_observer_runs_before_outbound_transport() {
        let order = Arc::new(Mutex::new(Vec::new()));
        let bus = RuntimeEventBus::new();
        bus.set_sink(OrderingTransport(Arc::clone(&order)));
        let sink =
            FriendProjectionSink::new(bus, Some(Arc::new(OrderingObserver(Arc::clone(&order)))));

        sink.emit(FriendProjection::new(7, 3));

        assert_eq!(*order.lock().unwrap(), ["observer", "transport"]);
    }
}
