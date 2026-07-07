use super::message_dispatch::json_string_field;
use super::types::ActiveRealtimeContext;
use super::*;
use crate::realtime::user_query_cache::UserQueryKind;
use crate::vrchat_api::VrchatApiResponse;
use vrcx_0_core::user_facts::UserFactMergeOptions;

const FRIEND_PROFILE_REFETCH_THROTTLE_MS: i64 = 10_000;

impl RealtimeHostRuntime {
    pub fn apply_friend_profile_refresh(
        self: &Arc<Self>,
        endpoint: String,
        user_id: String,
        mut profile: serde_json::Value,
    ) -> Result<bool> {
        let normalized_user_id = user_id.trim().to_string();
        if normalized_user_id.is_empty() {
            return Ok(false);
        }
        let profile_user_id = json_string_field(profile.get("id"));
        if profile_user_id != normalized_user_id {
            return Ok(false);
        }
        if let Some(profile_object) = profile.as_object_mut() {
            vrcx_0_core::friends::strip_default_avatar_image(profile_object);
        }
        let requested_endpoint = endpoint.trim().to_string();
        let active = {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(format!("realtime state lock: {error}")))?;
            let Some(active) = state.active_context.clone() else {
                return Ok(false);
            };
            if active.session.endpoint != requested_endpoint
                || !self.is_message_current_locked(
                    &state,
                    active.generation,
                    active.session_generation,
                    &active.session,
                )
            {
                return Ok(false);
            }
            active
        };
        if !self
            .friends
            .has_friend(active.generation, &normalized_user_id)
        {
            return Ok(false);
        }
        match self.friends.apply_refetched_user_profile(
            active.generation,
            &normalized_user_id,
            profile,
            &chrono::Utc::now().to_rfc3339(),
        ) {
            RealtimeFriendApplyResult::Output(output) => {
                self.apply_friend_output(*output);
                let runtime = Arc::clone(self);
                let endpoint = requested_endpoint.clone();
                let user_id = normalized_user_id.clone();
                self.deps.tasks.spawn(async move {
                    runtime
                        .user_query_cache
                        .invalidate_user(&endpoint, &user_id)
                        .await;
                });
                Ok(true)
            }
            RealtimeFriendApplyResult::MissingBaseline | RealtimeFriendApplyResult::Ignored => {
                Ok(false)
            }
        }
    }

    pub(super) fn active_endpoint(&self) -> String {
        self.state
            .lock()
            .ok()
            .and_then(|state| {
                state
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
            Ok(state) => match state.active_context.as_ref() {
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
        if let Some(output) = self.user_cache.record_user(profile, options) {
            self.emit_user_cache_changes(vec![output.user]);
        }
    }

    pub(super) fn emit_user_cache_changes(&self, users: Vec<serde_json::Map<String, Value>>) {
        if users.is_empty() {
            return;
        }
        let payload = serde_json::json!({
            "users": users.into_iter().map(Value::Object).collect::<Vec<_>>(),
        });
        self.deps.event_bus.emit_realtime_user_projection(payload);
    }

    pub(super) fn record_users_into_cache(&self, values: &[Value], options: &UserFactMergeOptions) {
        let mut changed = Vec::new();
        for value in values {
            if let Some(output) = self.user_cache.record_user(value, options.clone()) {
                changed.push(output.user);
            }
        }
        self.emit_user_cache_changes(changed);
    }

    pub(super) fn record_baseline_friends_into_cache(&self) {
        let Some(snapshot) = self.friends.snapshot() else {
            return;
        };
        let values: Vec<Value> = snapshot
            .friends_by_id
            .values()
            .map(|record| serde_json::to_value(record).unwrap_or(Value::Null))
            .collect();
        self.record_users_into_cache(
            &values,
            &UserFactMergeOptions {
                endpoint: snapshot.endpoint,
                source: "friend".into(),
                received_at: chrono::Utc::now().to_rfc3339(),
                is_friend: true,
                ..Default::default()
            },
        );
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
                state_bucket: entry
                    .get("stateBucket")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                ..Default::default()
            };
            if let Some(output) = self.user_cache.record_user(user, options) {
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
        let (user_id, request) = remote_users::user_get_input(endpoint.clone(), user_id_input)?;
        let kind = UserQueryKind::from_request(dialog, is_friend);
        if force {
            self.user_query_cache
                .invalidate_user(&endpoint, &user_id)
                .await;
        }
        let runtime = Arc::clone(self);
        let response = self
            .user_query_cache
            .get_or_fetch(kind, &endpoint, &user_id, async move {
                let resp = runtime
                    .deps
                    .web
                    .execute_api(request, ApiScope::Vrchat, &runtime.deps.db)
                    .await?;
                Ok(Arc::new(resp))
            })
            .await
            .map_err(|error| Error::Custom(format!("getUser query cache: {error}")))?;
        let status = response.status;
        if !(200..300).contains(&status)
            && !crate::realtime::user_query_cache::is_negative_cacheable_status(status)
        {
            self.user_query_cache
                .invalidate(kind, &endpoint, &user_id)
                .await;
        }
        self.ingest_user_get_response(&endpoint, &user_id, &response);
        let mut value = (*response).clone();
        if (200..300).contains(&value.status) {
            if let Ok(Value::Object(mut object)) = serde_json::from_str::<Value>(&value.data) {
                vrcx_0_core::user_facts::apply_derived_fields(&mut object);
                if let Ok(data) = serde_json::to_string(&Value::Object(object)) {
                    value.data = data;
                }
            }
        }
        Ok(value)
    }

    pub async fn invalidate_user_query_cache(&self, endpoint: &str, user_id: &str) {
        if user_id.trim().is_empty() {
            return;
        }
        self.user_query_cache
            .invalidate_user(endpoint, user_id)
            .await;
    }

    fn ingest_user_get_response(
        self: &Arc<Self>,
        endpoint: &str,
        requested_user_id: &str,
        response: &VrchatApiResponse,
    ) {
        if !(200..300).contains(&response.status) {
            return;
        }
        let profile = match serde_json::from_str::<Value>(&response.data) {
            Ok(profile) => profile,
            Err(error) => {
                tracing::warn!("getUser response json decode failed: {error}");
                return;
            }
        };
        let profile_user_id = json_string_field(profile.get("id"));
        if profile_user_id != requested_user_id {
            tracing::warn!(
                requested_user_id = %requested_user_id,
                profile_user_id = %profile_user_id,
                "[Realtime] getUser response user mismatch; skipping merge"
            );
            return;
        }
        self.record_user_profile(endpoint, &profile);
        if let Err(error) = self.apply_friend_profile_refresh(
            endpoint.to_string(),
            requested_user_id.to_string(),
            profile,
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
        let (active, refetch_ids) = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("realtime state lock failed: {error}");
                    return;
                }
            };
            let Some(active) = state.active_context.clone() else {
                return;
            };
            if active.generation != generation
                || !self
                    .deps
                    .session
                    .is_realtime_generation_active(active.session_generation)
            {
                return;
            }
            let mut refetch_ids = Vec::new();
            for user_id in user_ids {
                let user_id = user_id.trim().to_string();
                if user_id.is_empty() || refetch_ids.contains(&user_id) {
                    continue;
                }
                let recent = state
                    .friend_profile_refetches
                    .get(&user_id)
                    .map(|last_ms| {
                        now_ms.saturating_sub(*last_ms) < FRIEND_PROFILE_REFETCH_THROTTLE_MS
                    })
                    .unwrap_or(false);
                if recent {
                    continue;
                }
                state
                    .friend_profile_refetches
                    .insert(user_id.clone(), now_ms);
                refetch_ids.push(user_id);
            }
            (active, refetch_ids)
        };
        for user_id in refetch_ids {
            let runtime = Arc::clone(self);
            let active = active.clone();
            self.deps.tasks.spawn(async move {
                runtime.refetch_friend_profile(active, user_id).await;
            });
        }
    }

    async fn refetch_friend_profile(
        self: Arc<Self>,
        active: ActiveRealtimeContext,
        user_id: String,
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
        let (_, request) = match remote_users::user_get_input(
            active.session.endpoint.clone(),
            user_id.clone(),
        ) {
            Ok(request) => request,
            Err(error) => {
                tracing::warn!(user_id = %user_id, "Realtime friend profile refetch input failed: {error}");
                return;
            }
        };
        let response = match self
            .deps
            .web
            .execute_api(request, ApiScope::Vrchat, &self.deps.db)
            .await
        {
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
        match self.friends.apply_refetched_user_profile(
            active.generation,
            &user_id,
            profile,
            &chrono::Utc::now().to_rfc3339(),
        ) {
            RealtimeFriendApplyResult::Output(output) => {
                self.apply_friend_output(*output);
                self.user_query_cache
                    .invalidate_user(&active.session.endpoint, &user_id)
                    .await;
            }
            RealtimeFriendApplyResult::MissingBaseline | RealtimeFriendApplyResult::Ignored => {}
        }
    }
}
