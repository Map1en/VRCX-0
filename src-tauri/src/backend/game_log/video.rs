use std::collections::HashMap;

use serde_json::Value;

use crate::error::AppError;
use vrcx_0_persistence::config as backend_config;
use vrcx_0_persistence::game_log::{self, GameLogVideoPlayEntry, GameLogWriteBatch};
pub use vrcx_0_runtime::game_log::video::VideoInput;
use vrcx_0_runtime::game_log::video::{
    convert_youtube_duration_to_seconds, parse_youtube_video_id, url_encode,
};

use super::BackendDeps;

#[derive(Clone, Debug, Default)]
struct YouTubeMetadata {
    video_name: String,
    video_length: i64,
    thumbnail_url: String,
}

pub async fn handle_video_play(deps: BackendDeps, mut input: VideoInput) -> Result<(), AppError> {
    if input.video_url.trim().is_empty() {
        return Ok(());
    }

    input.video_url = input.video_url.trim().to_string();
    let youtube_id = if input.video_id.is_empty() || input.video_id == "YouTube" {
        parse_youtube_video_id(&input.video_url)
    } else {
        String::new()
    };

    if !youtube_id.is_empty() && input.video_id.is_empty() {
        input.video_id = "YouTube".into();
        input.video_name = youtube_id.clone();
    }
    if input.video_name.is_empty() {
        input.video_name = input.video_url.clone();
    }

    if !youtube_id.is_empty() {
        if let Some(metadata) = lookup_youtube_video(&deps, &youtube_id).await? {
            if !metadata.video_name.is_empty() {
                input.video_name = metadata.video_name;
            }
            if metadata.video_length > 0 {
                input.video_length = metadata.video_length;
            }
            if !metadata.thumbnail_url.is_empty() {
                input.thumbnail_url = metadata.thumbnail_url;
            }
        }
    }

    if input.user_id.is_empty() && !input.display_name.is_empty() {
        input.user_id = game_log::get_user_id_from_display_name(&deps.db, &input.display_name)?;
    }

    let raw_row = vec![
        "backend-game-log".into(),
        input.created_at.clone(),
        "video-play".into(),
        input.video_url.clone(),
        input.display_name.clone(),
    ];
    let batch = GameLogWriteBatch {
        video_plays: vec![GameLogVideoPlayEntry {
            created_at: input.created_at.clone(),
            video_url: input.video_url.clone(),
            video_name: input.video_name.clone(),
            video_id: input.video_id.clone(),
            location: input.location.clone(),
            display_name: input.display_name.clone(),
            user_id: input.user_id.clone(),
        }],
        ..Default::default()
    };
    if let Err(error) = game_log::write_batch(&deps.db, &batch) {
        let message = error.to_string();
        deps.event_bus
            .emit_game_log_persistence_fallback(&batch, vec![raw_row], &message);
        tracing::warn!(
            "GameLog video write failed; frontend fallback writes are disabled: {message}"
        );
        return Ok(());
    }

    deps.event_bus.emit_backend_game_log_event(raw_row);

    deps.emit_side_effect(
        "nowPlaying",
        serde_json::json!({
            "url": input.video_url,
            "name": input.video_name,
            "source": input.video_id,
            "displayName": input.display_name,
            "userId": input.user_id,
            "location": input.location,
            "thumbnailUrl": input.thumbnail_url,
            "length": input.video_length,
            "position": input.video_pos,
            "startedAt": input.created_at,
            "created_at": input.created_at,
            "type": "VideoPlay",
            "videoUrl": input.video_url,
            "videoName": input.video_name,
            "videoId": input.video_id,
            "updatedAt": chrono::Utc::now().to_rfc3339(),
        }),
    );

    Ok(())
}

async fn lookup_youtube_video(
    deps: &BackendDeps,
    youtube_id: &str,
) -> Result<Option<YouTubeMetadata>, AppError> {
    let enabled = backend_config::get_bool(&deps.db, "youtubeAPI", false)?;
    let api_key = backend_config::get_string(&deps.db, "youtubeAPIKey", "")?;
    if !enabled || api_key.trim().is_empty() {
        return Ok(None);
    }

    let mut options = HashMap::new();
    options.insert(
        "url".to_string(),
        serde_json::json!(format!(
            "https://www.googleapis.com/youtube/v3/videos?id={}&part=snippet,contentDetails&key={}",
            url_encode(youtube_id),
            url_encode(&api_key)
        )),
    );
    options.insert("method".to_string(), serde_json::json!("GET"));
    let (status, body) = deps.web.execute(options).await?;
    if status != 200 {
        return Ok(None);
    }

    let payload: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let Some(item) = payload
        .get("items")
        .and_then(|items| items.as_array())
        .and_then(|items| items.first())
    else {
        return Ok(None);
    };

    let thumbnail_url = ["maxres", "standard", "high", "medium", "default"]
        .iter()
        .filter_map(|key| item.pointer(&format!("/snippet/thumbnails/{key}/url")))
        .find_map(|value| value.as_str())
        .unwrap_or_default()
        .to_string();

    Ok(Some(YouTubeMetadata {
        video_name: text(item.pointer("/snippet/title")),
        video_length: convert_youtube_duration_to_seconds(text(
            item.pointer("/contentDetails/duration"),
        )),
        thumbnail_url,
    }))
}

fn text(value: Option<&Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}
