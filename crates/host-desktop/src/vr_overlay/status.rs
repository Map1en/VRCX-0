use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayServicePhase {
    #[default]
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct OverlayServiceStatus {
    pub phase: OverlayServicePhase,
    pub last_error: Option<String>,
}
