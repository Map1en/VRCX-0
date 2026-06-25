#![allow(non_snake_case)]

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::AppError;
use crate::state::{AppState, PendingTauriUpdate, TauriUpdateMetadata};
use vrcx_0_host::proxy::normalize_proxy_url;

#[derive(Clone, Serialize, specta::Type)]
#[serde(tag = "event", content = "data")]
pub enum TauriDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

fn updater_error(context: &str, error: impl std::fmt::Display) -> AppError {
    AppError::Custom(format!("{context}: {error}"))
}

async fn find_update(
    app_handle: &AppHandle,
    manifest_url: String,
    target: String,
    allow_downgrades: bool,
    proxy: Option<String>,
) -> Result<Option<Update>, AppError> {
    let endpoint = vrcx_0_host::updater_policy::validate_update_request(
        &manifest_url,
        &target,
        allow_downgrades,
    )?;
    let mut builder = app_handle
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| updater_error("Failed to configure update endpoint", error))?
        .target(target);

    if let Some(proxy_url) = proxy
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        if let Some(proxy_url) = normalize_proxy_url(&proxy_url)
            .map_err(|error| updater_error("Invalid update proxy URL", error))?
        {
            let proxy: Url = proxy_url
                .parse()
                .map_err(|error| updater_error("Invalid update proxy URL", error))?;
            builder = builder.proxy(proxy);
        }
    }

    let updater = builder
        .build()
        .map_err(|error| updater_error("Failed to initialize updater", error))?;
    updater
        .check()
        .await
        .map_err(|error| updater_error("Failed to check for updates", error))
}

#[tauri::command]
#[specta::specta]
pub async fn app__check_tauri_update(
    app_handle: AppHandle,
    manifest_url: String,
    target: String,
    allow_downgrades: bool,
    proxy: Option<String>,
) -> Result<Option<TauriUpdateMetadata>, AppError> {
    Ok(
        find_update(&app_handle, manifest_url, target, allow_downgrades, proxy)
            .await?
            .as_ref()
            .map(TauriUpdateMetadata::from),
    )
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn app__download_tauri_update(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    version: String,
    manifest_url: String,
    target: String,
    allow_downgrades: bool,
    proxy: Option<String>,
    on_event: Channel<TauriDownloadEvent>,
) -> Result<Option<TauriUpdateMetadata>, AppError> {
    let Some(update) =
        find_update(&app_handle, manifest_url, target, allow_downgrades, proxy).await?
    else {
        return Ok(None);
    };

    let metadata = TauriUpdateMetadata::from(&update);
    let mut first_chunk = true;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = on_event.send(TauriDownloadEvent::Started { content_length });
                }
                let _ = on_event.send(TauriDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(TauriDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|error| updater_error("Failed to download update", error))?;

    *state.pending_tauri_update.lock().await = Some(PendingTauriUpdate {
        version,
        update,
        bytes,
        metadata: metadata.clone(),
    });

    Ok(Some(metadata))
}

#[tauri::command]
#[specta::specta]
pub async fn app__install_pending_tauri_update(
    state: State<'_, AppState>,
    version: String,
) -> Result<TauriUpdateMetadata, AppError> {
    let pending = {
        let mut slot = state.pending_tauri_update.lock().await;
        let Some(pending) = slot.as_ref() else {
            return Err(AppError::Custom("no-pending-update".into()));
        };
        if pending.version != version {
            return Err(AppError::Custom("pending-update-version-mismatch".into()));
        }
        slot.take().expect("pending update exists")
    };

    let metadata = pending.metadata.clone();
    pending
        .update
        .install(pending.bytes)
        .map_err(|error| updater_error("Failed to install pending update", error))?;
    Ok(metadata)
}

#[tauri::command]
#[specta::specta]
pub async fn app__discard_pending_tauri_update(state: State<'_, AppState>) -> Result<(), AppError> {
    let _ = state.pending_tauri_update.lock().await.take();
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__download_and_install_tauri_update(
    app_handle: AppHandle,
    manifest_url: String,
    target: String,
    allow_downgrades: bool,
    proxy: Option<String>,
    on_event: Channel<TauriDownloadEvent>,
) -> Result<Option<TauriUpdateMetadata>, AppError> {
    let Some(update) =
        find_update(&app_handle, manifest_url, target, allow_downgrades, proxy).await?
    else {
        return Ok(None);
    };

    let metadata = TauriUpdateMetadata::from(&update);
    let mut first_chunk = true;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if first_chunk {
                    first_chunk = false;
                    let _ = on_event.send(TauriDownloadEvent::Started { content_length });
                }
                let _ = on_event.send(TauriDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(TauriDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|error| updater_error("Failed to download and install update", error))?;

    Ok(Some(metadata))
}
