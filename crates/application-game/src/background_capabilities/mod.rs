mod discord;
mod presence_automation;
mod presence_facts;
mod shared;

pub use discord::{
    build_background_discord_presence_command, BackgroundDiscordActivityPayload,
    BackgroundDiscordPresenceCommand, BackgroundDiscordPresenceState, DiscordPresenceLabels,
};
pub use presence_automation::{
    run_background_presence_automation, BackgroundPresenceAutomationResult,
    BackgroundPresenceAutomationState,
};
pub use presence_facts::{
    build_background_presence_facts, BackgroundPresenceFacts, BackgroundPresenceFactsInput,
    PresencePlayer,
};
