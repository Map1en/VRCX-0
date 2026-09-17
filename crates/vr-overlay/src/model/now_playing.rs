use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverlayNowPlaying {
    pub title: String,
    pub time_text: String,
    pub progress_percent: Option<u8>,
}
