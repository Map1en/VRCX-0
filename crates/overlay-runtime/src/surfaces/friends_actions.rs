use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

use serde_json::json;
use vrcx_0_application::{
    join_instance_launch, InstanceLaunchApiFuture, InstanceLaunchDeps, InstanceLaunchHttpClient,
    InstanceLaunchInput, InstanceLaunchMode, InstanceLaunchOutcome, InstanceLaunchPipe,
};
use vrcx_0_application_core::vrchat_api::{
    execute_api_command,
    instances::{instance_self_invite_input, instance_short_name_get_input},
    notifications::{invite_send_input, request_invite_send_input},
    VrchatApiRequest, VrchatApiResponse, VrchatScope,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::location::parse_location;
use vrcx_0_vr_overlay::SlintPanelEvent;

use crate::VrOverlayRuntimeServices;

use super::super::runtime::{
    FriendsPanelActionKind, FriendsPanelActionRequest, InteractivePanelRuntimeState,
    VrOverlayRuntime, FRIENDS_PANEL_ACTION_ARM_TIMEOUT,
};
use super::friends::{first_non_empty, friend_action_location};

impl VrOverlayRuntime {
    fn spawn_friends_panel_action(&self, action: FriendsPanelActionRequest) {
        let Some(services) = self.services.as_ref().cloned() else {
            return;
        };
        let Some(snapshot) = self.current_friends_panel_snapshot() else {
            self.set_friends_panel_status("Friends snapshot is not ready.");
            return;
        };
        let Some(record) = snapshot.friends_by_id.get(&action.user_id).cloned() else {
            self.set_friends_panel_status("Friend is no longer in the current roster.");
            return;
        };
        let auth_snapshot = services.data().auth_scope.snapshot();
        let endpoint =
            first_non_empty([snapshot.endpoint.as_str(), auth_snapshot.endpoint.as_str()])
                .to_string();
        let current_location = self.current_friends_panel_location_snapshot().0;
        let panel = Arc::clone(&self.interactive_panel);
        let frame_dirty = Arc::clone(&self.friends_panel_frame_dirty);
        set_friends_panel_status_message(
            &panel,
            &frame_dirty,
            friends_panel_action_pending_message(action.kind),
        );
        let tasks = services.data().tasks.clone();
        tasks.spawn(async move {
            let message =
                run_friends_panel_action(services, endpoint, current_location, record, action)
                    .await;
            set_friends_panel_status_message(&panel, &frame_dirty, message);
        });
    }

    fn set_friends_panel_status(&self, message: impl Into<String>) {
        set_friends_panel_status_message(
            &self.interactive_panel,
            &self.friends_panel_frame_dirty,
            message,
        );
    }

    pub(crate) fn apply_friends_panel_slint_events(&self, events: Vec<SlintPanelEvent>) -> bool {
        if events.is_empty() {
            return false;
        }
        let now = Instant::now();
        let mut selected_category_to_persist = None;
        let mut action_to_fire = None;
        let mut changed = false;
        {
            let Ok(mut panel) = self.interactive_panel.lock() else {
                return false;
            };
            if !panel.visible {
                return false;
            }
            changed |= clear_expired_friends_panel_arm(&mut panel, now);
            for event in events {
                match event {
                    SlintPanelEvent::CategorySelected(key) => {
                        if panel
                            .model
                            .categories
                            .iter()
                            .any(|category| category.key == key)
                            && panel.model.selected_category_key != key
                        {
                            panel.model.selected_category_key = key.clone();
                            disarm_friends_panel_action(&mut panel);
                            selected_category_to_persist = Some(key);
                            changed = true;
                        }
                    }
                    SlintPanelEvent::ActionClicked { user_id, kind } => {
                        let Some(kind) = FriendsPanelActionKind::from_panel_kind(&kind) else {
                            continue;
                        };
                        let action_id = friends_panel_action_region_id(&user_id, kind);
                        if panel.model.armed_action_region_id.as_deref() == Some(&action_id) {
                            disarm_friends_panel_action(&mut panel);
                            action_to_fire = Some(FriendsPanelActionRequest { user_id, kind });
                        } else {
                            panel.model.armed_action_region_id = Some(action_id);
                            panel.armed_action_expires_at =
                                Some(now + FRIENDS_PANEL_ACTION_ARM_TIMEOUT);
                        }
                        changed = true;
                    }
                    SlintPanelEvent::RowClicked(_) => {
                        changed |= disarm_friends_panel_action(&mut panel);
                    }
                    SlintPanelEvent::ActionHoverLost { user_id, kind } => {
                        let Some(kind) = FriendsPanelActionKind::from_panel_kind(&kind) else {
                            continue;
                        };
                        let action_id = friends_panel_action_region_id(&user_id, kind);
                        if panel.model.armed_action_region_id.as_deref() == Some(&action_id) {
                            changed |= disarm_friends_panel_action(&mut panel);
                        }
                    }
                }
            }
        }
        if let Some(selected_category) = selected_category_to_persist {
            self.persist_friends_panel_selected_category(&selected_category);
            if self.services.is_some() {
                self.rebuild_visible_friends_panel_model();
            }
        }
        if let Some(action) = action_to_fire {
            self.spawn_friends_panel_action(action);
        }
        changed
    }
}

struct RuntimeFriendsPanelActionApi {
    services: Arc<dyn VrOverlayRuntimeServices>,
}

impl InstanceLaunchHttpClient for RuntimeFriendsPanelActionApi {
    fn instance_short_name<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
    ) -> InstanceLaunchApiFuture<'a> {
        Box::pin(async move {
            let (_, _, request) = instance_short_name_get_input(
                endpoint.to_string(),
                world_id.to_string(),
                instance_id.to_string(),
                String::new(),
            )?;
            execute_friends_panel_api_command(
                self.services.as_ref(),
                "vr_overlay.friends_panel.short_name",
                request,
            )
            .await
        })
    }

    fn self_invite<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
        short_name: &'a str,
    ) -> InstanceLaunchApiFuture<'a> {
        Box::pin(async move {
            let (_, _, request) = instance_self_invite_input(
                endpoint.to_string(),
                world_id.to_string(),
                instance_id.to_string(),
                short_name.to_string(),
            )?;
            execute_friends_panel_api_command(
                self.services.as_ref(),
                "vr_overlay.friends_panel.self_invite",
                request,
            )
            .await
        })
    }
}

struct RuntimeFriendsPanelLaunchPipe;

impl InstanceLaunchPipe for RuntimeFriendsPanelLaunchPipe {
    fn try_open_vrchat_launch_url(
        &self,
        launch_url: &str,
    ) -> vrcx_0_application_core::Result<bool> {
        Ok(vrcx_0_host_desktop::vrchat_ipc::vrcipc_send(launch_url))
    }
}

async fn run_friends_panel_action(
    services: Arc<dyn VrOverlayRuntimeServices>,
    endpoint: String,
    current_location: String,
    record: FriendRecord,
    action: FriendsPanelActionRequest,
) -> String {
    match action.kind {
        FriendsPanelActionKind::Open => {
            let location = friend_action_location(&record);
            if location.trim().is_empty() {
                return "Open failed: friend location is not available.".to_string();
            }
            let api = RuntimeFriendsPanelActionApi {
                services: Arc::clone(&services),
            };
            let launch_pipe = RuntimeFriendsPanelLaunchPipe;
            match join_instance_launch(
                &InstanceLaunchDeps {
                    api: &api,
                    launch_pipe: &launch_pipe,
                },
                InstanceLaunchInput {
                    location,
                    endpoint,
                    short_name: String::new(),
                    mode: InstanceLaunchMode::Auto,
                },
            )
            .await
            {
                Ok(InstanceLaunchOutcome::Opened) => "Open request sent to VRChat.".to_string(),
                Ok(InstanceLaunchOutcome::SelfInvited) => "Self invite sent.".to_string(),
                Ok(InstanceLaunchOutcome::Failed { reason }) => {
                    format!("Open failed: {reason}")
                }
                Err(error) => format!("Open failed: {error}"),
            }
        }
        FriendsPanelActionKind::Request => {
            let request = request_invite_send_input(
                endpoint,
                action.user_id,
                friends_panel_request_invite_params(),
            );
            let request = match request {
                Ok((_, request)) => request,
                Err(error) => return format!("Request invite failed: {error}"),
            };
            match execute_friends_panel_vrchat_request(
                services.as_ref(),
                "vr_overlay.friends_panel.request_invite",
                request,
            )
            .await
            {
                Ok(()) => "Request invite sent.".to_string(),
                Err(error) => format!("Request invite failed: {error}"),
            }
        }
        FriendsPanelActionKind::Invite => {
            let params = match friends_panel_invite_params(services.as_ref(), &current_location) {
                Ok(params) => params,
                Err(error) => return format!("Invite failed: {error}"),
            };
            let request = invite_send_input(endpoint, action.user_id, params);
            let request = match request {
                Ok((_, request)) => request,
                Err(error) => return format!("Invite failed: {error}"),
            };
            match execute_friends_panel_vrchat_request(
                services.as_ref(),
                "vr_overlay.friends_panel.invite",
                request,
            )
            .await
            {
                Ok(()) => "Invite sent.".to_string(),
                Err(error) => format!("Invite failed: {error}"),
            }
        }
    }
}

async fn execute_friends_panel_vrchat_request(
    services: &dyn VrOverlayRuntimeServices,
    command: &'static str,
    request: VrchatApiRequest,
) -> std::result::Result<(), String> {
    let response = execute_friends_panel_api_command(services, command, request)
        .await
        .map_err(|error| error.to_string())?;
    if (200..=299).contains(&response.status) {
        Ok(())
    } else {
        Err(format!("VRChat returned HTTP {}", response.status))
    }
}

async fn execute_friends_panel_api_command(
    services: &dyn VrOverlayRuntimeServices,
    command: &'static str,
    request: VrchatApiRequest,
) -> vrcx_0_application_core::Result<VrchatApiResponse> {
    execute_api_command(
        services.data().web.as_ref(),
        services.data().db.as_ref(),
        &services.data().diagnostics,
        &services.data().sync,
        command,
        request,
        VrchatScope::Vrchat,
    )
    .await
}

fn friends_panel_invite_params(
    services: &dyn VrOverlayRuntimeServices,
    current_location: &str,
) -> std::result::Result<serde_json::Value, String> {
    let parsed = parse_location(current_location);
    if !parsed.is_real_instance || parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        return Err("current instance is not available".to_string());
    }
    let world_name = services
        .data()
        .world_cache
        .get_name(&parsed.world_id)
        .unwrap_or_else(|| parsed.world_id.clone());
    Ok(json!({
        "instanceId": parsed.instance_id,
        "worldId": parsed.world_id,
        "worldName": world_name,
        "rsvp": true,
    }))
}

pub(crate) fn friends_panel_request_invite_params() -> serde_json::Value {
    json!({ "platform": "standalonewindows" })
}

fn set_friends_panel_status_message(
    panel: &Arc<Mutex<InteractivePanelRuntimeState>>,
    frame_dirty: &Arc<AtomicBool>,
    message: impl Into<String>,
) {
    if let Ok(mut panel) = panel.lock() {
        if panel.visible {
            panel.model.status_message = Some(message.into());
            frame_dirty.store(true, Ordering::Release);
        }
    }
}

fn friends_panel_action_pending_message(kind: FriendsPanelActionKind) -> &'static str {
    match kind {
        FriendsPanelActionKind::Open => "Opening instance...",
        FriendsPanelActionKind::Request => "Sending request invite...",
        FriendsPanelActionKind::Invite => "Sending invite...",
    }
}

fn friends_panel_action_region_id(user_id: &str, kind: FriendsPanelActionKind) -> String {
    format!("action:{user_id}:{}", kind.as_panel_kind())
}

pub(crate) fn clear_expired_friends_panel_arm(
    panel: &mut InteractivePanelRuntimeState,
    now: Instant,
) -> bool {
    let Some(expires_at) = panel.armed_action_expires_at else {
        return false;
    };
    if expires_at > now {
        return false;
    }
    disarm_friends_panel_action(panel);
    true
}

pub(crate) fn disarm_friends_panel_action(panel: &mut InteractivePanelRuntimeState) -> bool {
    let was_armed =
        panel.model.armed_action_region_id.is_some() || panel.armed_action_expires_at.is_some();
    panel.model.disarm_action();
    panel.armed_action_expires_at = None;
    was_armed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friends_panel_request_invite_params_match_frontend_default_platform() {
        assert_eq!(
            friends_panel_request_invite_params(),
            serde_json::json!({ "platform": "standalonewindows" })
        );
    }
}
