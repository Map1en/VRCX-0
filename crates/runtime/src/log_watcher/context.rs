use std::collections::HashSet;

pub(super) struct LogContext {
    pub(super) position: u64,
    pub(super) recent_world_name: String,
    pub(super) location_destination: String,
    pub(super) video_errors: HashSet<String>,
    pub(super) shader_keywords_limit_reached: bool,
    pub(super) last_audio_device: String,
    pub(super) audio_device_changed: bool,
}

impl LogContext {
    pub(super) fn new() -> Self {
        Self {
            position: 0,
            recent_world_name: String::new(),
            location_destination: String::new(),
            video_errors: HashSet::with_capacity(50),
            shader_keywords_limit_reached: false,
            last_audio_device: String::new(),
            audio_device_changed: false,
        }
    }
}
