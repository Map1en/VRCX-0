mod config;
mod facts;
mod render;
mod scheduler;
mod template;

pub use config::{
    ChatboxAfkConfig, ChatboxConfig, ChatboxEditorState, ChatboxFormats, ChatboxLimits,
    ChatboxMemoryFormat, ChatboxMemoryUnit, ChatboxMessageConfig, ChatboxPage, ChatboxPageLine,
    ChatboxProgressStyle, ChatboxTemperatureUnit, CHATBOX_CONFIG_KEY, CHATBOX_DEFAULT_OSC_HOST,
    CHATBOX_DEFAULT_OSC_PORT, CHATBOX_LIMITS,
};
pub use facts::{
    build_chatbox_facts, render_line_previews, sample_chatbox_facts, ChatboxFactNeeds,
    ChatboxFactSources, ChatboxHeadset, ChatboxLinePreviewInput,
};
pub use render::{ChatboxFacts, ChatboxGpuStats, ChatboxLabels, ChatboxMedia, ChatboxSystemStats};
pub use scheduler::{
    ChatboxActivity, ChatboxGate, ChatboxPauseReason, ChatboxScheduler, ChatboxSendError,
    ChatboxSendOutcome, ChatboxStatus, ChatboxTickInput, ChatboxTickOutput,
};
pub use template::ChatboxVariable;

#[cfg(test)]
mod tests;
