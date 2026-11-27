use std::sync::{Arc, Mutex};

use crate::{ActivityDelivery, ActivitySink, ActivitySnapshot};
use vrcx_0_contracts::GameLogSoundKind;

#[derive(Clone, Default)]
pub struct ActivitySinkRegistry {
    sinks: Arc<Mutex<Vec<Arc<dyn ActivitySink>>>>,
}

impl ActivitySinkRegistry {
    pub fn add(&self, sink: Arc<dyn ActivitySink>) {
        match self.sinks.lock() {
            Ok(mut sinks) => sinks.push(sink),
            Err(error) => tracing::warn!("failed to lock overlay activity sinks: {error}"),
        }
    }

    fn sinks(&self) -> Vec<Arc<dyn ActivitySink>> {
        self.sinks
            .lock()
            .map(|sinks| sinks.clone())
            .unwrap_or_else(|error| {
                tracing::warn!("failed to lock overlay activity sinks: {error}");
                Vec::new()
            })
    }
}

impl ActivitySink for ActivitySinkRegistry {
    fn emit_overlay_activity_snapshot(&self, snapshot: ActivitySnapshot) {
        for sink in self.sinks() {
            sink.emit_overlay_activity_snapshot(snapshot.clone());
        }
    }

    fn emit_overlay_activity_delivery(&self, delivery: ActivityDelivery) {
        for sink in self.sinks() {
            sink.emit_overlay_activity_delivery(delivery.clone());
        }
    }

    fn emit_game_log_sound(&self, kind: GameLogSoundKind) {
        for sink in self.sinks() {
            sink.emit_game_log_sound(kind);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    struct CountingSink {
        snapshots: AtomicUsize,
        deliveries: AtomicUsize,
    }

    impl ActivitySink for CountingSink {
        fn emit_overlay_activity_snapshot(&self, _snapshot: ActivitySnapshot) {
            self.snapshots.fetch_add(1, Ordering::Relaxed);
        }

        fn emit_overlay_activity_delivery(&self, _delivery: ActivityDelivery) {
            self.deliveries.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[test]
    fn fanout_delivers_each_event_to_every_registered_sink() {
        let registry = ActivitySinkRegistry::default();
        let first = Arc::new(CountingSink {
            snapshots: AtomicUsize::new(0),
            deliveries: AtomicUsize::new(0),
        });
        let second = Arc::new(CountingSink {
            snapshots: AtomicUsize::new(0),
            deliveries: AtomicUsize::new(0),
        });
        registry.add(first.clone());
        registry.add(second.clone());

        registry.emit_overlay_activity_snapshot(ActivitySnapshot::default());

        assert_eq!(first.snapshots.load(Ordering::Relaxed), 1);
        assert_eq!(second.snapshots.load(Ordering::Relaxed), 1);
        assert_eq!(first.deliveries.load(Ordering::Relaxed), 0);
    }
}
