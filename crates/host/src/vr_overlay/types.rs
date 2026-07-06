use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId, OverlayTransform, UvPoint};

const MAX_OVERLAY_INPUT_EVENTS: usize = 512;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackendStartError {
    pub message: String,
    pub permanent: bool,
}

impl BackendStartError {
    pub fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            permanent: true,
        }
    }

    pub fn transient(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            permanent: false,
        }
    }
}

impl std::fmt::Display for BackendStartError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct OverlaySurfaceConfig {
    pub surface_id: OverlaySurfaceId,
    pub size: OverlaySize,
    pub physical_width_meters: f32,
    pub placement: OverlayPlacement,
    #[serde(default)]
    pub activation_button: OverlayActivationButton,
    #[serde(default)]
    pub interactive: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayPlacement {
    TrackedDeviceRelative { device_hint: String },
    Absolute { transform: OverlayTransform },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayActivationButton {
    #[default]
    Grip,
    Menu,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayHand {
    Left,
    Right,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInputEvent {
    pub surface_id: OverlaySurfaceId,
    pub panel_id: String,
    pub hand: OverlayHand,
    pub uv: UvPoint,
    pub kind: OverlayInputKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayInputKind {
    Summon { transform: OverlayTransform },
    Hover,
    ClickDown,
    ClickUp,
    Scroll { delta: f32 },
    GrabStart,
    GrabMove { transform: OverlayTransform },
    GrabEnd { transform: OverlayTransform },
}

#[derive(Clone, Default)]
pub struct OverlayInputEventSink {
    queue: Arc<Mutex<VecDeque<OverlayInputEvent>>>,
}

impl OverlayInputEventSink {
    pub fn push(&self, event: OverlayInputEvent) {
        if let Ok(mut queue) = self.queue.lock() {
            if queue.len() >= MAX_OVERLAY_INPUT_EVENTS {
                queue.pop_front();
            }
            queue.push_back(event);
        }
    }

    pub fn drain(&self) -> Vec<OverlayInputEvent> {
        self.queue
            .lock()
            .map(|mut queue| queue.drain(..).collect())
            .unwrap_or_default()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct VrDeviceSnapshot {
    pub label: String,
    pub serial: Option<String>,
    pub status: VrDeviceStatus,
    pub battery_percent: Option<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum VrDeviceStatus {
    Normal,
    LowBattery,
    CriticalBattery,
    Charging,
    TrackingWarning,
    Disconnected,
}
