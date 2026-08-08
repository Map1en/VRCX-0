use std::collections::HashSet;
use std::sync::Arc;
use vrcx_0_application_core::RuntimeOperationStatus;

use serde_json::{json, Value};
use vrcx_0_application_core::{Error, LocalGameContextSnapshot, Result};
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::config as config_store;
use vrcx_0_persistence::invite_history::{
    invite_automation_receipt_exists, record_invite_automation_receipt,
    record_successful_invite_send, successful_invite_send_exists_for_notification,
};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{ApiJsonResponse, ApiScope};
use vrcx_0_vrchat_client::notifications::{
    invite_response_send_input, invite_send_input, notification_hide_remote_input,
};

use crate::realtime::invite_automation::decision::{
    context_gates, delivery_gate, evaluate_invite_automation, normalize_invite_automation_mode,
    scheduled_message_reply_slot, DeliveryView, InviteAutomationConfig, InviteAutomationInput,
    InviteAutomationSkipReason, InviteDecision, InviteLocationFacts, InviteMessageReplyConfig,
    InviteNotificationFacts, SenderAllowlist,
};
use crate::realtime::invite_automation::runtime::{notification_scope_key, InviteOutcome};
use crate::realtime::{RealtimeNotificationProjection, RealtimeSessionContext};
use crate::social_baseline::{
    build_favorites_baseline_from_friend_records, SocialBaselineDeps,
    SocialFavoritesBaselineRequest,
};

use super::message_dispatch::json_string_field;
use super::RealtimeHostRuntime;

impl RealtimeHostRuntime {
    pub(super) fn schedule_invite_automation(
        self: &Arc<Self>,
        projection: &RealtimeNotificationProjection,
    ) {
        let notifications = projection
            .upserts
            .iter()
            .filter(|upsert| {
                upsert.run_automation
                    && matches!(
                        notification_type(&upsert.notification).as_str(),
                        "invite" | "requestInvite"
                    )
            })
            .map(|upsert| upsert.notification.clone())
            .collect::<Vec<_>>();
        if notifications.is_empty() {
            return;
        }
        let generation = projection.generation;
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            for notification in notifications {
                Arc::clone(&runtime)
                    .run_invite_automation(notification, generation)
                    .await;
            }
        });
    }

    async fn run_invite_automation(self: Arc<Self>, notification: Value, generation: u64) {
        // Tokio's mutex is FIFO, so each notification action is attempted once
        // in arrival order without imposing an artificial per-sender delay.
        let _action_guard = self.invite_automation_action_lock.lock().await;
        let facts = notification_facts(&notification);
        if facts.id.is_empty() || facts.sender_user_id.is_empty() {
            self.record_invite_automation_skip(InviteAutomationSkipReason::InvalidNotification);
            return;
        }
        let Some(session) = self.active_invite_session(generation) else {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::MissingCurrentSessionOrLocation,
            );
            return;
        };
        let scope_key = notification_scope_key(&session.endpoint, &session.user_id, &facts.id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let persistent_receipt =
            invite_automation_receipt_exists(self.deps.db.as_ref(), &session.user_id, &facts.id)
                .and_then(|exists| {
                    if exists {
                        Ok(true)
                    } else {
                        successful_invite_send_exists_for_notification(
                            self.deps.db.as_ref(),
                            &session.user_id,
                            &facts.id,
                        )
                    }
                });
        match persistent_receipt {
            Ok(true) => {
                if let Ok(mut state) = self.state.lock() {
                    state
                        .automation
                        .invite
                        .finish(&scope_key, InviteOutcome::Sent, now_ms);
                }
                self.cleanup_invite_notification(&session, &facts).await;
                self.record_invite_automation_skip(InviteAutomationSkipReason::AlreadyProcessed);
                return;
            }
            Ok(false) => {}
            Err(error) => {
                tracing::warn!("invite automation replay guard failed: {error}");
                self.deps
                    .sync
                    .record_failure("inviteAutomation", error.to_string());
                return;
            }
        }
        let gate = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("invite automation state lock failed: {error}");
                    return;
                }
            };
            let delivery = state.automation.invite.delivery_view(&scope_key, now_ms);
            match delivery_gate(&delivery) {
                Err(reason) => Err(reason),
                Ok(()) => {
                    state.automation.invite.begin(&scope_key);
                    Ok(delivery)
                }
            }
        };
        let delivery = match gate {
            Ok(delivery) => delivery,
            Err(reason) => {
                self.record_invite_automation_skip(reason);
                return;
            }
        };

        let result = self
            .run_invite_automation_inner(facts, session, scope_key.clone(), delivery)
            .await;
        let outcome = match &result {
            Ok(true) => InviteOutcome::Sent,
            Ok(false) => InviteOutcome::Skipped,
            Err(error) => {
                tracing::warn!("invite automation failed: {error}");
                self.deps
                    .sync
                    .record_failure("inviteAutomation", error.to_string());
                InviteOutcome::Failed
            }
        };
        if let Ok(mut state) = self.state.lock() {
            state.automation.invite.finish(&scope_key, outcome, now_ms);
        }
    }

    async fn run_invite_automation_inner(
        &self,
        notification_facts: InviteNotificationFacts,
        session: RealtimeSessionContext,
        scope_key: String,
        delivery: DeliveryView,
    ) -> Result<bool> {
        let config = load_invite_automation_config(self.deps.db.as_ref())?;
        let message_config = load_invite_message_reply_config(self.deps.db.as_ref())?;
        if let Some(response_slot) = scheduled_message_reply_slot(
            &message_config,
            &notification_facts.notification_type,
            chrono::Local::now(),
        ) {
            if !self.is_current_friend(&notification_facts.sender_user_id) {
                self.record_invite_automation_skip(InviteAutomationSkipReason::SenderNotFriend);
                return Ok(false);
            }
            self.send_scheduled_invite_message_reply(&session, &notification_facts, response_slot)
                .await?;
            tracing::debug!(scope_key, "scheduled invite message reply completed");
            return Ok(true);
        }
        if notification_facts.notification_type != "requestInvite" {
            return Ok(false);
        }
        let location = self.current_invite_location_facts(&session);
        if let Err(reason) = context_gates(&config, &location) {
            self.record_invite_automation_skip(reason);
            return Ok(false);
        }
        let allowlist = self
            .build_sender_allowlist(&session, &notification_facts.sender_user_id)
            .await?;
        let input = InviteAutomationInput {
            notification: notification_facts.clone(),
            config,
            allowlist,
            location,
            delivery,
        };
        let decision = evaluate_invite_automation(&input);
        let InviteDecision::Send {
            receiver_user_id,
            instance_id,
            world_id,
        } = decision
        else {
            if let InviteDecision::Skip { reason } = decision {
                self.record_invite_automation_skip(reason);
            }
            return Ok(false);
        };

        let latest_location = self.current_invite_location_facts(&session);
        if latest_location.current_location() != instance_id || !latest_location.is_game_running() {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::MissingCurrentSessionOrLocation,
            );
            return Ok(false);
        }
        if latest_location.closed_locations.contains(&instance_id) {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::CurrentLocationNotInvitable,
            );
            return Ok(false);
        }

        let world_name = self
            .fetch_and_cache_world(session.endpoint.clone(), world_id.clone())
            .await
            .unwrap_or_else(|| world_id.clone());
        let (_, request) = invite_send_input(
            session.endpoint.clone(),
            receiver_user_id.clone(),
            json!({
                "instanceId": instance_id,
                "worldId": world_id,
                "worldName": world_name,
                "rsvp": true,
            }),
        )?;
        let response = self
            .deps
            .web
            .execute_api(request, ApiScope::Vrchat, self.deps.db.as_ref())
            .await?;
        let parsed = ApiJsonResponse::parse(response.status, &response.data);
        if parsed.is_failure() {
            return Err(Error::Custom(format!(
                "invite automation send failed: {}",
                parsed.error_message_or("VRChat invite request failed")
            )));
        }
        record_successful_invite_send(
            self.deps.db.as_ref(),
            &session.user_id,
            &receiver_user_id,
            "realtime-auto-invite",
            Some(&notification_facts.id),
        )?;
        record_invite_automation_receipt(
            self.deps.db.as_ref(),
            &session.user_id,
            &notification_facts.id,
            "invite-send",
            &receiver_user_id,
        )?;

        self.cleanup_invite_notification(&session, &notification_facts)
            .await;
        self.deps.sync.record(
            "inviteAutomation",
            RuntimeOperationStatus::Sent,
            format!("Invite automation sent invite to {receiver_user_id}."),
            1,
        );
        tracing::debug!(scope_key, "invite automation completed");
        Ok(true)
    }

    fn is_current_friend(&self, sender_user_id: &str) -> bool {
        self.friends
            .snapshot()
            .is_some_and(|snapshot| snapshot.friends_by_id.contains_key(sender_user_id.trim()))
    }

    async fn send_scheduled_invite_message_reply(
        &self,
        session: &RealtimeSessionContext,
        facts: &InviteNotificationFacts,
        response_slot: i64,
    ) -> Result<()> {
        let (_, request) =
            invite_response_send_input(session.endpoint.clone(), facts.id.clone(), response_slot)?;
        let response = self
            .deps
            .web
            .execute_api(request, ApiScope::Vrchat, self.deps.db.as_ref())
            .await?;
        let parsed = ApiJsonResponse::parse(response.status, &response.data);
        if parsed.is_failure() {
            return Err(Error::Custom(format!(
                "scheduled invite message reply failed: {}",
                parsed.error_message_or("VRChat invite response failed")
            )));
        }
        let action = match facts.notification_type.as_str() {
            "invite" => "invite-message-response",
            "requestInvite" => "request-invite-message-response",
            _ => "invite-message-response",
        };
        record_invite_automation_receipt(
            self.deps.db.as_ref(),
            &session.user_id,
            &facts.id,
            action,
            &facts.sender_user_id,
        )?;
        self.cleanup_invite_notification(session, facts).await;
        self.deps.sync.record(
            "inviteAutomation",
            RuntimeOperationStatus::Sent,
            format!(
                "Scheduled message slot {response_slot} sent for {} from {}.",
                facts.notification_type, facts.sender_user_id
            ),
            1,
        );
        Ok(())
    }

    fn active_invite_session(&self, generation: u64) -> Option<RealtimeSessionContext> {
        self.state.lock().ok().and_then(|state| {
            state
                .connection
                .active_context
                .as_ref()
                .filter(|active| active.generation == generation)
                .map(|active| active.session.clone())
        })
    }

    fn current_invite_location_facts(
        &self,
        session: &RealtimeSessionContext,
    ) -> InviteLocationFacts {
        let local_game_context = self.deps.local_game_context.snapshot();
        let closed_locations = self
            .state
            .lock()
            .map(|state| state.automation.invite.closed_locations())
            .unwrap_or_default();
        let current_location = match &local_game_context {
            LocalGameContextSnapshot::Unavailable => String::new(),
            LocalGameContextSnapshot::Available { location, .. } => location.trim().to_string(),
        };
        InviteLocationFacts {
            local_game_context,
            last_location: current_location.clone(),
            current_user_id: session.user_id.clone(),
            closed_locations,
        }
    }

    async fn build_sender_allowlist(
        &self,
        session: &RealtimeSessionContext,
        sender_user_id: &str,
    ) -> Result<SenderAllowlist> {
        // Fetched fresh per evaluation so a newly added favorite is effective
        // immediately; only reached for auto-invite-enabled users on an actual
        // requestInvite, after the cheap config/location/delivery gates.
        match self.fetch_favorites_snapshot(session).await? {
            Some(snapshot) => Ok(sender_allowlist_from_snapshot(&snapshot, sender_user_id)),
            None => Ok(SenderAllowlist {
                is_favorite: false,
                group_keys_of_sender: HashSet::new(),
            }),
        }
    }

    async fn fetch_favorites_snapshot(
        &self,
        session: &RealtimeSessionContext,
    ) -> Result<Option<Value>> {
        let current_user_snapshot = self
            .current_user_snapshot()
            .unwrap_or_else(|| json!({ "id": session.user_id }));
        let friends_by_id = self
            .friends
            .snapshot()
            .map(|snapshot| snapshot.friends_by_id)
            .unwrap_or_default();
        let output = build_favorites_baseline_from_friend_records(
            SocialBaselineDeps {
                db: Arc::clone(&self.deps.db),
                web: Arc::clone(&self.deps.web),
                auth_scope: self.deps.auth_scope.clone(),
                session: self.deps.session.clone(),
            },
            SocialFavoritesBaselineRequest {
                user_id: session.user_id.clone(),
                endpoint: session.endpoint.clone(),
                current_user_snapshot: RawJson::from(current_user_snapshot),
            },
            &friends_by_id,
        )
        .await?;
        if output.stale {
            return Ok(None);
        }
        Ok(output.snapshot.map(|snapshot| snapshot.into_value()))
    }

    async fn cleanup_invite_notification(
        &self,
        session: &RealtimeSessionContext,
        facts: &InviteNotificationFacts,
    ) {
        let Ok((_, request)) = notification_hide_remote_input(
            session.endpoint.clone(),
            facts.id.clone(),
            facts.version,
            facts.notification_type.clone(),
            facts.sender_user_id.clone(),
        ) else {
            return;
        };
        if let Err(error) = self
            .deps
            .web
            .execute_api(request, ApiScope::Vrchat, self.deps.db.as_ref())
            .await
        {
            tracing::warn!("invite automation notification hide failed: {error}");
        }
        if let Err(error) = self.expire_notification(session.user_id.clone(), facts.id.clone()) {
            tracing::warn!("invite automation local notification expiration failed: {error}");
        }
        self.deps
            .event_bus
            .emit_realtime_notification_projection(RealtimeNotificationProjection {
                generation: 0,
                expired_ids: vec![facts.id.clone()],
                seen_ids: vec![facts.id.clone()],
                clear_menu_if_no_unseen: true,
                ..RealtimeNotificationProjection::default()
            });
        tracing::debug!(
            notification_id = facts.id,
            notification_type = facts.notification_type,
            "invite automation cleaned notification"
        );
    }

    fn record_invite_automation_skip(&self, reason: InviteAutomationSkipReason) {
        self.deps.sync.record(
            "inviteAutomation",
            RuntimeOperationStatus::Skipped,
            format!("Invite automation skipped: {}.", reason.as_str()),
            0,
        );
    }
}

pub(super) fn notification_type(notification: &Value) -> String {
    json_string_field(notification.get("type"))
}

pub(super) fn notification_facts(notification: &Value) -> InviteNotificationFacts {
    InviteNotificationFacts {
        id: json_string_field(notification.get("id")),
        notification_type: notification_type(notification),
        sender_user_id: json_string_field(notification.get("senderUserId")),
        version: notification.i64_field("version").unwrap_or(1),
    }
}

fn load_invite_automation_config(db: &DatabaseService) -> Result<InviteAutomationConfig> {
    let mode = normalize_invite_automation_mode(&config_store::get_string(
        db,
        "autoAcceptInviteRequests",
        "Off",
    )?);
    let groups = config_store::get_json(db, "autoAcceptInviteGroups", json!([]))?;
    let selected_groups = groups
        .as_array()
        .into_iter()
        .flatten()
        .map(|value| json_string_field(Some(value)))
        .filter(|value| !value.is_empty())
        .collect();
    Ok(InviteAutomationConfig {
        mode,
        selected_groups,
    })
}

fn load_invite_message_reply_config(db: &DatabaseService) -> Result<InviteMessageReplyConfig> {
    let value = config_store::get_json(db, "autoInviteMessageReplies", json!({}))?;
    let defaults = InviteMessageReplyConfig::default();
    let days = value
        .get("days")
        .and_then(Value::as_array)
        .map(|values| {
            let mut days = values
                .iter()
                .filter_map(|value| {
                    value
                        .as_u64()
                        .or_else(|| value.as_str()?.parse::<u64>().ok())
                })
                .filter(|day| (1..=7).contains(day))
                .map(|day| day as u32)
                .collect::<Vec<_>>();
            days.sort_unstable();
            days.dedup();
            days
        })
        .unwrap_or(defaults.days);
    Ok(InviteMessageReplyConfig {
        enabled: value
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        invite_enabled: value
            .get("inviteEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        invite_response_slot: value.get("inviteResponseSlot").and_then(value_i64),
        request_invite_enabled: value
            .get("requestInviteEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        request_invite_response_slot: value.get("requestInviteResponseSlot").and_then(value_i64),
        days,
        start: value
            .get("start")
            .and_then(Value::as_str)
            .unwrap_or(&defaults.start)
            .trim()
            .to_string(),
        end: value
            .get("end")
            .and_then(Value::as_str)
            .unwrap_or(&defaults.end)
            .trim()
            .to_string(),
    })
}

fn value_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str()?.trim().parse::<i64>().ok())
}

fn sender_allowlist_from_snapshot(snapshot: &Value, sender_user_id: &str) -> SenderAllowlist {
    let sender_user_id = sender_user_id.trim();
    let mut group_keys = HashSet::new();
    collect_sender_groups(
        &mut group_keys,
        snapshot.get("groupedFavoriteFriendIdsByGroupKey"),
        "",
        sender_user_id,
    );
    collect_sender_groups(
        &mut group_keys,
        snapshot.get("localFriendFavorites"),
        "local:",
        sender_user_id,
    );
    let is_favorite = json_array_contains_user(snapshot.get("favoriteFriendIds"), sender_user_id);
    SenderAllowlist {
        is_favorite,
        group_keys_of_sender: group_keys,
    }
}

fn collect_sender_groups(
    groups: &mut HashSet<String>,
    value: Option<&Value>,
    key_prefix: &str,
    sender_user_id: &str,
) {
    let Some(object) = value.and_then(Value::as_object) else {
        return;
    };
    for (group_key, user_ids) in object {
        if json_array_contains_user(Some(user_ids), sender_user_id) {
            groups.insert(format!("{key_prefix}{group_key}"));
        }
    }
}

fn json_array_contains_user(value: Option<&Value>, sender_user_id: &str) -> bool {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|value| json_string_field(Some(value)) == sender_user_id)
}
