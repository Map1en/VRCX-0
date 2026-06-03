use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceStatus {
    Normal,
    LowBattery,
    CriticalBattery,
    Charging,
    TrackingWarning,
    Disconnected,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceRole {
    Hmd,
    LeftController,
    RightController,
    Tracker,
    #[default]
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceChip {
    pub label: String,
    #[serde(default)]
    pub role: DeviceRole,
    pub status: DeviceStatus,
    pub battery_percent: Option<u8>,
    pub text: String,
    pub priority: u8,
}
