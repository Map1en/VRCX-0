use std::collections::HashMap;

use reqwest::Url;
use serde_json::Value;

use crate::backend::db::config as backend_config;
use crate::backend::db::game_log::{self, GameLogVideoPlayEntry};
use crate::error::AppError;

use super::BackendDeps;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct VideoInput {
    pub created_at: String,
    pub location: String,
    pub video_url: String,
    pub video_id: String,
    pub video_name: String,
    pub video_length: i64,
    pub video_pos: i64,
    pub display_name: String,
    pub user_id: String,
    pub thumbnail_url: String,
}

#[derive(Clone, Debug, Default)]
struct YouTubeMetadata {
    video_name: String,
    video_length: i64,
    thumbnail_url: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProviderVideoEvent {
    Video(VideoInput),
    ResetNowPlaying,
    Ignored,
    NotProvider,
}

pub async fn handle_video_play(deps: BackendDeps, mut input: VideoInput) -> Result<(), AppError> {
    if input.video_url.trim().is_empty() {
        return Ok(());
    }

    input.video_url = input.video_url.trim().to_string();
    let youtube_id = if input.video_id.is_empty() {
        parse_youtube_video_id(&input.video_url)
    } else if input.video_id == "YouTube" {
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

    game_log::insert_video_play(
        &deps.db,
        &GameLogVideoPlayEntry {
            created_at: input.created_at.clone(),
            video_url: input.video_url.clone(),
            video_name: input.video_name.clone(),
            video_id: input.video_id.clone(),
            location: input.location.clone(),
            display_name: input.display_name.clone(),
            user_id: input.user_id.clone(),
        },
    )?;

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

pub fn parse_provider_video(created_at: &str, location: &str, data: &str) -> ProviderVideoEvent {
    let trimmed = data.trim();
    if trimmed.starts_with("VideoPlay(PyPyDance) ") {
        return parse_pypy_dance(created_at, location, trimmed)
            .map(ProviderVideoEvent::Video)
            .unwrap_or(ProviderVideoEvent::Ignored);
    }
    if trimmed.starts_with("VideoPlay(VRDancing) ")
        || trimmed.starts_with("VideoPlay(ZuwaZuwaDance) ")
    {
        return parse_vr_dancing(created_at, location, trimmed)
            .map(ProviderVideoEvent::Video)
            .unwrap_or(ProviderVideoEvent::Ignored);
    }
    if trimmed.starts_with("LSMedia ") {
        return parse_ls_media(created_at, location, trimmed)
            .map(ProviderVideoEvent::Video)
            .unwrap_or(ProviderVideoEvent::Ignored);
    }
    if trimmed.starts_with("VideoPlay(PopcornPalace) ") {
        return parse_popcorn_palace(created_at, location, trimmed);
    }
    ProviderVideoEvent::NotProvider
}

fn parse_pypy_dance(created_at: &str, location: &str, data: &str) -> Option<VideoInput> {
    let fields = csv_like_fields(data.strip_prefix("VideoPlay(PyPyDance) ")?.trim());
    if fields.len() < 4 {
        return None;
    }

    let title = fields[3].clone();
    let mut title_parts: Vec<&str> = title.split('(').collect();
    let mut display_name = title_parts
        .pop()
        .unwrap_or_default()
        .strip_suffix(')')
        .unwrap_or_default()
        .to_string();
    let mut source = title_parts.join("(");
    let mut video_id = String::new();
    if source == "Custom URL" {
        video_id = "YouTube".into();
    } else if let Some(index) = source.find(": ") {
        video_id = source[..index].trim_end_matches(':').trim().to_string();
        source = source[index + 2..].to_string();
    }
    if display_name == "Random" {
        display_name.clear();
    }

    Some(VideoInput {
        created_at: created_at.to_string(),
        location: location.to_string(),
        video_url: fields[0].clone(),
        video_pos: parse_i64_lossy(&fields[1]),
        video_length: parse_i64_lossy(&fields[2]),
        video_id,
        video_name: source
            .trim_end_matches(' ')
            .trim_end_matches(')')
            .to_string(),
        display_name,
        ..Default::default()
    })
}

fn parse_vr_dancing(created_at: &str, location: &str, data: &str) -> Option<VideoInput> {
    let prefix_end = data.find(' ')?;
    let fields = csv_like_fields(data[prefix_end + 1..].trim());
    if fields.len() < 6 {
        return None;
    }
    let mut video_id = fields[3].clone();
    if video_id == "-1" || video_id == "9999" {
        video_id = "YouTube".into();
    }
    let mut display_name = fields[4].clone();
    if display_name == "Random" {
        display_name.clear();
    }
    let mut video_name = fields[5].clone();
    if let Some(index) = video_name.find("]</b> ") {
        video_name = video_name[index + 6..].to_string();
    }

    Some(VideoInput {
        created_at: created_at.to_string(),
        location: location.to_string(),
        video_url: fields[0].clone(),
        video_pos: if fields[1] == fields[2] {
            0
        } else {
            parse_i64_lossy(&fields[1])
        },
        video_length: parse_i64_lossy(&fields[2]),
        video_id,
        video_name,
        display_name,
        ..Default::default()
    })
}

fn parse_ls_media(created_at: &str, location: &str, data: &str) -> Option<VideoInput> {
    let fields = csv_like_fields(data.strip_prefix("LSMedia ")?.trim());
    if fields.len() < 4 {
        return None;
    }
    let video_name = fields[3].clone();
    Some(VideoInput {
        created_at: created_at.to_string(),
        location: location.to_string(),
        video_url: video_name.clone(),
        video_pos: parse_i64_lossy(&fields[0]),
        video_length: parse_i64_lossy(&fields[1]),
        display_name: fields[2].clone(),
        video_id: "LSMedia".into(),
        video_name,
        ..Default::default()
    })
}

fn parse_popcorn_palace(created_at: &str, location: &str, data: &str) -> ProviderVideoEvent {
    let Some(json_start) = data.find('{') else {
        return ProviderVideoEvent::Ignored;
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&data[json_start..]) else {
        return ProviderVideoEvent::Ignored;
    };
    let video_name = text(parsed.get("videoName"));
    if video_name.is_empty() {
        return ProviderVideoEvent::ResetNowPlaying;
    }
    ProviderVideoEvent::Video(VideoInput {
        created_at: created_at.to_string(),
        location: location.to_string(),
        video_url: video_name.clone(),
        video_pos: number(parsed.get("videoPos")),
        video_length: number(parsed.get("videoLength")),
        display_name: text(parsed.get("displayName")),
        thumbnail_url: text(parsed.get("thumbnailUrl")),
        video_id: "PopcornPalace".into(),
        video_name,
        ..Default::default()
    })
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

fn parse_youtube_video_id(video_url: &str) -> String {
    let mut value = video_url.trim().to_string();
    if value.starts_with("https://u2b.cx/") && value.len() > 15 {
        value = value[15..].to_string();
    }

    let Ok(mut url) = Url::parse(&value) else {
        return String::new();
    };

    if matches!(
        url.host_str().unwrap_or_default(),
        "t-ne.x0.to" | "nextnex.com" | "r.0cm.org"
    ) {
        if let Some(inner) = url
            .query_pairs()
            .find(|(key, _)| key == "url")
            .map(|(_, v)| v)
        {
            if let Ok(parsed) = Url::parse(&inner) {
                url = parsed;
            }
        }
    }

    let path = url.path();
    if path.len() == 12 {
        return path[1..12].to_string();
    }
    if path.len() == 19 {
        return path[8..19].to_string();
    }
    url.query_pairs()
        .find(|(key, value)| key == "v" && value.len() == 11)
        .map(|(_, value)| value.to_string())
        .unwrap_or_default()
}

fn convert_youtube_duration_to_seconds(duration: String) -> i64 {
    let mut value = 0i64;
    let mut number = String::new();
    let mut in_time = false;
    for ch in duration.chars() {
        match ch {
            'T' => in_time = true,
            '0'..='9' => number.push(ch),
            'H' if in_time => {
                value += number.parse::<i64>().unwrap_or(0) * 60 * 60;
                number.clear();
            }
            'M' if in_time => {
                value += number.parse::<i64>().unwrap_or(0) * 60;
                number.clear();
            }
            'S' if in_time => {
                value += number.parse::<i64>().unwrap_or(0);
                number.clear();
            }
            _ => number.clear(),
        }
    }
    value
}

fn csv_like_fields(input: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escaped = false;
    for ch in input.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_quotes => escaped = true,
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                fields.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() || input.ends_with(',') {
        fields.push(current.trim().to_string());
    }
    fields
}

fn text(value: Option<&Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn number(value: Option<&Value>) -> i64 {
    match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0).max(0.0) as i64,
        Some(Value::String(value)) => parse_i64_lossy(value),
        _ => 0,
    }
}

fn parse_i64_lossy(value: &str) -> i64 {
    value.parse::<f64>().unwrap_or(0.0).max(0.0) as i64
}

fn url_encode(value: &str) -> String {
    percent_encoding::utf8_percent_encode(value, percent_encoding::NON_ALPHANUMERIC).to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        convert_youtube_duration_to_seconds, parse_provider_video, parse_youtube_video_id,
        ProviderVideoEvent,
    };

    #[test]
    fn parses_youtube_ids_from_common_urls() {
        assert_eq!(
            parse_youtube_video_id("https://youtu.be/dQw4w9WgXcQ"),
            "dQw4w9WgXcQ"
        );
        assert_eq!(
            parse_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            "dQw4w9WgXcQ"
        );
    }

    #[test]
    fn parses_provider_video_rows() {
        let ProviderVideoEvent::Video(input) = parse_provider_video(
            "2026-05-14T00:00:00.000Z",
            "wrld_test:1",
            "VideoPlay(VRDancing) \"https://example.test\",3,120,-1,\"做鳄梦small-fry\",\"<b>[x]</b> Song\"",
        ) else {
            panic!("expected provider video");
        };
        assert_eq!(input.video_url, "https://example.test");
        assert_eq!(input.video_id, "YouTube");
        assert_eq!(input.display_name, "做鳄梦small-fry");
        assert_eq!(input.video_name, "Song");
    }

    #[test]
    fn provider_rows_do_not_fall_through_to_external() {
        assert!(matches!(
            parse_provider_video(
                "2026-05-14T00:00:00.000Z",
                "wrld_test:1",
                "VideoPlay(PyPyDance) malformed"
            ),
            ProviderVideoEvent::Ignored
        ));
        assert!(matches!(
            parse_provider_video(
                "2026-05-14T00:00:00.000Z",
                "wrld_test:1",
                r#"VideoPlay(PopcornPalace) {"videoName":""}"#
            ),
            ProviderVideoEvent::ResetNowPlaying
        ));
        assert!(matches!(
            parse_provider_video("2026-05-14T00:00:00.000Z", "wrld_test:1", "Other message"),
            ProviderVideoEvent::NotProvider
        ));
    }

    #[test]
    fn converts_youtube_duration() {
        assert_eq!(convert_youtube_duration_to_seconds("PT1H2M3S".into()), 3723);
        assert_eq!(convert_youtube_duration_to_seconds("PT42S".into()), 42);
    }
}
