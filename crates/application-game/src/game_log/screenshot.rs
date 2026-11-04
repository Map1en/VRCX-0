use chrono::{DateTime, Duration, Utc};
use vrcx_0_application_core::{ConfigStore, RuntimeAuthIdentity};

use crate::game_log::host::GameLogHostActions;
use crate::game_log::ingest::ScreenshotInput;
use crate::game_log::runtime_state::world_id_from_location;
use crate::{Error, Result};
use crate::{GameLogSideEffectEvent, GameLogSideEffectSink, ScreenshotProcessedPayload};
use vrcx_0_core::OwnerId;

const FALLBACK_LOCATION_MAX_AGE_MS: i64 = 15 * 60 * 1000;

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

pub async fn handle_screenshot(
    store: &dyn crate::GameLogLocationQueries,
    config: &dyn ConfigStore,
    host_actions: std::sync::Arc<dyn GameLogHostActions>,
    side_effect_sink: &GameLogSideEffectSink,
    author: &RuntimeAuthIdentity,
    input: ScreenshotInput,
) -> Result<()> {
    let screenshot_path = input.path.trim().to_string();
    if screenshot_path.is_empty() {
        return Ok(());
    }

    let screenshot_helper = config.get_bool("screenshotHelper", true)?;
    let modify_filename = config.get_bool("screenshotHelperModifyFilename", false)?;
    let copy_to_clipboard = config.get_bool("screenshotHelperCopyToClipboard", false)?;

    let mut next_path = screenshot_path.clone();
    if screenshot_helper {
        if let Some(context) =
            screenshot_context(store, &OwnerId::new(author.user_id.clone()), &input)?
        {
            let world_id = world_id_from_location(&context.location);
            let metadata = build_metadata(author, &context, &world_id);
            let metadata_json = serde_json::to_string(&metadata)?;
            let path_for_task = screenshot_path.clone();
            let world_id_for_task = world_id.clone();
            let host_actions_for_task = std::sync::Arc::clone(&host_actions);
            let written = tokio::task::spawn_blocking(move || {
                host_actions_for_task.add_screenshot_metadata(
                    &path_for_task,
                    &metadata_json,
                    &world_id_for_task,
                    modify_filename,
                )
            })
            .await
            .map_err(|error| Error::Custom(format!("screenshot metadata task: {error}")))?;
            if !written.is_empty() {
                next_path = written;
            }
        }
    }

    if copy_to_clipboard {
        if let Err(error) = host_actions.copy_image_to_clipboard(&next_path) {
            tracing::warn!("failed to copy GameLog screenshot to clipboard: {error}");
        }
    }

    side_effect_sink.emit(GameLogSideEffectEvent::ScreenshotProcessed(
        ScreenshotProcessedPayload { path: next_path },
    ));
    Ok(())
}

fn screenshot_context(
    store: &dyn crate::GameLogLocationQueries,
    owner_user_id: &OwnerId,
    input: &ScreenshotInput,
) -> Result<Option<ScreenshotContext>> {
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

    let Some(location_entry) = store.location_before_or_at(owner_user_id, &input.created_at)?
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
    for entry in store.join_leave_for_location(
        owner_user_id,
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
    author: &RuntimeAuthIdentity,
    context: &ScreenshotContext,
    world_id: &str,
) -> serde_json::Value {
    serde_json::json!({
        "application": "VRCX-0",
        "version": 1,
        "author": {
            "id": &author.user_id,
            "displayName": &author.display_name,
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

#[cfg(test)]
mod tests;
