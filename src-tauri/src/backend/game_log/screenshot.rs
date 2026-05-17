use chrono::{DateTime, Duration, Utc};

use crate::error::AppError;
use vrcx_0_host::clipboard;
use vrcx_0_runtime::screenshots as screenshot_domain;
use vrcx_0_store::config as backend_config;
use vrcx_0_store::game_log;

use super::runtime_state::{world_id_from_location, RuntimeSnapshot};
use super::BackendDeps;

const FALLBACK_LOCATION_MAX_AGE_MS: i64 = 15 * 60 * 1000;

#[derive(Clone, Debug)]
pub struct ScreenshotInput {
    pub created_at: String,
    pub path: String,
    pub snapshot: RuntimeSnapshot,
}

#[derive(Clone, Debug, Default)]
struct ScreenshotContext {
    location: String,
    world_name: String,
    players: Vec<ScreenshotPlayer>,
}

#[derive(Clone, Debug, Default)]
struct ScreenshotPlayer {
    user_id: String,
    display_name: String,
}

pub async fn handle_screenshot(deps: BackendDeps, input: ScreenshotInput) -> Result<(), AppError> {
    let screenshot_path = input.path.trim().to_string();
    if screenshot_path.is_empty() {
        return Ok(());
    }

    let screenshot_helper = backend_config::get_bool(&deps.db, "screenshotHelper", true)?;
    let modify_filename =
        backend_config::get_bool(&deps.db, "screenshotHelperModifyFilename", false)?;
    let copy_to_clipboard =
        backend_config::get_bool(&deps.db, "screenshotHelperCopyToClipboard", false)?;

    let mut next_path = screenshot_path.clone();
    if screenshot_helper {
        if let Some(context) = screenshot_context(&deps, &input)? {
            let world_id = world_id_from_location(&context.location);
            let metadata = build_metadata(&deps, &context, &world_id);
            let metadata_json = serde_json::to_string(&metadata)?;
            let path_for_task = screenshot_path.clone();
            let world_id_for_task = world_id.clone();
            let written = tokio::task::spawn_blocking(move || {
                screenshot_domain::add_screenshot_metadata(
                    &path_for_task,
                    &metadata_json,
                    &world_id_for_task,
                    modify_filename,
                )
            })
            .await
            .map_err(|error| AppError::Custom(format!("screenshot metadata task: {error}")))?;
            if !written.is_empty() {
                next_path = written;
            }
        }
    }

    if copy_to_clipboard {
        if let Err(error) = clipboard::copy_image_to_clipboard(&next_path) {
            tracing::warn!("failed to copy GameLog screenshot to clipboard: {error}");
        }
    }

    deps.emit_side_effect(
        "screenshotProcessed",
        serde_json::json!({
            "path": next_path,
        }),
    );
    Ok(())
}

fn screenshot_context(
    deps: &BackendDeps,
    input: &ScreenshotInput,
) -> Result<Option<ScreenshotContext>, AppError> {
    if !input.snapshot.location.is_empty() {
        return Ok(Some(ScreenshotContext {
            location: input.snapshot.location.clone(),
            world_name: input.snapshot.world_name.clone(),
            players: input
                .snapshot
                .players
                .iter()
                .map(|player| ScreenshotPlayer {
                    user_id: player.user_id.clone(),
                    display_name: player.display_name.clone(),
                })
                .collect(),
        }));
    }

    game_log::ensure_game_log_tables(&deps.db)?;
    let Some(location_entry) = game_log::get_location_before_or_at(&deps.db, &input.created_at)?
    else {
        return Ok(None);
    };

    let screenshot_time = DateTime::parse_from_rfc3339(&input.created_at)
        .map(|date| date.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());
    let location_time = DateTime::parse_from_rfc3339(&location_entry.created_at)
        .map(|date| date.with_timezone(&Utc))
        .unwrap_or_else(|_| {
            screenshot_time - Duration::milliseconds(FALLBACK_LOCATION_MAX_AGE_MS + 1)
        });
    if screenshot_time.timestamp_millis() - location_time.timestamp_millis()
        > FALLBACK_LOCATION_MAX_AGE_MS
    {
        return Ok(None);
    }

    let mut players = Vec::<ScreenshotPlayer>::new();
    for entry in game_log::get_join_leave_entries_for_location_range(
        &deps.db,
        &location_entry.location,
        &location_entry.created_at,
        &input.created_at,
    )? {
        let key = if entry.user_id.is_empty() {
            format!("display:{}", entry.display_name)
        } else {
            entry.user_id.clone()
        };
        if entry.event_type == "OnPlayerJoined" {
            players.retain(|player| {
                let existing_key = if player.user_id.is_empty() {
                    format!("display:{}", player.display_name)
                } else {
                    player.user_id.clone()
                };
                existing_key != key
            });
            players.push(ScreenshotPlayer {
                user_id: entry.user_id,
                display_name: entry.display_name,
            });
        } else if entry.event_type == "OnPlayerLeft" {
            players.retain(|player| {
                let existing_key = if player.user_id.is_empty() {
                    format!("display:{}", player.display_name)
                } else {
                    player.user_id.clone()
                };
                existing_key != key
            });
        }
    }

    Ok(Some(ScreenshotContext {
        location: location_entry.location,
        world_name: location_entry.world_name,
        players,
    }))
}

fn build_metadata(
    deps: &BackendDeps,
    context: &ScreenshotContext,
    world_id: &str,
) -> serde_json::Value {
    let (author_id, author_name) = current_author(deps);
    serde_json::json!({
        "application": "VRCX-0",
        "version": 1,
        "author": {
            "id": author_id,
            "displayName": author_name,
        },
        "world": {
            "name": &context.world_name,
            "id": world_id,
            "instanceId": &context.location,
        },
        "players": context.players.iter().map(|player| serde_json::json!({
            "id": &player.user_id,
            "displayName": &player.display_name,
        })).collect::<Vec<_>>(),
    })
}

fn current_author(deps: &BackendDeps) -> (String, String) {
    let author_id =
        backend_config::get_string(&deps.db, "lastUserLoggedIn", "").unwrap_or_default();
    if author_id.is_empty() {
        return (String::new(), String::new());
    }

    let saved_credentials =
        backend_config::get_json(&deps.db, "savedCredentials", serde_json::json!({}))
            .unwrap_or_else(|_| serde_json::json!({}));
    let user = saved_credentials
        .get(&author_id)
        .and_then(|entry| entry.get("user"));
    let author_name = user
        .and_then(|user| user.get("displayName"))
        .or_else(|| user.and_then(|user| user.get("username")))
        .or_else(|| user.and_then(|user| user.get("id")))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();

    (author_id, author_name)
}
