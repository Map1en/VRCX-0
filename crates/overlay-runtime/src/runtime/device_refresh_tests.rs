use super::*;
use vrcx_0_host_desktop::vr_overlay::{VrDeviceRole, VrDeviceStatus};

fn device(label: &str, role: VrDeviceRole, serial: &str) -> VrDeviceSnapshot {
    VrDeviceSnapshot {
        label: label.to_string(),
        role,
        serial: Some(serial.to_string()),
        status: VrDeviceStatus::Normal,
        battery_percent: Some(50),
    }
}

fn shown_devices(runtime: &VrOverlayRuntime) -> usize {
    runtime.devices.lock().unwrap().len()
}

#[test]
fn with_only_the_hmd_alert_on_a_lost_tracker_is_reported_without_filling_the_wrist_list() {
    let runtime = VrOverlayRuntime::new_for_test();

    assert!(runtime.prepare_device_refresh(true, false, true));
    assert_eq!(
        runtime.apply_device_snapshot(
            vec![
                device("HMD", VrDeviceRole::Hmd, "h"),
                device("T1", VrDeviceRole::Tracker, "t")
            ],
            false,
            true
        ),
        None
    );
    assert_eq!(shown_devices(&runtime), 0);

    let lost =
        runtime.apply_device_snapshot(vec![device("HMD", VrDeviceRole::Hmd, "h")], false, true);

    assert_eq!(lost.map(|lost| lost.count), Some(1));
}

#[test]
fn hiding_the_device_list_clears_it_without_asking_the_headset() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_device_snapshot(
        vec![
            device("HMD", VrDeviceRole::Hmd, "h"),
            device("L", VrDeviceRole::LeftController, "l"),
        ],
        true,
        false,
    );
    assert_eq!(shown_devices(&runtime), 2);

    assert!(!runtime.prepare_device_refresh(false, false, false));

    assert_eq!(shown_devices(&runtime), 0);
}

#[test]
fn an_empty_shown_device_list_is_filled_even_without_a_refresh_request() {
    let runtime = VrOverlayRuntime::new_for_test();

    assert!(runtime.prepare_device_refresh(false, true, false));
    assert!(!runtime.prepare_device_refresh(false, false, true));
}

#[test]
fn turning_the_tracker_alert_off_forgets_the_trackers_it_knew() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.apply_device_snapshot(
        vec![
            device("HMD", VrDeviceRole::Hmd, "h"),
            device("T1", VrDeviceRole::Tracker, "t"),
        ],
        false,
        true,
    );

    runtime.prepare_device_refresh(false, false, false);

    assert_eq!(
        runtime.apply_device_snapshot(vec![device("HMD", VrDeviceRole::Hmd, "h")], false, true),
        None
    );
}
