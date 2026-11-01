use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GameLogAuthenticatedUser {
    pub user_id: String,
    pub display_name: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct LogContext {
    pub(crate) position: u64,
    pub(crate) file_created_at: Option<u64>,
    #[serde(default)]
    pub(crate) authenticated_user: Option<GameLogAuthenticatedUser>,
    #[serde(skip)]
    pub(crate) at_end: bool,
    #[serde(skip)]
    pub(crate) read_failed: bool,
    pub(super) recent_world_name: String,
    pub(super) location_destination: String,
    pub(super) video_errors: HashSet<String>,
    pub(super) shader_keywords_limit_reached: bool,
    pub(super) last_audio_device: String,
    pub(super) audio_device_changed: bool,
}

impl LogContext {
    pub(crate) fn new() -> Self {
        Self {
            position: 0,
            file_created_at: None,
            authenticated_user: None,
            at_end: true,
            read_failed: false,
            recent_world_name: String::new(),
            location_destination: String::new(),
            video_errors: HashSet::with_capacity(50),
            shader_keywords_limit_reached: false,
            last_audio_device: String::new(),
            audio_device_changed: false,
        }
    }
}
