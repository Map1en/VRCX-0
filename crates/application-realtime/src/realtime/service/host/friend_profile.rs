use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::vrchat_api::VrchatScope as ApiScope;

use super::message_dispatch::json_string_field;
use super::state::ActiveRealtimeContext;
use super::RealtimeHostRuntime;
use crate::realtime::{
    RealtimeFriendApplyResult, RealtimeUserProjection, UserQueryCachePolicy, UserQueryKind,
    UserQueryOptions,
};
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::json::{RawJson, RawJsonObject};
use vrcx_0_core::user_facts::UserFactMergeOptions;

const FRIEND_PROFILE_REFETCH_THROTTLE_MS: i64 = 10_000;

#[derive(Clone, Copy)]
pub(super) struct FriendProfileRefreshExpectation {
    pub(super) generation: u64,
    pub(super) rev: u64,
}

impl RealtimeHostRuntime {
    pub(super) fn apply_friend_profile_refresh(
        self: &Arc<Self>,
        endpoint: String,
        user_id: String,
        profile: serde_json::Value,
        expectation: FriendProfileRefreshExpectation,
    ) -> Result<bool> {
        let normalized_user_id = user_id.trim().to_string();
        if normalized_user_id.is_empty() {
            return Ok(false);
        }
        let profile_user_id = json_string_field(profile.get("id"));
        if profile_user_id != normalized_user_id {
            return Ok(false);
        }
        let requested_endpoint = endpoint.trim().to_string();
        let Some(active) = self
            .state
            .lock()
            .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?
            .connection
            .active_context
            .clone()
        else {
            return Ok(false);
        };
        if expectation.generation != active.generation
            || active.session.endpoint != requested_endpoint
            || !self.apply_refetched_friend_profile(
                &active,
                &normalized_user_id,
                expectation.rev,
                profile,
            )
        {
            return Ok(false);
        }
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            runtime
                .user_query_cache
                .invalidate_user(&requested_endpoint, &normalized_user_id)
                .await;
        });
        Ok(true)
    }

    fn apply_refetched_friend_profile(
        self: &Arc<Self>,
        active: &ActiveRealtimeContext,
        user_id: &str,
        rev: u64,
        profile: Value,
    ) -> bool {
        let owner = self.lock_friend_owner();
        let current = match self.state.lock() {
            Ok(state) => self.is_message_current_locked(
                &state,
                active.generation,
                active.session_generation,
                &active.session,
            ),
            Err(error) => {
                tracing::warn!("realtime state lock failed: {error}");
                false
            }
        };
        if !current {
            return false;
        }
        match self.friends.apply_refetched_user_profile_if_rev(
            active.generation,
            user_id,
            rev,
            profile,
            &chrono::Utc::now().to_rfc3339(),
        ) {
            RealtimeFriendApplyResult::Output(output) => {
                self.apply_friend_output_owned(&owner, *output);
                true
            }
            RealtimeFriendApplyResult::MissingBaseline | RealtimeFriendApplyResult::Ignored => {
                false
            }
        }
    }

    pub(super) fn active_endpoint(&self) -> String {
        self.state
            .lock()
            .ok()
            .and_then(|state| {
                state
                    .connection
                    .active_context
                    .as_ref()
                    .map(|active| active.session.endpoint.clone())
            })
            .unwrap_or_default()
    }

    pub fn record_user_profile(&self, endpoint: &str, profile: &serde_json::Value) {
        let user_id = json_string_field(profile.get("id"));
        if user_id.is_empty() {
            return;
        }
        let (is_friend, is_current_user) = match self.state.lock() {
            Ok(state) => match state.connection.active_context.as_ref() {
                Some(active) => (
                    self.friends.has_friend(active.generation, &user_id),
                    active.session.user_id == user_id,
                ),
                None => (false, false),
            },
            Err(_) => (false, false),
        };
        if is_current_user {
            return;
        }
        let options = UserFactMergeOptions {
            endpoint: endpoint.to_string(),
            source: "profile".to_string(),
            received_at: chrono::Utc::now().to_rfc3339(),
            is_friend,
            ..Default::default()
        };
        if let Some(output) = self.user_facts.record_user(profile, &options) {
            self.emit_user_cache_changes(vec![output.user]);
        }
    }

    pub(super) fn emit_user_cache_changes(&self, users: Vec<RawJsonObject>) {
        if users.is_empty() {
            return;
        }
        self.deps.event_bus.emit(RealtimeUserProjection {
            users: users
                .into_iter()
                .map(|user| RawJson::from(Value::Object(user.into_map())))
                .collect(),
        });
    }

    pub(super) fn collect_friend_record_cache_changes<'a>(
        &self,
        records: impl IntoIterator<Item = &'a FriendRecord>,
        options: &UserFactMergeOptions,
    ) -> Vec<RawJsonObject> {
        records
            .into_iter()
            .filter_map(|record| {
                let value = serde_json::to_value(record)
                    .expect("FriendRecord contains only JSON-serializable fields");
                self.user_facts
                    .record_user(&value, options)
                    .map(|output| output.user)
            })
            .collect()
    }

    pub(super) fn record_baseline_friends_into_cache(&self) {
        let Some(changed) = self.friends.with_user_cache_records(|endpoint, records| {
            self.collect_friend_record_cache_changes(
                records,
                &UserFactMergeOptions {
                    endpoint: endpoint.to_string(),
                    source: "friend".into(),
                    received_at: chrono::Utc::now().to_rfc3339(),
                    is_friend: true,
                    ..Default::default()
                },
            )
        }) else {
            return;
        };
        self.emit_user_cache_changes(changed);
    }

    pub fn ingest_user_facts(&self, entries: Vec<Value>) {
        let endpoint = self.active_endpoint();
        if endpoint.is_empty() {
            return;
        }
        let mut changed = Vec::new();
        for entry in &entries {
            let Some(user) = entry.get("user") else {
                continue;
            };
            if entry
                .get("isCurrentUser")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                continue;
            }
            let options = UserFactMergeOptions {
                endpoint: endpoint.clone(),
                source: entry
                    .get("source")
                    .and_then(Value::as_str)
                    .unwrap_or("seed")
                    .to_string(),
                received_at: chrono::Utc::now().to_rfc3339(),
                is_friend: entry
                    .get("isFriend")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                ..Default::default()
            };
            if let Some(output) = self.user_facts.record_user(user, &options) {
                changed.push(output.user);
            }
        }
        self.emit_user_cache_changes(changed);
    }

    pub async fn get_user_via_cache(
        self: &Arc<Self>,
        endpoint: String,
        user_id_input: String,
        force: bool,
        dialog: bool,
        is_friend: Option<bool>,
    ) -> Result<VrchatApiResponse> {
        let kind = if dialog {
            UserQueryKind::Dialog
        } else if is_friend == Some(true) {
            UserQueryKind::LiveFriend
        } else {
            UserQueryKind::LiveNonFriend
        };
        self.get_user_via_cache_with_options(
            endpoint,
            user_id_input,
            UserQueryOptions {
                kind,
                cache_policy: if force {
                    UserQueryCachePolicy::Refresh
                } else {
                    UserQueryCachePolicy::UseCache
                },
            },
        )
        .await
    }

    pub async fn get_user_via_cache_with_options(
        self: &Arc<Self>,
        endpoint: String,
        user_id_input: String,
        options: UserQueryOptions,
    ) -> Result<VrchatApiResponse> {
        let (user_id, request) = self
            .deps
            .remote_requests
            .user(endpoint.clone(), user_id_input)?;
        let refresh_expectation = self.capture_friend_rev(&user_id);
        if options.cache_policy == UserQueryCachePolicy::Refresh {
            self.user_query_cache
                .invalidate_user(&endpoint, &user_id)
                .await;
        }
        let runtime = Arc::clone(self);
        let fetched = Arc::new(AtomicBool::new(false));
        let fetch_marker = Arc::clone(&fetched);
        let response = self
            .user_query_cache
            .get_or_fetch(options.kind, &endpoint, &user_id, async move {
                let resp = runtime
                    .deps
                    .web
                    .execute_api(request, ApiScope::Vrchat)
                    .await?;
                fetch_marker.store(true, Ordering::SeqCst);
                Ok(Arc::new(resp))
            })
            .await
            .map_err(|error| Error::Custom(format!("getUser query cache: {error}")))?;
        let status = response.status;
        if !(200..300).contains(&status)
            && !crate::realtime::user_query_cache::is_negative_cacheable_status(status)
        {
            self.user_query_cache
                .invalidate(options.kind, &endpoint, &user_id)
                .await;
        }
        let mut value = (*response).clone();
        if (200..300).contains(&value.status) {
            let was_fetched = fetched.load(Ordering::SeqCst);
            match serde_json::from_str::<Value>(&value.data) {
                Ok(mut profile) => {
                    if was_fetched {
                        self.ingest_user_get_profile(
                            &endpoint,
                            &user_id,
                            &profile,
                            refresh_expectation,
                        );
                    }
                    if let Some(object) = profile.as_object_mut() {
                        vrcx_0_core::user_facts::apply_derived_fields(object);
                        if let Ok(data) = serde_json::to_string(&profile) {
                            value.data = data;
                        }
                    }
                }
                Err(error) if was_fetched => {
                    tracing::warn!("getUser response json decode failed: {error}");
                }
                Err(_) => {}
            }
        }
        Ok(value)
    }

    fn capture_friend_rev(&self, user_id: &str) -> Option<FriendProfileRefreshExpectation> {
        let generation = {
            let state = self.state.lock().ok()?;
            state
                .connection
                .active_context
                .as_ref()
                .map(|active| active.generation)?
        };
        self.friends
            .friend_rev_of(generation, user_id)
            .map(|rev| FriendProfileRefreshExpectation { generation, rev })
    }

    pub async fn invalidate_user_query_cache(&self, endpoint: &str, user_id: &str) {
        if user_id.trim().is_empty() {
            return;
        }
        self.user_query_cache
            .invalidate_user(endpoint, user_id)
            .await;
    }

    fn ingest_user_get_profile(
        self: &Arc<Self>,
        endpoint: &str,
        requested_user_id: &str,
        profile: &Value,
        expectation: Option<FriendProfileRefreshExpectation>,
    ) {
        let profile_user_id = json_string_field(profile.get("id"));
        if profile_user_id != requested_user_id {
            tracing::warn!(
                requested_user_id = %requested_user_id,
                profile_user_id = %profile_user_id,
                "[Realtime] getUser response user mismatch; skipping merge"
            );
            return;
        }
        self.record_user_profile(endpoint, profile);
        let Some(expectation) = expectation else {
            return;
        };
        if let Err(error) = self.apply_friend_profile_refresh(
            endpoint.to_string(),
            requested_user_id.to_string(),
            profile.clone(),
            expectation,
        ) {
            tracing::warn!(
                user_id = %requested_user_id,
                "getUser friend profile refresh failed: {error}"
            );
        }
    }

    pub(super) fn schedule_friend_profile_refetches(
        self: &Arc<Self>,
        generation: u64,
        user_ids: Vec<String>,
    ) {
        if user_ids.is_empty() {
            return;
        }
        let now_ms = chrono::Utc::now().timestamp_millis();
        let (active, refetches) = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            let Some(active) = state.connection.active_context.clone() else {
                return;
            };
            if active.generation != generation || !self.is_session_live(&active) {
                return;
            }
            let mut refetches = Vec::new();
            for user_id in user_ids {
                let user_id = user_id.trim().to_string();
                if user_id.is_empty()
                    || refetches
                        .iter()
                        .any(|(refetch_user_id, _)| refetch_user_id == &user_id)
                {
                    continue;
                }
                let recent = state
                    .friend_profile
                    .refetches
                    .get(&user_id)
                    .map(|last_ms| {
                        now_ms.saturating_sub(*last_ms) < FRIEND_PROFILE_REFETCH_THROTTLE_MS
                    })
                    .unwrap_or(false);
                if recent {
                    continue;
                }
                let Some(expected_rev) = self.friends.friend_rev_of(active.generation, &user_id)
                else {
                    continue;
                };
                state
                    .friend_profile
                    .refetches
                    .insert(user_id.clone(), now_ms);
                refetches.push((user_id, expected_rev));
            }
            (active, refetches)
        };
        for (user_id, expected_rev) in refetches {
            let runtime = Arc::clone(self);
            let active = active.clone();
            self.deps.tasks.spawn(async move {
                runtime
                    .refetch_friend_profile(active, user_id, expected_rev)
                    .await;
            });
        }
    }

    async fn refetch_friend_profile(
        self: Arc<Self>,
        active: ActiveRealtimeContext,
        user_id: String,
        expected_rev: u64,
    ) {
        {
            let state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            if !self.is_message_current_locked(
                &state,
                active.generation,
                active.session_generation,
                &active.session,
            ) {
                return;
            }
        }
        let (_, request) = match self
            .deps
            .remote_requests
            .user(active.session.endpoint.clone(), user_id.clone())
        {
            Ok(request) => request,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch input failed: {error}");
                return;
            }
        };
        let response = match self.deps.web.execute_api(request, ApiScope::Vrchat).await {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch failed: {error}");
                return;
            }
        };
        if !(200..300).contains(&response.status) {
            tracing::warn!(
                user_id = %user_id,
                status = response.status,
                "Realtime friend profile refetch returned non-success"
            );
            return;
        }
        let profile = match serde_json::from_str::<Value>(&response.data) {
            Ok(profile) => profile,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch json failed: {error}");
                return;
            }
        };
        let profile_user_id = json_string_field(profile.get("id"));
        if profile_user_id != user_id {
            tracing::warn!(
                expected_user_id = %user_id,
                profile_user_id = %profile_user_id,
                "Realtime friend profile refetch returned a different user"
            );
            return;
        }
        if self.apply_refetched_friend_profile(&active, &user_id, expected_rev, profile) {
            self.user_query_cache
                .invalidate_user(&active.session.endpoint, &user_id)
                .await;
        }
    }
}
