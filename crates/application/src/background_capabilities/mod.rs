mod discord;
mod group_instances;
mod presence_automation;
mod presence_facts;
mod shared;

pub use discord::{
    build_background_discord_presence_command, BackgroundDiscordActivityPayload,
    BackgroundDiscordPresenceCommand, BackgroundDiscordPresenceState, DiscordPresenceLabels,
};
pub use group_instances::{
    refresh_background_current_user, refresh_background_group_instances,
    BackgroundGroupInstancesRefresh,
};
pub use presence_automation::{
    run_background_presence_automation, BackgroundPresenceAutomationResult,
    BackgroundPresenceAutomationState,
};
pub use presence_facts::{
    build_background_presence_facts, BackgroundPresenceFacts, BackgroundPresenceFactsInput,
    PresencePlayer,
};
pub use shared::BackgroundCapabilitySession;
