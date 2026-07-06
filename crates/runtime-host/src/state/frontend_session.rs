use super::*;

impl RuntimeHostState {
    pub fn backend_runtime_frontend_session_snapshot(
        &self,
    ) -> Option<BackendRuntimeFrontendSessionSnapshot> {
        let runtime = self.backend_runtime.snapshot();
        if runtime.phase != BackendRuntimePhase::Running
            || runtime.auth_status != "authenticated"
            || runtime.auth_user_id.is_empty()
        {
            return None;
        }

        let cached = self
            .backend_frontend_session
            .lock()
            .ok()
            .and_then(|snapshot| snapshot.clone());
        let auth_scope = self.runtime_context.auth_scope.snapshot();
        let current_user_snapshot = self
            .realtime_runtime
            .current_user_snapshot()
            .or_else(|| {
                cached
                    .as_ref()
                    .map(|snapshot| snapshot.current_user_snapshot.clone())
            })
            .unwrap_or_else(|| {
                json!({
                    "id": runtime.auth_user_id,
                    "displayName": runtime.auth_display_name,
                })
            });
        let friend_snapshot = self.realtime_runtime.friend_snapshot();
        let auth_scope_endpoint = if auth_scope.active {
            Some(auth_scope.endpoint)
        } else {
            None
        };

        Some(BackendRuntimeFrontendSessionSnapshot {
            authenticated: true,
            user_id: runtime.auth_user_id,
            display_name: runtime.auth_display_name,
            endpoint: friend_snapshot
                .as_ref()
                .map(|snapshot| snapshot.endpoint.clone())
                .filter(|endpoint| !endpoint.trim().is_empty())
                .or(auth_scope_endpoint)
                .or_else(|| cached.as_ref().map(|snapshot| snapshot.endpoint.clone()))
                .unwrap_or_default(),
            websocket: friend_snapshot
                .as_ref()
                .map(|snapshot| snapshot.websocket.clone())
                .filter(|websocket| !websocket.trim().is_empty())
                .or_else(|| cached.as_ref().map(|snapshot| snapshot.websocket.clone()))
                .unwrap_or_default(),
            current_user_snapshot,
        })
    }

    pub fn clear_backend_frontend_session(&self) {
        let previous = self
            .backend_frontend_session
            .lock()
            .ok()
            .and_then(|mut slot| slot.take());
        self.runtime_context.overlay_activity.clear_runtime_state();
        self.realtime_runtime.stop(RealtimeStopRequest::default());
        self.vr_overlay_runtime.clear_friends_panel_session_state();
        self.runtime_context.session.clear_realtime_context();
        if let Some(previous) = previous {
            self.runtime_context
                .event_bus
                .emit_runtime_group_instances_projection(json!({
                    "status": "idle",
                    "userId": previous.user_id,
                    "endpoint": previous.endpoint,
                    "instances": [],
                    "groupOrder": [],
                    "error": "",
                }));
        }
    }

    pub(super) fn set_backend_frontend_session(&self, session: &AuthenticatedRuntimeSession) {
        let snapshot = BackendRuntimeFrontendSessionSnapshot {
            authenticated: true,
            user_id: session.user_id.clone(),
            display_name: session.display_name.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: session.current_user.clone(),
        };
        if let Ok(mut slot) = self.backend_frontend_session.lock() {
            let scope_changed = slot
                .as_ref()
                .map(|current| {
                    current.user_id != snapshot.user_id
                        || current.endpoint != snapshot.endpoint
                        || current.websocket != snapshot.websocket
                })
                .unwrap_or(true);
            if scope_changed {
                self.runtime_context.overlay_activity.clear_runtime_state();
                self.vr_overlay_runtime.clear_friends_panel_session_state();
            }
            *slot = Some(snapshot);
        }
    }

    pub fn sync_frontend_authenticated_session(
        &self,
        user_id: String,
        endpoint: String,
        websocket: String,
        current_user_snapshot: Value,
    ) {
        let user_id = user_id.trim().to_string();
        if user_id.is_empty() {
            return;
        }
        let display_name = string_field(&current_user_snapshot, "displayName")
            .or_else(|| string_field(&current_user_snapshot, "username"))
            .unwrap_or_else(|| user_id.clone());
        self.runtime_context.auth_scope.set(&user_id, &endpoint);
        let snapshot = BackendRuntimeFrontendSessionSnapshot {
            authenticated: true,
            user_id: user_id.clone(),
            display_name: display_name.clone(),
            endpoint,
            websocket,
            current_user_snapshot,
        };
        if let Ok(mut slot) = self.backend_frontend_session.lock() {
            let scope_changed = slot
                .as_ref()
                .map(|current| {
                    current.user_id != snapshot.user_id
                        || current.endpoint != snapshot.endpoint
                        || current.websocket != snapshot.websocket
                })
                .unwrap_or(true);
            if scope_changed {
                self.runtime_context.overlay_activity.clear_runtime_state();
                self.vr_overlay_runtime.clear_friends_panel_session_state();
            }
            *slot = Some(snapshot);
        }
        self.backend_runtime
            .set_auth_success(user_id, display_name.clone());
        let snapshot = self.backend_runtime.set_phase(BackendRuntimePhase::Running);
        self.emit_backend_runtime_telemetry_snapshot("authSuccess", display_name, snapshot);
        self.start_gui_background_capability_loops();
    }
}

pub(super) fn update_backend_frontend_session_user_if_session_matches(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    expected: &BackgroundCapabilitySession,
    updated_user: &Value,
) -> bool {
    let Ok(mut slot) = session_slot.lock() else {
        return false;
    };
    if !session_slot_matches(Some(&slot), expected) {
        return false;
    }
    let Some(session) = slot.as_mut() else {
        return false;
    };
    let mut merged = session.current_user_snapshot.clone();
    if let (Some(target), Some(source)) = (merged.as_object_mut(), updated_user.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    } else {
        merged = updated_user.clone();
    }
    session.current_user_snapshot = merged;
    if let Some(display_name) =
        string_field(updated_user, "displayName").or_else(|| string_field(updated_user, "username"))
    {
        session.display_name = display_name;
    }
    true
}

pub(super) fn update_backend_frontend_session_user_filtered_if_session_matches(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    expected: &BackgroundCapabilitySession,
    updated_user: &Value,
) -> bool {
    let mut filtered = updated_user.clone();
    remove_current_user_refresh_local_authority_fields(&mut filtered);
    update_backend_frontend_session_user_if_session_matches(session_slot, expected, &filtered)
}

pub(super) fn replace_backend_frontend_session_user_if_session_matches(
    session_slot: &Arc<Mutex<Option<BackendRuntimeFrontendSessionSnapshot>>>,
    expected: &BackgroundCapabilitySession,
    snapshot: &Value,
) -> bool {
    let Ok(mut slot) = session_slot.lock() else {
        return false;
    };
    if !session_slot_matches(Some(&slot), expected) {
        return false;
    }
    let Some(session) = slot.as_mut() else {
        return false;
    };
    session.current_user_snapshot = snapshot.clone();
    if let Some(display_name) =
        string_field(snapshot, "displayName").or_else(|| string_field(snapshot, "username"))
    {
        session.display_name = display_name;
    }
    true
}

pub(super) fn session_slot_matches(
    slot: Option<&Option<BackendRuntimeFrontendSessionSnapshot>>,
    expected: &BackgroundCapabilitySession,
) -> bool {
    slot.and_then(Option::as_ref)
        .map(|current| {
            current.user_id == expected.current_user_id
                && current.endpoint == expected.endpoint
                && current.websocket == expected.websocket
        })
        .unwrap_or(false)
}

fn remove_current_user_refresh_local_authority_fields(value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for field in CURRENT_USER_REFRESH_LOCAL_AUTHORITY_FIELDS {
        object.remove(*field);
    }
}

pub(super) fn favorite_group_membership_from_snapshot(
    snapshot: Value,
) -> HashMap<String, Vec<String>> {
    let mut groups = HashMap::new();
    append_favorite_group_membership(
        &mut groups,
        snapshot.get("groupedFavoriteFriendIdsByGroupKey"),
        "",
    );
    append_favorite_group_membership(&mut groups, snapshot.get("localFriendFavorites"), "local:");
    groups
}

fn append_favorite_group_membership(
    groups: &mut HashMap<String, Vec<String>>,
    value: Option<&Value>,
    key_prefix: &str,
) {
    let Some(object) = value.and_then(Value::as_object) else {
        return;
    };
    for (group_key, user_ids) in object {
        let key = format!("{key_prefix}{group_key}");
        let user_ids: Vec<String> = user_ids
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| value.as_str().map(str::trim).map(str::to_string))
            .filter(|value| !value.is_empty())
            .collect();
        if !user_ids.is_empty() {
            groups.insert(key, user_ids);
        }
    }
}
