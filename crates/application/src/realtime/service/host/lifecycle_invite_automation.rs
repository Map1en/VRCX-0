use std::collections::HashSet;
use std::sync::Arc;

use serde_json::{json, Value};
use vrcx_0_core::json::RawJson;
use vrcx_0_vrchat_client::notifications::{invite_send_input, notification_hide_remote_input};

use crate::social_baseline::{
    build_favorites_baseline, SocialBaselineDeps, SocialFavoritesBaselineInput,
};

use super::*;

impl RealtimeHostRuntime {
    pub(super) fn schedule_invite_automation(
        self: &Arc<Self>,
        projection: &RealtimeNotificationProjection,
    ) {
        let notifications = projection
            .upserts
            .iter()
            .filter(|upsert| {
                upsert.run_automation && notification_type(&upsert.notification) == "requestInvite"
            })
            .map(|upsert| upsert.notification.clone())
            .collect::<Vec<_>>();
        for notification in notifications {
            let runtime = Arc::clone(self);
            self.deps.tasks.spawn(async move {
                runtime.run_invite_automation(notification).await;
            });
        }
    }

    async fn run_invite_automation(self: Arc<Self>, notification: Value) {
        let facts = notification_facts(&notification);
        if facts.sender_user_id.is_empty() {
            self.record_invite_automation_skip(InviteAutomationSkipReason::InvalidNotification);
            return;
        }
        let Some(session) = self.active_invite_session() else {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::MissingCurrentSessionOrLocation,
            );
            return;
        };
        let scope_key =
            sender_scope_key(&session.endpoint, &session.user_id, &facts.sender_user_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let gate = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("invite automation state lock failed: {error}");
                    return;
                }
            };
            let cooldown = state.invite_automation.cooldown_view(&scope_key);
            if cooldown.is_pending {
                Err(InviteAutomationSkipReason::Pending)
            } else if state
                .invite_automation
                .is_in_failure_backoff(&scope_key, now_ms)
            {
                Err(InviteAutomationSkipReason::FailureBackoff)
            } else {
                state.invite_automation.begin(&scope_key);
                Ok(cooldown)
            }
        };
        let cooldown = match gate {
            Ok(cooldown) => cooldown,
            Err(reason) => {
                self.record_invite_automation_skip(reason);
                return;
            }
        };

        let result = self
            .run_invite_automation_inner(
                notification,
                facts,
                session,
                scope_key.clone(),
                cooldown,
                now_ms,
            )
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
            state.invite_automation.finish(&scope_key, outcome, now_ms);
        }
    }

    async fn run_invite_automation_inner(
        &self,
        notification: Value,
        notification_facts: InviteNotificationFacts,
        session: RealtimeSessionContext,
        scope_key: String,
        cooldown: crate::realtime::invite_automation::decision::CooldownView,
        now_ms: i64,
    ) -> Result<bool> {
        let config = load_invite_automation_config(self.deps.db.as_ref())?;
        let location = self.current_invite_location_facts(&session);
        if config.mode == InviteAutomationMode::Off {
            self.record_invite_automation_skip(InviteAutomationSkipReason::Disabled);
            return Ok(false);
        }
        if !location.is_game_running {
            self.record_invite_automation_skip(InviteAutomationSkipReason::GameNotRunning);
            return Ok(false);
        }
        if location.current_user_id.trim().is_empty()
            || location.current_location.trim().is_empty()
            || location.current_location.trim() == "traveling"
        {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::MissingCurrentSessionOrLocation,
            );
            return Ok(false);
        }
        if cooldown
            .last_sent_at_ms
            .map(|last_sent_at| {
                now_ms.saturating_sub(last_sent_at)
                    < crate::realtime::invite_automation::decision::INVITE_AUTOMATION_COOLDOWN_MS
            })
            .unwrap_or(false)
        {
            self.record_invite_automation_skip(InviteAutomationSkipReason::Cooldown);
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
            cooldown,
            now_ms,
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
        if latest_location.current_location != instance_id || !latest_location.is_game_running {
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
            .resolve_invite_world_name(&session.endpoint, &world_id)
            .await;
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
        if !(200..=299).contains(&response.status) {
            return Err(Error::Custom(format!(
                "invite automation send returned HTTP {}",
                response.status
            )));
        }

        self.cleanup_invite_request_notification(&session, &notification, &notification_facts)
            .await;
        self.deps.sync.record(
            "inviteAutomation",
            "sent",
            format!("Invite automation sent invite to {receiver_user_id}."),
            1,
        );
        tracing::debug!(scope_key, "invite automation completed");
        Ok(true)
    }

    fn active_invite_session(&self) -> Option<RealtimeSessionContext> {
        self.state.lock().ok().and_then(|state| {
            state
                .active_context
                .as_ref()
                .map(|active| active.session.clone())
        })
    }

    fn current_invite_location_facts(
        &self,
        session: &RealtimeSessionContext,
    ) -> InviteLocationFacts {
        let host_session = self.deps.session.snapshot();
        let game_log = self
            .deps
            .game_log_snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default();
        let closed_locations = self
            .state
            .lock()
            .map(|state| state.invite_automation.closed_locations())
            .unwrap_or_default();
        let current_location = game_log.location.trim().to_string();
        InviteLocationFacts {
            is_game_running: host_session.is_game_running,
            last_location: current_location.clone(),
            current_location,
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
        // requestInvite, after the cheap config/location/cooldown gates.
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
        let friend_roster_by_id = self
            .friends
            .snapshot()
            .map(|snapshot| {
                serde_json::to_value(snapshot.friends_by_id).unwrap_or_else(|_| json!({}))
            })
            .unwrap_or_else(|| json!({}));
        let output = build_favorites_baseline(
            SocialBaselineDeps {
                db: Arc::clone(&self.deps.db),
                web: Arc::clone(&self.deps.web),
                auth_scope: self.deps.auth_scope.clone(),
                session: self.deps.session.clone(),
            },
            SocialFavoritesBaselineInput {
                user_id: session.user_id.clone(),
                endpoint: session.endpoint.clone(),
                current_user_snapshot: RawJson::from(current_user_snapshot),
                friend_roster_by_id: RawJson::from(friend_roster_by_id),
            },
        )
        .await?;
        if output.stale {
            return Ok(None);
        }
        Ok(output.snapshot.map(RawJson::into_value))
    }

    async fn resolve_invite_world_name(&self, endpoint: &str, world_id: &str) -> String {
        self.fetch_and_cache_world(endpoint.to_string(), world_id.to_string())
            .await
            .unwrap_or_else(|| world_id.to_string())
    }

    async fn cleanup_invite_request_notification(
        &self,
        session: &RealtimeSessionContext,
        notification: &Value,
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
            notification_type = notification_type(notification),
            "invite automation cleaned notification"
        );
    }

    fn record_invite_automation_skip(&self, reason: InviteAutomationSkipReason) {
        self.deps.sync.record(
            "inviteAutomation",
            "skipped",
            format!("Invite automation skipped: {}.", reason.as_str()),
            0,
        );
    }
}

pub(super) fn notification_type(notification: &Value) -> String {
    string_field(notification.get("type"))
}

pub(super) fn notification_facts(notification: &Value) -> InviteNotificationFacts {
    InviteNotificationFacts {
        id: string_field(notification.get("id")),
        notification_type: notification_type(notification),
        sender_user_id: string_field(notification.get("senderUserId")),
        version: int_field(notification.get("version")).unwrap_or(1),
    }
}

fn load_invite_automation_config(db: &DatabaseService) -> Result<InviteAutomationConfig> {
    let mode = normalize_invite_automation_mode(&config_store::get_string(
        db,
        "autoAcceptInviteRequests",
        "Off",
    )?);
    let selected_groups = safe_string_array(&config_store::get_string(
        db,
        "autoAcceptInviteGroups",
        "[]",
    )?);
    Ok(InviteAutomationConfig {
        mode,
        selected_groups,
    })
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
    let is_favorite = string_array(snapshot.get("favoriteFriendIds"))
        .iter()
        .any(|user_id| user_id == sender_user_id);
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
        if string_array(Some(user_ids))
            .iter()
            .any(|user_id| user_id == sender_user_id)
        {
            groups.insert(format!("{key_prefix}{group_key}"));
        }
    }
}

fn safe_string_array(value: &str) -> Vec<String> {
    serde_json::from_str::<Value>(value)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .map(|value| string_field(Some(&value)))
        .filter(|value: &String| !value.is_empty())
        .collect()
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|value| string_field(Some(value)))
                .filter(|value: &String| !value.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn string_field(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .map(str::to_string)
        .unwrap_or_else(|| {
            value
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
                .trim()
                .to_string()
        })
}

fn int_field(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_i64)
        .or_else(|| string_field(value).parse().ok())
}
