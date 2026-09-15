#![allow(non_snake_case)]

use tauri::State;

use crate::desktop_notification_activation::DesktopNotificationActivation;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__take_pending_desktop_notification_activation(
    state: State<'_, AppState>,
) -> Option<DesktopNotificationActivation> {
    let owner_id = state.runtime_host().active_owner_id()?;
    state
        .pending_desktop_notification_activations()
        .take_for_owner(&owner_id)
}
