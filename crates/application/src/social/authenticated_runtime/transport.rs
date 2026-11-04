use serde_json::json;
use vrcx_0_application_core::{
    Error, RuntimeAuthScopeSnapshot, RuntimeVrchatAuthFailurePayload, TaskStopToken,
};
use vrcx_0_application_realtime::{
    RealtimeStopRequest, RealtimeTransportLifecycleEvent, RealtimeTransportStartResult,
    RealtimeTransportTermination,
};
use vrcx_0_core::OwnerId;

use crate::auth::{
    AuthenticatedRuntimeSession, AuthenticatedRuntimeStepSnapshot, AuthenticatedRuntimeStepStatus,
};

use super::state::{apply_realtime_connected, RuntimeStep};
use super::{AuthenticatedRuntimeOrchestrator, TRANSPORT_MONITOR_POLL_INTERVAL};

impl AuthenticatedRuntimeOrchestrator {
    pub(super) async fn run_realtime_with_rebaseline(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
    ) {
        let mut attempt: u32 = 1;
        let mut roster_stale = false;
        loop {
            let termination = self
                .run_realtime_transport(session, scope, run_id, stop_token, attempt)
                .await;
            let (reason, probe_auth) = match termination {
                Some(RealtimeTransportTermination::UnexpectedExit {
                    reason,
                    connected_secs,
                }) => {
                    if connected_secs.is_some() {
                        attempt = 1;
                        roster_stale = true;
                    }
                    self.trail(
                        "retryScheduled",
                        json!({
                            "runId": run_id,
                            "attempt": attempt,
                            "connectedSecs": connected_secs,
                            "reason": reason,
                        }),
                    );
                    (reason, false)
                }
                Some(RealtimeTransportTermination::AuthExpired {
                    reason,
                    status_code,
                }) => {
                    self.trail(
                        "retryScheduled",
                        json!({
                            "runId": run_id,
                            "attempt": attempt,
                            "authCode": status_code,
                            "reason": reason,
                        }),
                    );
                    (reason, true)
                }
                None => {
                    self.trail(
                        "supervisionEnded",
                        json!({ "runId": run_id, "stage": "inactive" }),
                    );
                    return;
                }
                Some(RealtimeTransportTermination::Stopped) => {
                    self.trail(
                        "supervisionEnded",
                        json!({ "runId": run_id, "stage": "stopped" }),
                    );
                    return;
                }
            };

            self.mark_realtime_lost(run_id);
            if !self
                .wait_before_retry(
                    run_id,
                    RuntimeStep::Realtime,
                    attempt,
                    reason,
                    scope,
                    stop_token,
                )
                .await
            {
                self.trail(
                    "supervisionEnded",
                    json!({ "runId": run_id, "stage": "retryWait" }),
                );
                return;
            }
            if probe_auth {
                self.probe_auth_session(session, scope, run_id, attempt)
                    .await;
            }
            if roster_stale {
                match self
                    .try_friend_baseline(session, scope, run_id, stop_token, attempt)
                    .await
                {
                    Ok(Some(friend_ids_by_roster_id)) => {
                        self.trail(
                            "rebaselined",
                            json!({
                                "runId": run_id,
                                "attempt": attempt,
                                "friends": friend_ids_by_roster_id.len(),
                            }),
                        );
                        roster_stale = false;
                    }
                    Ok(None) => {
                        self.trail(
                            "supervisionEnded",
                            json!({ "runId": run_id, "stage": "rebaseline" }),
                        );
                        return;
                    }
                    Err(error) => self.trail(
                        "rebaselineSkipped",
                        json!({
                            "runId": run_id,
                            "attempt": attempt,
                            "reason": error.to_string(),
                        }),
                    ),
                }
            }
            attempt = attempt.saturating_add(1);
        }
    }

    async fn run_realtime_transport(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        stop_token: &TaskStopToken,
        attempt: u32,
    ) -> Option<RealtimeTransportTermination> {
        if !self.is_active(run_id, scope, stop_token) {
            return None;
        }
        self.set_step_running(run_id, RuntimeStep::Realtime, attempt);
        let mut lifecycle = self.realtime_runtime.subscribe_transport_lifecycle();
        let result = match self.realtime_runtime.start_from_friend_baseline(
            session.user_id.clone(),
            session.endpoint.clone(),
            session.websocket.clone(),
            run_id,
            session.current_user.as_value().clone(),
        ) {
            Ok(result) => result,
            Err(error) => {
                return Some(RealtimeTransportTermination::UnexpectedExit {
                    reason: error.to_string(),
                    connected_secs: None,
                });
            }
        };
        if !self.is_active(run_id, scope, stop_token) {
            self.realtime_runtime.stop(RealtimeStopRequest {
                user_id: Some(session.user_id.clone()),
                endpoint: Some(session.endpoint.clone()),
                websocket: Some(session.websocket.clone()),
                client_run_id: Some(run_id),
                generation: Some(result.generation),
            });
            return None;
        }
        self.update_snapshot(run_id, |snapshot| {
            snapshot.realtime = AuthenticatedRuntimeStepSnapshot {
                status: AuthenticatedRuntimeStepStatus::Running,
                attempt,
                detail: "Realtime transport is waiting for a connection.".into(),
                ..Default::default()
            };
            snapshot.realtime_transport = Some(result.clone());
        });
        self.monitor_realtime_transport(run_id, scope, stop_token, attempt, result, &mut lifecycle)
            .await
    }

    async fn monitor_realtime_transport(
        &self,
        run_id: u64,
        scope: &RuntimeAuthScopeSnapshot,
        stop_token: &TaskStopToken,
        attempt: u32,
        transport: RealtimeTransportStartResult,
        lifecycle: &mut tokio::sync::broadcast::Receiver<RealtimeTransportLifecycleEvent>,
    ) -> Option<RealtimeTransportTermination> {
        loop {
            if !self.is_active(run_id, scope, stop_token) {
                return None;
            }
            self.refresh_realtime_interruption(run_id);
            tokio::select! {
                event = lifecycle.recv() => {
                    match event {
                        Ok(RealtimeTransportLifecycleEvent::Connected(connected))
                            if connected == transport =>
                        {
                            self.update_state(run_id, |state| {
                                if apply_realtime_connected(&mut state.phase, attempt, &transport) {
                                    state.realtime_outage.end();
                                }
                            });
                            self.mark_ready_if_complete(run_id);
                        }
                        Ok(RealtimeTransportLifecycleEvent::Finished {
                            transport: finished,
                            termination,
                        }) => {
                            if finished != transport {
                                continue;
                            }
                            if !self.is_active(run_id, scope, stop_token) {
                                return None;
                            }
                            return Some(termination);
                        }
                        Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            return None;
                        }
                    }
                }
                _ = tokio::time::sleep(TRANSPORT_MONITOR_POLL_INTERVAL) => {}
            }
        }
    }

    async fn probe_auth_session(
        &self,
        session: &AuthenticatedRuntimeSession,
        scope: &RuntimeAuthScopeSnapshot,
        run_id: u64,
        attempt: u32,
    ) {
        let result = self.auth_probe.probe(&session.endpoint).await;
        match result {
            Ok(status) => {
                self.trail(
                    "authProbe",
                    json!({
                        "runId": run_id,
                        "attempt": attempt,
                        "probeStatus": status,
                    }),
                );
                if matches!(status, 401 | 403) {
                    self.emit_auth_failure_if_needed(
                        scope,
                        "runtime/realtime-auth-probe",
                        &Error::VrchatApi {
                            status_code: status,
                            message: format!("Realtime auth probe was rejected (HTTP {}).", status),
                        },
                    );
                }
            }
            Err(error) => self.trail(
                "authProbe",
                json!({
                    "runId": run_id,
                    "attempt": attempt,
                    "reason": error.to_string(),
                }),
            ),
        }
    }

    pub(super) fn emit_auth_failure_if_needed(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        path: &str,
        error: &Error,
    ) {
        let Some(status_code) = vrchat_auth_failure_status(error) else {
            return;
        };
        let reason = error.to_string();
        if !self.auth_scope.snapshot().generation_matches(scope) {
            return;
        }
        self.auth_scope.report_vrchat_auth_failure(
            &self.event_bus,
            RuntimeVrchatAuthFailurePayload {
                owner_user_id: OwnerId::new(scope.current_user_id.clone()),
                endpoint: scope.endpoint.clone(),
                path: path.to_string(),
                reason,
                status_code,
                auth_scope_generation: scope.generation,
                realtime_transport: None,
            },
        );
    }
}

pub(super) fn vrchat_auth_failure_status(error: &Error) -> Option<i32> {
    match error {
        Error::VrchatApi {
            status_code: status_code @ (401 | 403),
            ..
        } => Some(*status_code),
        _ => None,
    }
}
