use openvr::{
    button_id, overlay::OverlayHandle, pose::Matrix3x4, TrackedControllerRole, TrackedDeviceClass,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use vrcx_0_vr_overlay::RgbaFrame;

use super::types::{OverlayActivationButton, OverlayPlacement, VrDeviceStatus};

pub(super) fn load_overlay_fn_table() -> Result<&'static openvr_sys::VR_IVROverlay_FnTable, String>
{
    let mut magic = Vec::from(b"FnTable:".as_slice());
    magic.extend(openvr_sys::IVROverlay_Version);
    let mut error = openvr_sys::EVRInitError_VRInitError_None;
    let table = unsafe {
        openvr_sys::VR_GetGenericInterface(magic.as_ptr().cast(), &mut error)
            as *const openvr_sys::VR_IVROverlay_FnTable
    };
    if error != openvr_sys::EVRInitError_VRInitError_None {
        return Err(format!("OpenVR overlay fn table unavailable: {error:?}"));
    }
    if table.is_null() {
        return Err("OpenVR overlay fn table pointer is null".to_string());
    }
    Ok(unsafe { &*table })
}

pub(super) fn set_overlay_premultiplied_alpha(handle: OverlayHandle) -> Result<(), String> {
    let set_flag = load_overlay_fn_table()?
        .SetOverlayFlag
        .ok_or_else(|| "OpenVR SetOverlayFlag is unavailable".to_string())?;
    let error = unsafe { set_flag(handle.0, openvr_sys::VROverlayFlags_IsPremultiplied, true) };
    if error == openvr_sys::EVROverlayError_VROverlayError_None {
        Ok(())
    } else {
        Err(format!(
            "set premultiplied alpha overlay flag failed: {error}"
        ))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct FrameFingerprint {
    width: u32,
    height: u32,
    byte_len: usize,
    hash: u64,
}

pub(super) fn frame_fingerprint(frame: &RgbaFrame) -> FrameFingerprint {
    let mut hasher = DefaultHasher::new();
    frame.size.width.hash(&mut hasher);
    frame.size.height.hash(&mut hasher);
    frame.data.len().hash(&mut hasher);
    frame.data.hash(&mut hasher);
    FrameFingerprint {
        width: frame.size.width,
        height: frame.size.height,
        byte_len: frame.data.len(),
        hash: hasher.finish(),
    }
}

pub(super) fn overlay_button_mask(
    button: OverlayActivationButton,
    tracking_system_name: Option<&str>,
) -> u64 {
    let button_id = match button {
        OverlayActivationButton::Grip if is_oculus_tracking_system(tracking_system_name) => {
            button_id::A
        }
        OverlayActivationButton::Grip => button_id::GRIP,
        OverlayActivationButton::Menu => button_id::APPLICATION_MENU,
    };
    1u64 << button_id
}

pub(super) fn is_oculus_tracking_system(value: Option<&str>) -> bool {
    value
        .map(|value| value.to_ascii_lowercase().contains("oculus"))
        .unwrap_or(false)
}

pub(super) fn surface_transform(placement: &OverlayPlacement) -> Matrix3x4 {
    match placement {
        OverlayPlacement::TrackedDeviceRelative { device_hint } if device_hint == "left-hand" => {
            Matrix3x4([
                [0.0, 0.0, -1.0, -0.07],
                [0.0, -1.0, 0.0, -0.05],
                [-1.0, 0.0, 0.0, 0.06],
            ])
        }
        OverlayPlacement::TrackedDeviceRelative { device_hint } if device_hint == "right-hand" => {
            Matrix3x4([
                [0.0, 0.0, 1.0, 0.07],
                [0.0, -1.0, 0.0, -0.05],
                [1.0, 0.0, 0.0, 0.06],
            ])
        }
        OverlayPlacement::HeadLocked {
            offset_y_meters,
            distance_meters,
        } => Matrix3x4([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, *offset_y_meters],
            [0.0, 0.0, 1.0, -distance_meters],
        ]),
        OverlayPlacement::TrackedDeviceRelative { .. } => Matrix3x4([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.035],
            [0.0, 0.0, 1.0, 0.055],
        ]),
    }
}

pub(super) fn is_display_device_class(class: TrackedDeviceClass) -> bool {
    matches!(
        class,
        TrackedDeviceClass::HMD
            | TrackedDeviceClass::Controller
            | TrackedDeviceClass::GenericTracker
    )
}

pub(super) fn device_sort_key(
    class: TrackedDeviceClass,
    role: Option<TrackedControllerRole>,
    tracker_index: usize,
) -> (u8, usize) {
    match class {
        TrackedDeviceClass::HMD => (0, 0),
        TrackedDeviceClass::Controller => match role {
            Some(TrackedControllerRole::LeftHand) => (1, 0),
            Some(TrackedControllerRole::RightHand) => (2, 0),
            _ => (3, 0),
        },
        TrackedDeviceClass::GenericTracker => (4, tracker_index),
        _ => (9, 0),
    }
}

pub(super) fn device_status(
    battery_percent: Option<u8>,
    charging: bool,
    pose_valid: bool,
) -> VrDeviceStatus {
    if charging {
        return VrDeviceStatus::Charging;
    }
    if !pose_valid {
        return VrDeviceStatus::TrackingWarning;
    }
    match battery_percent {
        Some(percent) if percent <= 10 => VrDeviceStatus::CriticalBattery,
        Some(percent) if percent <= 25 => VrDeviceStatus::LowBattery,
        _ => VrDeviceStatus::Normal,
    }
}

pub(super) fn short_device_label(
    model: Option<&str>,
    serial: Option<&str>,
    fallback: &str,
) -> String {
    let raw = model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| serial.filter(|value| !value.trim().is_empty()))
        .unwrap_or(fallback)
        .trim();
    raw.split_whitespace()
        .next()
        .unwrap_or(fallback)
        .chars()
        .take(6)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn button_mask_uses_oculus_a_for_grip() {
        assert_eq!(
            overlay_button_mask(OverlayActivationButton::Grip, Some("oculus")),
            1u64 << button_id::A
        );
    }

    #[test]
    fn button_mask_uses_grip_for_non_oculus_grip() {
        assert_eq!(
            overlay_button_mask(OverlayActivationButton::Grip, Some("lighthouse")),
            1u64 << button_id::GRIP
        );
    }

    #[test]
    fn button_mask_uses_application_menu_for_menu() {
        assert_eq!(
            overlay_button_mask(OverlayActivationButton::Menu, Some("oculus")),
            1u64 << button_id::APPLICATION_MENU
        );
        assert_eq!(
            overlay_button_mask(OverlayActivationButton::Menu, Some("lighthouse")),
            1u64 << button_id::APPLICATION_MENU
        );
    }
}
