use std::sync::{Arc, Mutex};

use crate::RealtimeNotificationProjection;

pub trait RealtimeNotificationProjectionObserver: Send + Sync {
    fn observe_realtime_notification_projection(&self, projection: &RealtimeNotificationProjection);
}

#[derive(Clone, Default)]
pub struct RealtimeNotificationProjectionObserverRegistry {
    observers: Arc<Mutex<Vec<Arc<dyn RealtimeNotificationProjectionObserver>>>>,
}

impl RealtimeNotificationProjectionObserverRegistry {
    pub fn add(&self, observer: Arc<dyn RealtimeNotificationProjectionObserver>) {
        match self.observers.lock() {
            Ok(mut observers) => observers.push(observer),
            Err(error) => tracing::warn!(
                error = %error,
                "failed to register realtime notification projection observer"
            ),
        }
    }
}

impl RealtimeNotificationProjectionObserver for RealtimeNotificationProjectionObserverRegistry {
    fn observe_realtime_notification_projection(
        &self,
        projection: &RealtimeNotificationProjection,
    ) {
        let observers = match self.observers.lock() {
            Ok(observers) => observers.clone(),
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "failed to read realtime notification projection observers"
                );
                return;
            }
        };
        for observer in observers {
            observer.observe_realtime_notification_projection(projection);
        }
    }
}
