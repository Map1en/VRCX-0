use std::collections::HashSet;

use chrono::{DateTime, Datelike, Timelike};
use vrcx_0_application_core::LocalGameContextSnapshot;
use vrcx_0_core::location::parse_location;

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
pub struct InviteMessageReplyConfig {
    pub enabled: bool,
    pub invite_enabled: bool,
    pub invite_response_slot: Option<i64>,
    pub request_invite_enabled: bool,
    pub request_invite_response_slot: Option<i64>,
    pub days: Vec<u32>,
    pub start: String,
    pub end: String,
}

impl Default for InviteMessageReplyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            invite_enabled: false,
            invite_response_slot: None,
            request_invite_enabled: false,
            request_invite_response_slot: None,
            days: (1..=7).collect(),
            start: "00:00".into(),
            end: "00:00".into(),
        }
    }
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
pub struct DeliveryView {
    pub is_pending: bool,
    pub is_processed: bool,
    pub in_failure_backoff: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InviteAutomationInput {
    pub notification: InviteNotificationFacts,
    pub config: InviteAutomationConfig,
    pub allowlist: SenderAllowlist,
    pub location: InviteLocationFacts,
    pub delivery: DeliveryView,
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
    SenderNotFriend,
    SenderNotAllowlisted,
    LocalGameContextUnavailable,
    GameNotRunning,
    MissingCurrentSessionOrLocation,
    CurrentLocationNotInvitable,
    Pending,
    AlreadyProcessed,
    FailureBackoff,
}

impl InviteAutomationSkipReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::InvalidNotification => "invalid-notification",
            Self::SenderNotFriend => "sender-not-friend",
            Self::SenderNotAllowlisted => "sender-not-allowlisted",
            Self::LocalGameContextUnavailable => "local-game-context-unavailable",
            Self::GameNotRunning => "game-not-running",
            Self::MissingCurrentSessionOrLocation => "missing-current-session-or-location",
            Self::CurrentLocationNotInvitable => "current-location-not-invitable",
            Self::Pending => "notification-action-pending",
            Self::AlreadyProcessed => "notification-already-processed",
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

pub fn context_gates(
    config: &InviteAutomationConfig,
    location: &InviteLocationFacts,
) -> Result<(), InviteAutomationSkipReason> {
    if config.mode == InviteAutomationMode::Off {
        return Err(InviteAutomationSkipReason::Disabled);
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

pub fn delivery_gate(delivery: &DeliveryView) -> Result<(), InviteAutomationSkipReason> {
    if delivery.is_pending {
        return Err(InviteAutomationSkipReason::Pending);
    }
    if delivery.is_processed {
        return Err(InviteAutomationSkipReason::AlreadyProcessed);
    }
    if delivery.in_failure_backoff {
        return Err(InviteAutomationSkipReason::FailureBackoff);
    }
    Ok(())
}

/// Returns the configured VRChat message slot when a notification should be
/// answered now. Overnight windows attribute the after-midnight portion to the
/// previous selected day, matching the other scheduled automation settings.
pub fn scheduled_message_reply_slot<Tz: chrono::TimeZone>(
    config: &InviteMessageReplyConfig,
    notification_type: &str,
    now: DateTime<Tz>,
) -> Option<i64> {
    if !config.enabled {
        return None;
    }
    let slot = match notification_type {
        "invite" if config.invite_enabled => config.invite_response_slot,
        "requestInvite" if config.request_invite_enabled => config.request_invite_response_slot,
        _ => None,
    }?;
    if !(0..=11).contains(&slot) {
        return None;
    }
    let start = parse_clock_minutes(&config.start)?;
    let end = parse_clock_minutes(&config.end)?;
    let minute = now.hour() * 60 + now.minute();
    let today = now.weekday().number_from_monday();
    let previous_day = if today == 1 { 7 } else { today - 1 };
    let day_selected = |day| config.days.is_empty() || config.days.contains(&day);

    let in_window = if start == end {
        day_selected(today)
    } else if start < end {
        day_selected(today) && minute >= start && minute < end
    } else if minute >= start {
        day_selected(today)
    } else {
        minute < end && day_selected(previous_day)
    };
    in_window.then_some(slot)
}

fn parse_clock_minutes(value: &str) -> Option<u32> {
    let (hour, minute) = value.trim().split_once(':')?;
    let hour = hour.parse::<u32>().ok()?;
    let minute = minute.parse::<u32>().ok()?;
    (hour < 24 && minute < 60).then_some(hour * 60 + minute)
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
    if let Err(reason) = delivery_gate(&input.delivery) {
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
    use chrono::{FixedOffset, TimeZone};

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
                closed_locations: HashSet::new(),
            },
            delivery: DeliveryView {
                is_pending: false,
                is_processed: false,
                in_failure_backoff: false,
            },
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
    fn skips_pending_processed_and_failure_backoff() {
        let mut pending = base_input();
        pending.delivery.is_pending = true;
        assert_eq!(
            evaluate_invite_automation(&pending),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::Pending,
            }
        );

        let mut processed = base_input();
        processed.delivery.is_processed = true;
        assert_eq!(
            evaluate_invite_automation(&processed),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::AlreadyProcessed,
            }
        );

        let mut backing_off = base_input();
        backing_off.delivery.in_failure_backoff = true;
        assert_eq!(
            evaluate_invite_automation(&backing_off),
            InviteDecision::Skip {
                reason: InviteAutomationSkipReason::FailureBackoff,
            }
        );
    }

    fn message_config(start: &str, end: &str, days: Vec<u32>) -> InviteMessageReplyConfig {
        InviteMessageReplyConfig {
            enabled: true,
            invite_enabled: true,
            invite_response_slot: Some(2),
            request_invite_enabled: true,
            request_invite_response_slot: Some(5),
            days,
            start: start.into(),
            end: end.into(),
        }
    }

    #[test]
    fn scheduled_message_reply_selects_slots_by_notification_type() {
        let zone = FixedOffset::east_opt(9 * 3600).unwrap();
        let monday_noon = zone.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap();
        let config = message_config("09:00", "18:00", vec![1]);

        assert_eq!(
            scheduled_message_reply_slot(&config, "invite", monday_noon),
            Some(2)
        );
        assert_eq!(
            scheduled_message_reply_slot(&config, "requestInvite", monday_noon),
            Some(5)
        );
        assert_eq!(
            scheduled_message_reply_slot(&config, "friendRequest", monday_noon),
            None
        );
    }

    #[test]
    fn scheduled_message_reply_rejects_out_of_range_slots() {
        let zone = FixedOffset::east_opt(9 * 3600).unwrap();
        let monday_noon = zone.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap();
        let mut config = message_config("00:00", "00:00", vec![1]);
        config.invite_response_slot = Some(12);
        config.request_invite_response_slot = Some(-1);

        assert_eq!(
            scheduled_message_reply_slot(&config, "invite", monday_noon),
            None
        );
        assert_eq!(
            scheduled_message_reply_slot(&config, "requestInvite", monday_noon),
            None
        );
    }

    #[test]
    fn overnight_schedule_uses_previous_day_after_midnight() {
        let zone = FixedOffset::east_opt(9 * 3600).unwrap();
        let config = message_config("22:00", "02:00", vec![1]);
        let monday_late = zone.with_ymd_and_hms(2026, 8, 3, 23, 0, 0).unwrap();
        let tuesday_early = zone.with_ymd_and_hms(2026, 8, 4, 1, 30, 0).unwrap();
        let tuesday_late = zone.with_ymd_and_hms(2026, 8, 4, 3, 0, 0).unwrap();

        assert_eq!(
            scheduled_message_reply_slot(&config, "invite", monday_late),
            Some(2)
        );
        assert_eq!(
            scheduled_message_reply_slot(&config, "invite", tuesday_early),
            Some(2)
        );
        assert_eq!(
            scheduled_message_reply_slot(&config, "invite", tuesday_late),
            None
        );
    }

    #[test]
    fn equal_schedule_bounds_mean_all_day_on_selected_days() {
        let zone = FixedOffset::east_opt(9 * 3600).unwrap();
        let config = message_config("00:00", "00:00", vec![1]);
        let monday = zone.with_ymd_and_hms(2026, 8, 3, 23, 59, 0).unwrap();
        let tuesday = zone.with_ymd_and_hms(2026, 8, 4, 0, 0, 0).unwrap();

        assert_eq!(
            scheduled_message_reply_slot(&config, "invite", monday),
            Some(2)
        );
        assert_eq!(
            scheduled_message_reply_slot(&config, "invite", tuesday),
            None
        );
    }
}
