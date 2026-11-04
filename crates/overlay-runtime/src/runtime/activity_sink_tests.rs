use vrcx_0_application_activity::ActivitySink;

use super::*;

#[test]
fn activity_sink_does_not_retain_runtime() {
    let runtime = Arc::new(VrOverlayRuntime::new_for_test());
    let weak_runtime = Arc::downgrade(&runtime);
    let sink = VrOverlayActivitySink::new(&runtime);

    drop(runtime);

    assert!(weak_runtime.upgrade().is_none());
    sink.emit_overlay_activity_snapshot(ActivitySnapshot::default());
}
