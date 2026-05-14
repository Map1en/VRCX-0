use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::Url;
use serde_json::Value;

use crate::backend::db::config as backend_config;
use crate::domain::{image_processing, media_files, vrchat_paths};
use crate::error::AppError;

use super::BackendDeps;

const INSTANCE_MEDIA_SAVE_INTERVAL: Duration = Duration::from_millis(2500);
const MAX_RECENT_MEDIA_IDS: usize = 100;

#[derive(Clone)]
pub struct InstanceMediaQueue {
    gate: Arc<tokio::sync::Mutex<()>>,
    recent_ids: Arc<Mutex<VecDeque<String>>>,
}

impl InstanceMediaQueue {
    pub fn new() -> Self {
        Self {
            gate: Arc::new(tokio::sync::Mutex::new(())),
            recent_ids: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_RECENT_MEDIA_IDS))),
        }
    }

    async fn run<F, Fut>(&self, id: &str, task: F) -> Result<(), AppError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<(), AppError>>,
    {
        if self.remember_or_seen(id) {
            return Ok(());
        }

        let _guard = self.gate.lock().await;
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(INSTANCE_MEDIA_SAVE_INTERVAL))
            .await
            .map_err(|error| AppError::Custom(format!("instance media delay task: {error}")))?;
        task().await
    }

    fn remember_or_seen(&self, id: &str) -> bool {
        if id.trim().is_empty() {
            return true;
        }
        let mut recent = self.recent_ids.lock().unwrap();
        if recent.iter().any(|value| value == id) {
            return true;
        }
        recent.push_back(id.to_string());
        while recent.len() > MAX_RECENT_MEDIA_IDS {
            recent.pop_front();
        }
        false
    }
}

pub async fn handle_api_request(deps: BackendDeps, request_url: &str) -> Result<(), AppError> {
    if backend_config::get_bool(&deps.db, "saveInstancePrints", false)? {
        if let Some(print_id) = parse_print_id(request_url) {
            let key = print_id.clone();
            let task_deps = deps.clone();
            deps.media_queue
                .run(&key, move || async move {
                    save_instance_print(task_deps, &print_id).await
                })
                .await?;
        }
    }

    if backend_config::get_bool(&deps.db, "saveInstanceEmoji", false)? {
        if let Some((user_id, inventory_id)) = parse_inventory(request_url) {
            let key = inventory_id.clone();
            let task_deps = deps.clone();
            deps.media_queue
                .run(&key, move || async move {
                    save_inventory_media(task_deps, "emoji", &user_id, &inventory_id, "").await
                })
                .await?;
        }
    }
    Ok(())
}

pub async fn handle_sticker_spawn(
    deps: BackendDeps,
    user_id: &str,
    display_name: &str,
    inventory_id: &str,
) -> Result<(), AppError> {
    if !backend_config::get_bool(&deps.db, "saveInstanceStickers", false)? {
        return Ok(());
    }
    let user_id = user_id.to_string();
    let display_name = display_name.to_string();
    let inventory_id = inventory_id.to_string();
    let task_deps = deps.clone();
    let key = inventory_id.clone();
    deps.media_queue
        .run(&key, move || async move {
            save_inventory_media(task_deps, "sticker", &user_id, &inventory_id, &display_name).await
        })
        .await
}

async fn save_instance_print(deps: BackendDeps, print_id: &str) -> Result<(), AppError> {
    let ugc_path = ugc_folder_path(&deps)?;
    if ugc_path.is_empty() {
        return Ok(());
    }

    let print = execute_json(
        &deps,
        &format!("https://api.vrchat.cloud/api/1/prints/{print_id}"),
    )
    .await?;
    let Some(print) = print else {
        return Ok(());
    };
    let image_url = text(print.pointer("/files/image"));
    if image_url.is_empty() {
        return Ok(());
    }

    let created_at = text(print.get("createdAt")).or_else(|| text(print.get("timestamp")));
    let created = parse_datetime_or_now(&created_at);
    let month_folder = created.format("%Y-%m").to_string();
    let file_date = created.format("%Y-%m-%d_%H-%M-%S%.3f").to_string();
    let author_name = text(print.get("authorName"));
    let file_name = format!("{author_name}_{file_date}_{print_id}.png");
    let file_path = media_files::save_ugc_image_to_file(
        &deps.image_cache,
        &image_url,
        &ugc_path,
        &month_folder,
        &file_name,
    )
    .await?;

    if backend_config::get_bool(&deps.db, "cropInstancePrints", false)? {
        if let Err(error) = image_processing::crop_print_file(Path::new(&file_path)) {
            tracing::warn!("failed to crop instance print {file_path}: {error}");
        }
    }
    Ok(())
}

async fn save_inventory_media(
    deps: BackendDeps,
    expected_type: &str,
    user_id: &str,
    inventory_id: &str,
    display_name: &str,
) -> Result<(), AppError> {
    let ugc_path = ugc_folder_path(&deps)?;
    if ugc_path.is_empty() {
        return Ok(());
    }

    let item = execute_json(
        &deps,
        &format!("https://api.vrchat.cloud/api/1/user/{user_id}/inventory/{inventory_id}"),
    )
    .await?;
    let Some(item) = item else {
        return Ok(());
    };
    if text(item.get("itemType")) != expected_type || !has_ugc_flag(item.get("flags")) {
        return Ok(());
    }

    let image_url = text(item.pointer("/metadata/imageUrl")).or_else(|| text(item.get("imageUrl")));
    if image_url.is_empty() {
        return Ok(());
    }
    let created_at = text(item.get("created_at")).or_else(|| Utc::now().to_rfc3339());
    let created = parse_datetime_or_now(&created_at);
    let month_folder = created.format("%Y-%m").to_string();
    let file_date = created.format("%Y-%m-%d_%H-%M-%S%.3f").to_string();
    let file_name = if expected_type == "sticker" {
        format!("{display_name}_{file_date}_{inventory_id}.png")
    } else {
        emoji_file_name(&item, user_id, inventory_id)
    };

    media_files::save_ugc_image_to_file(
        &deps.image_cache,
        &image_url,
        &ugc_path,
        &month_folder,
        &file_name,
    )
    .await?;
    Ok(())
}

async fn execute_json(deps: &BackendDeps, url: &str) -> Result<Option<Value>, AppError> {
    let mut options = HashMap::new();
    options.insert("url".to_string(), serde_json::json!(url));
    options.insert("method".to_string(), serde_json::json!("GET"));
    let (status, body) = deps.web.execute(options).await?;
    if !(200..300).contains(&status) {
        return Ok(None);
    }
    Ok(serde_json::from_str(&body).ok())
}

fn ugc_folder_path(deps: &BackendDeps) -> Result<String, AppError> {
    let configured = backend_config::get_string(&deps.db, "userGeneratedContentPath", "")?;
    Ok(vrchat_paths::ugc_photo_location(Some(configured)))
}

fn parse_inventory(input: &str) -> Option<(String, String)> {
    let url = Url::parse(input).ok()?;
    if !url.path().starts_with("/api/1/user/") || !url.path().contains("/inventory/inv_") {
        return None;
    }
    let parts: Vec<&str> = url.path().split('/').collect();
    let user_id = parts.get(4)?.to_string();
    let inventory_id = parts.get(6)?.to_string();
    if user_id.is_empty() || !inventory_id.starts_with("inv_") {
        return None;
    }
    Some((user_id, inventory_id))
}

fn parse_print_id(input: &str) -> Option<String> {
    let url = Url::parse(input).ok()?;
    if !url.path().starts_with("/api/1/prints/") {
        return None;
    }
    let parts: Vec<&str> = url.path().split('/').collect();
    let print_id = parts.get(4)?.to_string();
    if print_id.is_empty() {
        return None;
    }
    Some(print_id)
}

fn parse_datetime_or_now(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn emoji_file_name(item: &Value, user_id: &str, inventory_id: &str) -> String {
    let metadata = item.get("metadata").and_then(|value| value.as_object());
    let holder_display_name =
        text(item.get("holderDisplayName")).or_else(|| text(item.get("ownerDisplayName")));
    let holder_id = text(item.get("holderId"))
        .or_else(|| text(item.pointer("/holder/id")))
        .or_else(|| text(item.get("userId")))
        .or_else(|| user_id.to_string());
    let name = format!(
        "{}_{}",
        holder_display_name
            .or_else(|| holder_id.clone())
            .trim()
            .to_string(),
        inventory_id
    );
    let animation_style = metadata
        .and_then(|metadata| metadata.get("animationStyle"))
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let frames = metadata
        .and_then(|metadata| metadata.get("frames"))
        .map(value_to_string)
        .unwrap_or_default();
    let frames_over_time = metadata
        .and_then(|metadata| metadata.get("framesOverTime"))
        .map(value_to_string)
        .unwrap_or_default();
    let loop_style = metadata
        .and_then(|metadata| metadata.get("loopStyle"))
        .and_then(|value| value.as_str())
        .unwrap_or("linear");

    if frames.is_empty() {
        format!("{name}_{animation_style}animationStyle.png")
    } else {
        format!(
            "{name}_{animation_style}animationStyle_{frames}frames_{frames_over_time}fps_{loop_style}loopStyle.png"
        )
    }
}

fn has_ugc_flag(value: Option<&Value>) -> bool {
    value
        .and_then(|value| value.as_array())
        .is_some_and(|flags| flags.iter().any(|flag| flag.as_str() == Some("ugc")))
}

fn text(value: Option<&Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

trait StringFallback {
    fn or_else<F: FnOnce() -> String>(self, fallback: F) -> String;
}

impl StringFallback for String {
    fn or_else<F: FnOnce() -> String>(self, fallback: F) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_inventory, parse_print_id};

    #[test]
    fn parses_instance_media_urls() {
        assert_eq!(
            parse_inventory("https://api.vrchat.cloud/api/1/user/usr_abc/inventory/inv_123"),
            Some(("usr_abc".into(), "inv_123".into()))
        );
        assert_eq!(
            parse_print_id("https://api.vrchat.cloud/api/1/prints/prnt_123"),
            Some("prnt_123".into())
        );
        assert!(parse_print_id("https://api.vrchat.cloud/api/1/files/file_abc").is_none());
    }
}
