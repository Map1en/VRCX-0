use std::collections::HashSet;

use vrcx_0_application_core::LocalGameContextSnapshot;
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
    pub allowed_statuses: Vec<String>,
    pub message_slot: Option<i32>,
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
    pub local_game_context: LocalGameContextSnapshot,
    pub last_location: String,
    pub current_user_id: String,
    pub current_user_status: String,
    pub closed_locations: HashSet<String>,
}

impl InviteLocationFacts {
    pub(crate) fn current_location(&self) -> &str {
        match &self.local_game_context {
            LocalGameContextSnapshot::Available { location, .. } => location,
            LocalGameContextSnapshot::Unavailable => "",
        }
    }

    pub(crate) fn is_game_running(&self) -> bool {
        matches!(
            self.local_game_context,
            LocalGameContextSnapshot::Available {
                is_game_running: true,
                ..
            }
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CooldownView {
    pub last_sent_at_ms: Option<i64>,
    pub is_pending: bool,
    pub in_failure_backoff: bool,
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
    StatusNotAllowed,
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
            Self::StatusNotAllowed => "status-not-allowed",
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

pub fn normalize_invite_message_slot(value: &str) -> Option<i32> {
    value
        .trim()
        .parse::<i32>()
        .ok()
        .filter(|slot| (0..12).contains(slot))
}

pub fn context_gates(
    config: &InviteAutomationConfig,
    location: &InviteLocationFacts,
) -> Result<(), InviteAutomationSkipReason> {
    if config.mode == InviteAutomationMode::Off {
        return Err(InviteAutomationSkipReason::Disabled);
    }
    if !config.allowed_statuses.is_empty()
        && !config
            .allowed_statuses
            .iter()
            .any(|status| status.trim() == location.current_user_status.trim())
    {
        return Err(InviteAutomationSkipReason::StatusNotAllowed);
    }
    let LocalGameContextSnapshot::Available {
        is_game_running, ..
    } = &location.local_game_context
    else {
        return Err(InviteAutomationSkipReason::LocalGameContextUnavailable);
    };
    if !is_game_running {
        return Err(InviteAutomationSkipReason::GameNotRunning);
    }
    let current_location = location.current_location();
    if location.current_user_id.trim().is_empty()
        || current_location.trim().is_empty()
        || current_location.trim() == "traveling"
    {
        return Err(InviteAutomationSkipReason::MissingCurrentSessionOrLocation);
    }
    Ok(())
}

pub fn cooldown_gate(
    cooldown: &CooldownView,
    now_ms: i64,
) -> Result<(), InviteAutomationSkipReason> {
    if cooldown.is_pending {
        return Err(InviteAutomationSkipReason::Pending);
    }
    if cooldown.in_failure_backoff {
        return Err(InviteAutomationSkipReason::FailureBackoff);
    }
    if cooldown.last_sent_at_ms.is_some_and(|last_sent_at| {
        now_ms.saturating_sub(last_sent_at) < INVITE_AUTOMATION_COOLDOWN_MS
    }) {
        return Err(InviteAutomationSkipReason::Cooldown);
    }
    Ok(())
}

pub fn evaluate_invite_automation(input: &InviteAutomationInput) -> InviteDecision {
    if input.notification.notification_type != "requestInvite"
        || input.notification.id.trim().is_empty()
        || input.notification.sender_user_id.trim().is_empty()
    {
        return skip(InviteAutomationSkipReason::InvalidNotification);
    }
    if let Err(reason) = context_gates(&input.config, &input.location) {
        return skip(reason);
    }
    if !sender_allowed(&input.config, &input.allowlist) {
        return skip(InviteAutomationSkipReason::SenderNotAllowlisted);
    }
    if let Err(reason) = cooldown_gate(&input.cooldown, input.now_ms) {
        return skip(reason);
    }

    let current_location = input.location.current_location();
    let parsed = parse_location(current_location);
    if !can_invite_from_location(&input.location, &parsed) {
        return skip(InviteAutomationSkipReason::CurrentLocationNotInvitable);
    }

    InviteDecision::Send {
        receiver_user_id: input.notification.sender_user_id.trim().to_string(),
        instance_id: current_location.trim().to_string(),
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
    let location = facts.current_location().trim();
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

    fn local_game_context(is_game_running: bool, location: &str) -> LocalGameContextSnapshot {
        LocalGameContextSnapshot::Available {
            is_game_running,
            location: location.into(),
            destination: String::new(),
            world_name: String::new(),
            player_user_ids: Vec::new(),
        }
    }

    fn set_current_location(input: &mut InviteAutomationInput, location: &str) {
        input.location.local_game_context = local_game_context(true, location);
    }

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
                allowed_statuses: Vec::new(),
                message_slot: None,
            },
            allowlist: SenderAllowlist {
                is_favorite: true,
                group_keys_of_sender: HashSet::from(["friend:group_0".into()]),
            },
            location: InviteLocationFacts {
                local_game_context: local_game_context(
                    true,
                    "wrld_private:12345~private(usr_self)",
                ),
                last_location: "wrld_private:12345~private(usr_self)".into(),
                current_user_id: "usr_self".into(),
                current_user_status: "join me".into(),
                closed_locations: HashSet::new(),
            },
            cooldown: CooldownView {
                last_sent_at_ms: None,
                is_pending: false,
                in_failure_backoff: false,
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
    fn only_sends_while_current_status_is_allowed() {
        let mut input = base_input();
        input.config.allowed_statuses = vec!["active".into(), "join me".into()];
        assert!(matches!(
            evaluate_invite_automation(&input),
            InviteDecision::Send { .. }
        ));

        input.location.current_user_status = "busy".into();
        assert_eq!(
            evaluate_invite_automation(&input),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::StatusNotAllowed,
            }
        );

        input.config.allowed_statuses.clear();
        assert!(matches!(
            evaluate_invite_automation(&input),
            InviteDecision::Send { .. }
        ));
    }

    #[test]
    fn skips_when_game_is_not_running() {
        let mut input = base_input();
        input.location.local_game_context =
            local_game_context(false, "wrld_private:12345~private(usr_self)");

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
        input.location.local_game_context = LocalGameContextSnapshot::Unavailable;

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
            set_current_location(&mut input, location);
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
        set_current_location(&mut closed, "wrld_public:closed");
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
        set_current_location(&mut friends_plus, "wrld_hidden:12345~hidden(usr_owner)");
        friends_plus.location.last_location.clear();
        assert_eq!(
            evaluate_invite_automation(&friends_plus),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::CurrentLocationNotInvitable,
            }
        );

        friends_plus.location.last_location = friends_plus.location.current_location().into();
        assert!(matches!(
            evaluate_invite_automation(&friends_plus),
            InviteDecision::Send { .. }
        ));
    }

    #[test]
    fn rejects_invite_and_friends_but_invite_plus_follows_last_location_fallback() {
        let mut invite = base_input();
        set_current_location(&mut invite, "wrld_a:1~private(usr_other)");
        invite.location.last_location = "wrld_a:1~private(usr_other)".into();
        assert_eq!(
            evaluate_invite_automation(&invite),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::CurrentLocationNotInvitable,
            }
        );

        let mut friends = base_input();
        set_current_location(&mut friends, "wrld_a:1~friends(usr_other)");
        friends.location.last_location = "wrld_a:1~friends(usr_other)".into();
        assert_eq!(
            evaluate_invite_automation(&friends),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::CurrentLocationNotInvitable,
            }
        );

        let mut invite_plus = base_input();
        set_current_location(
            &mut invite_plus,
            "wrld_a:1~private(usr_other)~canRequestInvite",
        );
        invite_plus.location.last_location.clear();
        assert_eq!(
            evaluate_invite_automation(&invite_plus),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::CurrentLocationNotInvitable,
            }
        );

        invite_plus.location.last_location = invite_plus.location.current_location().into();
        assert!(matches!(
            evaluate_invite_automation(&invite_plus),
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

        let mut backing_off = base_input();
        backing_off.cooldown.in_failure_backoff = true;
        assert_eq!(
            evaluate_invite_automation(&backing_off),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::FailureBackoff,
            }
        );
    }

    #[test]
    fn message_slot_accepts_only_vrchat_slot_range() {
        assert_eq!(normalize_invite_message_slot("0"), Some(0));
        assert_eq!(normalize_invite_message_slot(" 11 "), Some(11));
        assert_eq!(normalize_invite_message_slot(""), None);
        assert_eq!(normalize_invite_message_slot("12"), None);
        assert_eq!(normalize_invite_message_slot("-1"), None);
    }
}
