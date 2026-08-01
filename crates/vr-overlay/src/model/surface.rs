use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
pub struct OverlaySurfaceId(String);

impl OverlaySurfaceId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OverlaySurfaceKind {
    Wrist,
    Main,
}

pub const MAIN_SURFACE_ID: &str = "main";
pub const FRIENDS_PANEL_ID: &str = "friends";
pub const LEGACY_DUMMY_PANEL_ID: &str = "dummy";
pub const FRIENDS_PANEL_SURFACE_ID: &str = "friends-panel";
pub const FRIENDS_PANEL_LASER_LEFT_SURFACE_ID: &str = "friends-panel-laser-left";
pub const FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID: &str = "friends-panel-laser-right";
