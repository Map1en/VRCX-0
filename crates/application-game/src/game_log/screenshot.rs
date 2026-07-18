use chrono::{DateTime, Duration, Utc};
use vrcx_0_persistence::config as config_store;
use vrcx_0_persistence::game_log;
use vrcx_0_persistence::DatabaseService;

use crate::game_log::host::GameLogHostActions;
use crate::game_log::ingest::ScreenshotInput;
use crate::game_log::runtime_state::world_id_from_location;
use crate::screenshots as screenshot_domain;
use crate::RuntimeEventBus;
use crate::RuntimeGameEventBusExt;
use crate::{Error, Result};
use crate::{GameLogSideEffectEvent, ScreenshotProcessedPayload};

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
    db: &DatabaseService,
    host_actions: &dyn GameLogHostActions,
    event_bus: &RuntimeEventBus,
    input: ScreenshotInput,
) -> Result<()> {
    let screenshot_path = input.path.trim().to_string();
    if screenshot_path.is_empty() {
        return Ok(());
    }

    let screenshot_helper = config_store::get_bool(db, "screenshotHelper", true)?;
    let modify_filename = config_store::get_bool(db, "screenshotHelperModifyFilename", false)?;
    let copy_to_clipboard = config_store::get_bool(db, "screenshotHelperCopyToClipboard", false)?;

    let mut next_path = screenshot_path.clone();
    if screenshot_helper {
        if let Some(context) = screenshot_context(db, &input)? {
            let world_id = world_id_from_location(&context.location);
            let metadata = build_metadata(db, &context, &world_id);
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

    event_bus.emit_game_log_side_effect(GameLogSideEffectEvent::ScreenshotProcessed(
        ScreenshotProcessedPayload { path: next_path },
    ));
    Ok(())
}

fn screenshot_context(
    db: &DatabaseService,
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

    game_log::ensure_game_log_tables(db)?;
    let Some(location_entry) = game_log::get_location_before_or_at(db, &input.created_at)? else {
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
        db,
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
    db: &DatabaseService,
    context: &ScreenshotContext,
    world_id: &str,
) -> serde_json::Value {
    let (author_id, author_name) = current_author(db);
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

fn current_author(db: &DatabaseService) -> (String, String) {
    let author_id = config_store::get_string(db, "lastUserLoggedIn", "").unwrap_or_default();
    if author_id.is_empty() {
        return (String::new(), String::new());
    }

    let saved_credentials = config_store::get_json(db, "savedCredentials", serde_json::json!({}))
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
