pub mod chatbox;
mod discord;
mod presence_automation;
mod presence_facts;
mod shared;

pub use discord::{
    build_background_discord_presence_command, BackgroundDiscordActivityPayload,
    BackgroundDiscordPresenceCommand, BackgroundDiscordPresenceState, DiscordPresenceLabels,
};
pub use presence_automation::{
    presence_automation_local_group_renamed, presence_automation_rule_enabled_set,
    presence_automation_rules_get, presence_automation_rules_set,
    run_background_presence_automation, BackgroundPresenceAutomationResult,
    BackgroundPresenceAutomationState, PresenceAutomationRuleKind,
};
pub use presence_facts::{
    build_background_presence_facts, BackgroundPresenceFacts, BackgroundPresenceFactsInput,
    PresencePlayer,
};
