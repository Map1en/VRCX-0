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
        if let Ok(mut maintenance) = self.authenticated_session_maintenance.lock() {
            *maintenance = None;
        }
        let previous = self
            .backend_frontend_session
            .lock()
            .ok()
            .and_then(|mut slot| slot.take());
        self.authenticated_runtime.stop();
        self.runtime_context
            .overlay_activity()
            .clear_runtime_state();
        if let Some(extension) = &self.profile_extension {
            extension.clear_profile_session();
        }
        self.runtime_context.session.clear_realtime_context();
        if let Some(previous) = previous {
            self.runtime_context
                .event_bus
                .emit(RuntimeGroupInstancesProjection {
                    status: "idle".into(),
                    user_id: previous.user_id,
                    endpoint: previous.endpoint,
                    fetched_at: None,
                    error: Some(String::new()),
                    instances: Some(Vec::new()),
                    group_order: Some(Vec::new()),
                });
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
                self.runtime_context
                    .overlay_activity()
                    .clear_runtime_state();
                if let Some(extension) = &self.profile_extension {
                    extension.profile_session_scope_changed();
                }
            }
            *slot = Some(snapshot);
        }
    }

    pub fn start_frontend_authenticated_runtime(
        &self,
        user_id: String,
        endpoint: String,
        websocket: String,
        current_user_snapshot: Value,
    ) -> Result<vrcx_0_application::AuthenticatedRuntimePhaseSnapshot> {
        let user_id = user_id.trim().to_string();
        if user_id.is_empty() {
            return Err(crate::Error::Custom(
                "Authenticated runtime requires an authenticated user id.".into(),
            ));
        }
        let display_name = string_field(&current_user_snapshot, "displayName")
            .or_else(|| string_field(&current_user_snapshot, "username"))
            .unwrap_or_else(|| user_id.clone());
        let session =
            AuthenticatedRuntimeSession::from_user(current_user_snapshot, endpoint, websocket);
        if session.user_id != user_id {
            return Err(crate::Error::Custom(
                "Authenticated runtime user does not match the current user snapshot.".into(),
            ));
        }
        let auth_scope = self
            .runtime_context
            .auth_scope
            .set(&session.user_id, &session.endpoint);
        self.set_backend_frontend_session(&session);
        self.backend_runtime
            .set_auth_success(user_id.clone(), display_name.clone());
        let snapshot = self.backend_runtime.set_phase(BackendRuntimePhase::Running);
        self.emit_backend_runtime_telemetry_snapshot("authSuccess", display_name, snapshot);
        self.schedule_activity_warmup(user_id, auth_scope.generation);
        self.start_social_maintenance_loops();
        self.start_profile_maintenance_loops();
        self.authenticated_runtime.start(session)
    }

    pub fn authenticated_session_maintenance(
        &self,
    ) -> Result<AuthenticatedSessionMaintenanceOutcome> {
        let scope = self.runtime_context.auth_scope.snapshot();
        if !scope.active || scope.current_user_id.trim().is_empty() {
            return Err(crate::Error::Custom(
                "Authenticated session maintenance requires an active auth scope.".into(),
            ));
        }
        self.run_authenticated_session_maintenance_for_user(&scope.current_user_id)
    }

    pub(super) fn run_authenticated_session_maintenance_for_user(
        &self,
        user_id: &str,
    ) -> Result<AuthenticatedSessionMaintenanceOutcome> {
        let user_id = user_id.trim();
        let scope = self.runtime_context.auth_scope.snapshot();
        if !scope.active || scope.current_user_id != user_id {
            return Err(crate::Error::Custom(
                "Authenticated session maintenance scope does not match the current user.".into(),
            ));
        }
        let mut slot = self
            .authenticated_session_maintenance
            .lock()
            .map_err(|error| crate::Error::Custom(format!("session maintenance lock: {error}")))?;
        if let Some(current) = slot.as_ref().filter(|current| current.user_id == user_id) {
            return Ok(current.clone());
        }
        let outcome =
            vrcx_0_application::run_authenticated_session_maintenance(self.db.as_ref(), user_id)?;
        *slot = Some(outcome.clone());
        Ok(outcome)
    }
}

pub fn update_backend_frontend_session_user_if_session_matches(
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

pub fn replace_backend_frontend_session_user_if_session_matches(
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
