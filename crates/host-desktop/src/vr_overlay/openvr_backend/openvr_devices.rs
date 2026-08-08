use std::collections::{HashMap, HashSet};

use openvr::{
    property::{
        DeviceBatteryPercentage_Float, DeviceIsCharging_Bool, DeviceProvidesBatteryStatus_Bool,
        ModelNumber_String, SerialNumber_String,
    },
    TrackedControllerRole, TrackedDeviceClass, TrackedDeviceIndex, TrackingUniverseOrigin,
    MAX_TRACKED_DEVICE_COUNT,
};

use super::super::openvr_helpers::{
    device_sort_key, device_status, is_display_device_class, short_device_label,
};
use super::super::types::VrDeviceSnapshot;
use super::controller_role;

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct BatteryReadingState {
    accepted: Option<u8>,
    pending_zero: bool,
}

impl BatteryReadingState {
    pub(super) fn update(&mut self, observed: Option<u8>) -> Option<u8> {
        if observed == Some(0)
            && self.accepted.is_some_and(|accepted| accepted > 0)
            && !self.pending_zero
        {
            self.pending_zero = true;
            return self.accepted;
        }
        self.accepted = observed;
        self.pending_zero = false;
        observed
    }
}

pub(super) fn snapshot_openvr_devices(
    system: &openvr::System,
    hmd_battery_readings: &mut HashMap<String, BatteryReadingState>,
) -> Vec<VrDeviceSnapshot> {
    let poses = system.device_to_absolute_tracking_pose(TrackingUniverseOrigin::Standing, 0.0);
    let mut rows = Vec::new();
    let mut current_hmd_battery_devices = HashSet::new();
    let mut tracker_index = 0usize;

    for index in 0..MAX_TRACKED_DEVICE_COUNT {
        let device = TrackedDeviceIndex(index as u32);
        if !system.is_tracked_device_connected(device) {
            continue;
        }
        let class = system.tracked_device_class(device);
        if !is_display_device_class(class) {
            continue;
        }

        let role = controller_role(system, device);
        let serial = string_property(system, device, SerialNumber_String);
        let model = string_property(system, device, ModelNumber_String);
        let label = match class {
            TrackedDeviceClass::HMD => "HMD".to_string(),
            TrackedDeviceClass::Controller => match role {
                Some(TrackedControllerRole::LeftHand) => "L".to_string(),
                Some(TrackedControllerRole::RightHand) => "R".to_string(),
                _ => short_device_label(model.as_deref(), serial.as_deref(), "C"),
            },
            TrackedDeviceClass::GenericTracker => {
                tracker_index += 1;
                format!("T{tracker_index}")
            }
            _ => short_device_label(model.as_deref(), serial.as_deref(), "VR"),
        };
        let battery_properties_available = reads_battery_properties(
            class,
            bool_property(system, device, DeviceProvidesBatteryStatus_Bool),
        );
        let observed_battery_percent = battery_properties_available
            .then(|| battery_percent(system, device))
            .flatten();
        let battery_percent = if matches!(class, TrackedDeviceClass::HMD) {
            let battery_key = serial
                .as_ref()
                .map(|serial| format!("serial:{serial}"))
                .unwrap_or_else(|| format!("device:{}:{label}", device.0));
            current_hmd_battery_devices.insert(battery_key.clone());
            hmd_battery_readings
                .entry(battery_key)
                .or_default()
                .update(observed_battery_percent)
        } else {
            observed_battery_percent
        };
        let charging = battery_properties_available
            && bool_property(system, device, DeviceIsCharging_Bool).unwrap_or(false);
        let pose_valid = poses
            .get(index)
            .is_some_and(|pose| pose.device_is_connected() && pose.pose_is_valid());
        let status = device_status(battery_percent, charging, pose_valid);
        rows.push(DeviceRow {
            sort_key: device_sort_key(class, role, tracker_index),
            snapshot: VrDeviceSnapshot {
                label,
                serial,
                status,
                battery_percent,
            },
        });
    }

    hmd_battery_readings.retain(|key, _| current_hmd_battery_devices.contains(key));
    rows.sort_by_key(|row| row.sort_key);
    rows.into_iter().map(|row| row.snapshot).collect()
}

struct DeviceRow {
    sort_key: (u8, usize),
    snapshot: VrDeviceSnapshot,
}

pub(super) fn string_property(
    system: &openvr::System,
    device: TrackedDeviceIndex,
    property: openvr::TrackedDeviceProperty,
) -> Option<String> {
    system
        .string_tracked_device_property(device, property)
        .ok()
        .and_then(|value| value.into_string().ok())
        .map(|value| value.trim_matches(char::from(0)).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn bool_property(
    system: &openvr::System,
    device: TrackedDeviceIndex,
    property: openvr::TrackedDeviceProperty,
) -> Option<bool> {
    system.bool_tracked_device_property(device, property).ok()
}

fn battery_percent(system: &openvr::System, device: TrackedDeviceIndex) -> Option<u8> {
    system
        .float_tracked_device_property(device, DeviceBatteryPercentage_Float)
        .ok()
        .map(|value| (value.clamp(0.0, 1.0) * 100.0).round() as u8)
}

pub(super) fn reads_battery_properties(
    class: TrackedDeviceClass,
    provides_battery_status: Option<bool>,
) -> bool {
    matches!(class, TrackedDeviceClass::HMD) || provides_battery_status == Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn battery_reading_ignores_one_zero_before_accepting_a_confirmed_zero() {
        let mut reading = BatteryReadingState::default();

        assert_eq!(reading.update(Some(64)), Some(64));
        assert_eq!(reading.update(Some(0)), Some(64));
        assert_eq!(reading.update(Some(63)), Some(63));
        assert_eq!(reading.update(Some(0)), Some(63));
        assert_eq!(reading.update(Some(0)), Some(0));
        assert_eq!(reading.update(Some(41)), Some(41));
    }

    #[test]
    fn battery_reading_does_not_invent_a_value_when_the_source_is_unknown() {
        let mut reading = BatteryReadingState::default();

        assert_eq!(reading.update(None), None);
        assert_eq!(reading.update(Some(0)), Some(0));
        assert_eq!(reading.update(None), None);
    }

    #[test]
    fn battery_properties_follow_driver_support_except_for_hmds() {
        assert!(reads_battery_properties(TrackedDeviceClass::HMD, None));
        assert!(reads_battery_properties(
            TrackedDeviceClass::Controller,
            Some(true)
        ));
        assert!(!reads_battery_properties(
            TrackedDeviceClass::Controller,
            Some(false)
        ));
        assert!(!reads_battery_properties(
            TrackedDeviceClass::GenericTracker,
            None
        ));
    }
}
