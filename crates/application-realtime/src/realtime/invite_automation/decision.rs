use std::collections::HashSet;

use vrcx_0_core::location::parse_location;

pub const INVITE_AUTOMATION_COOLDOWN_MS: i64 = 10 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InviteAutomationMode {
    Off,
    AllFavorites,
    SelectedFavorites,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InviteAutomationConfig {
    pub mode: InviteAutomationMode,
    pub selected_groups: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InviteNotificationFacts {
    pub id: String,
    pub notification_type: String,
    pub sender_user_id: String,
    pub version: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SenderAllowlist {
    pub is_favorite: bool,
    pub group_keys_of_sender: HashSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InviteLocationFacts {
    pub local_game_context_available: bool,
    pub is_game_running: bool,
    pub current_location: String,
    pub last_location: String,
    pub current_user_id: String,
    pub closed_locations: HashSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CooldownView {
    pub last_sent_at_ms: Option<i64>,
    pub is_pending: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InviteAutomationInput {
    pub notification: InviteNotificationFacts,
    pub config: InviteAutomationConfig,
    pub allowlist: SenderAllowlist,
    pub location: InviteLocationFacts,
    pub cooldown: CooldownView,
    pub now_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InviteDecision {
    Send {
        receiver_user_id: String,
        instance_id: String,
        world_id: String,
    },
    Skip {
        reason: InviteAutomationSkipReason,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InviteAutomationSkipReason {
    Disabled,
    InvalidNotification,
    SenderNotAllowlisted,
    LocalGameContextUnavailable,
    GameNotRunning,
    MissingCurrentSessionOrLocation,
    CurrentLocationNotInvitable,
    Pending,
    Cooldown,
    FailureBackoff,
}

impl InviteAutomationSkipReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::InvalidNotification => "invalid-notification",
            Self::SenderNotAllowlisted => "sender-not-allowlisted",
            Self::LocalGameContextUnavailable => "local-game-context-unavailable",
            Self::GameNotRunning => "game-not-running",
            Self::MissingCurrentSessionOrLocation => "missing-current-session-or-location",
            Self::CurrentLocationNotInvitable => "current-location-not-invitable",
            Self::Pending => "sender-invite-pending",
            Self::Cooldown => "sender-cooldown",
            Self::FailureBackoff => "send-failure-backoff",
        }
    }
}

pub fn normalize_invite_automation_mode(value: &str) -> InviteAutomationMode {
    match value.trim() {
        "true" | "All Favorites" => InviteAutomationMode::AllFavorites,
        "Selected Favorites" => InviteAutomationMode::SelectedFavorites,
        _ => InviteAutomationMode::Off,
    }
}

pub fn evaluate_invite_automation(input: &InviteAutomationInput) -> InviteDecision {
    if input.notification.notification_type != "requestInvite"
        || input.notification.id.trim().is_empty()
        || input.notification.sender_user_id.trim().is_empty()
    {
        return skip(InviteAutomationSkipReason::InvalidNotification);
    }
    if input.config.mode == InviteAutomationMode::Off {
        return skip(InviteAutomationSkipReason::Disabled);
    }
    if !sender_allowed(&input.config, &input.allowlist) {
        return skip(InviteAutomationSkipReason::SenderNotAllowlisted);
    }
    if !input.location.local_game_context_available {
        return skip(InviteAutomationSkipReason::LocalGameContextUnavailable);
    }
    if !input.location.is_game_running {
        return skip(InviteAutomationSkipReason::GameNotRunning);
    }
    if input.location.current_user_id.trim().is_empty()
        || input.location.current_location.trim().is_empty()
        || input.location.current_location.trim() == "traveling"
    {
        return skip(InviteAutomationSkipReason::MissingCurrentSessionOrLocation);
    }
    if input.cooldown.is_pending {
        return skip(InviteAutomationSkipReason::Pending);
    }
    if input
        .cooldown
        .last_sent_at_ms
        .map(|last_sent_at| {
            input.now_ms.saturating_sub(last_sent_at) < INVITE_AUTOMATION_COOLDOWN_MS
        })
        .unwrap_or(false)
    {
        return skip(InviteAutomationSkipReason::Cooldown);
    }

    let parsed = parse_location(&input.location.current_location);
    if !can_invite_from_location(&input.location, &parsed) {
        return skip(InviteAutomationSkipReason::CurrentLocationNotInvitable);
    }

    InviteDecision::Send {
        receiver_user_id: input.notification.sender_user_id.trim().to_string(),
        instance_id: input.location.current_location.trim().to_string(),
        world_id: parsed.world_id,
    }
}

fn skip(reason: InviteAutomationSkipReason) -> InviteDecision {
    InviteDecision::Skip { reason }
}

fn sender_allowed(config: &InviteAutomationConfig, allowlist: &SenderAllowlist) -> bool {
    match config.mode {
        InviteAutomationMode::Off => false,
        InviteAutomationMode::AllFavorites => {
            allowlist.is_favorite || !allowlist.group_keys_of_sender.is_empty()
        }
        InviteAutomationMode::SelectedFavorites => config
            .selected_groups
            .iter()
            .any(|group| allowlist.group_keys_of_sender.contains(group.trim())),
    }
}

fn can_invite_from_location(
    facts: &InviteLocationFacts,
    parsed: &vrcx_0_core::location::ParsedLocation,
) -> bool {
    let location = facts.current_location.trim();
    if location.is_empty()
        || !parsed.is_real_instance
        || parsed.world_id.is_empty()
        || parsed.instance_id.is_empty()
    {
        return false;
    }
    if facts.closed_locations.contains(location)
        || facts.closed_locations.contains(&location_cache_key(parsed))
    {
        return false;
    }
    if parsed.access_type == "public"
        || parsed.access_type == "group"
        || parsed.user_id.as_deref() == Some(facts.current_user_id.trim())
    {
        return true;
    }
    if parsed.access_type == "invite" || parsed.access_type == "friends" {
        return false;
    }
    facts.last_location.trim() == location
}

fn location_cache_key(parsed: &vrcx_0_core::location::ParsedLocation) -> String {
    if parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        String::new()
    } else {
        format!("{}:{}", parsed.world_id, parsed.instance_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_input() -> InviteAutomationInput {
        InviteAutomationInput {
            notification: InviteNotificationFacts {
                id: "not_1".into(),
                notification_type: "requestInvite".into(),
                sender_user_id: "usr_sender".into(),
                version: 2,
            },
            config: InviteAutomationConfig {
                mode: InviteAutomationMode::SelectedFavorites,
                selected_groups: vec!["friend:group_0".into()],
            },
            allowlist: SenderAllowlist {
                is_favorite: true,
                group_keys_of_sender: HashSet::from(["friend:group_0".into()]),
            },
            location: InviteLocationFacts {
                local_game_context_available: true,
                is_game_running: true,
                current_location: "wrld_private:12345~private(usr_self)".into(),
                last_location: "wrld_private:12345~private(usr_self)".into(),
                current_user_id: "usr_self".into(),
                closed_locations: HashSet::new(),
            },
            cooldown: CooldownView {
                last_sent_at_ms: None,
                is_pending: false,
            },
            now_ms: 1_000_000,
        }
    }

    #[test]
    fn sends_for_selected_remote_favorite_from_owned_private_instance() {
        let decision = evaluate_invite_automation(&base_input());

        assert_eq!(
            decision,
            InviteDecision::Send {
                receiver_user_id: "usr_sender".into(),
                instance_id: "wrld_private:12345~private(usr_self)".into(),
                world_id: "wrld_private".into(),
            }
        );
    }

    #[test]
    fn skips_sender_outside_selected_favorite_groups() {
        let mut input = base_input();
        input.allowlist.group_keys_of_sender.clear();

        assert_eq!(
            evaluate_invite_automation(&input),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::SenderNotAllowlisted,
            }
        );
    }

    #[test]
    fn skips_when_game_is_not_running() {
        let mut input = base_input();
        input.location.is_game_running = false;

        assert_eq!(
            evaluate_invite_automation(&input),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::GameNotRunning,
            }
        );
    }

    #[test]
    fn skips_when_local_game_context_is_unavailable() {
        let mut input = base_input();
        input.location.local_game_context_available = false;

        assert_eq!(
            evaluate_invite_automation(&input),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::LocalGameContextUnavailable,
            }
        );
    }

    #[test]
    fn allows_group_and_public_instances() {
        for location in [
            "wrld_group:group-room~group(grp_team)~groupAccessType(plus)",
            "wrld_public:12345",
        ] {
            let mut input = base_input();
            input.location.current_location = location.into();
            input.location.last_location = location.into();

            assert!(matches!(
                evaluate_invite_automation(&input),
                InviteDecision::Send { .. }
            ));
        }
    }

    #[test]
    fn rejects_closed_and_inaccessible_locations_but_allows_last_location_fallback() {
        let mut closed = base_input();
        closed.location.current_location = "wrld_public:closed".into();
        closed.location.last_location = "wrld_public:closed".into();
        closed
            .location
            .closed_locations
            .insert("wrld_public:closed".into());
        assert_eq!(
            evaluate_invite_automation(&closed),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::CurrentLocationNotInvitable,
            }
        );

        let mut friends_plus = base_input();
        friends_plus.location.current_location = "wrld_hidden:12345~hidden(usr_owner)".into();
        friends_plus.location.last_location.clear();
        assert_eq!(
            evaluate_invite_automation(&friends_plus),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::CurrentLocationNotInvitable,
            }
        );

        friends_plus.location.last_location = friends_plus.location.current_location.clone();
        assert!(matches!(
            evaluate_invite_automation(&friends_plus),
            InviteDecision::Send { .. }
        ));
    }

    #[test]
    fn skips_pending_and_sender_cooldown() {
        let mut pending = base_input();
        pending.cooldown.is_pending = true;
        assert_eq!(
            evaluate_invite_automation(&pending),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::Pending,
            }
        );

        let mut cooling_down = base_input();
        cooling_down.cooldown.last_sent_at_ms = Some(cooling_down.now_ms - 60_000);
        assert_eq!(
            evaluate_invite_automation(&cooling_down),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::Cooldown,
            }
        );
    }
}
