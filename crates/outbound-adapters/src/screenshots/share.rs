use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vrcx_0_application_core::{WebClient, WebExecuteRequest, WebMultipartPart, WebUploadMode};
use vrcx_0_core::screenshots::{
    ScreenshotShareCompression, ScreenshotShareEmbed, ScreenshotShareFacts, ScreenshotShareFields,
    ScreenshotShareMessage, ScreenshotShareProgress, ScreenshotShareRecord,
    ScreenshotShareSendResult, ScreenshotShareTarget, ScreenshotShareTargetInput, ScreenshotStay,
};
use vrcx_0_core::OwnerId;
use vrcx_0_media::screenshot_print::compose_screenshot_print;
use vrcx_0_media::screenshot_share::{encode_screenshot_share, screenshot_share_upload_limit};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::screenshot_cache::MetadataCacheDb;
use vrcx_0_persistence::{game_log, worlds, DatabaseService};

use crate::{Error, Result};

const TARGETS_KEY: &str = "screenshotShareTargets";
const HISTORY_KEY: &str = "screenshotShareHistory";
const HISTORY_LIMIT: usize = 200;
const MAX_ATTACHMENTS: usize = 10;
const RATE_LIMIT_RETRIES: usize = 3;
const MAX_RETRY_WAIT: Duration = Duration::from_secs(15);
const RESPONSE_LIMIT: usize = 64 * 1024;
const VISIT_END_SLACK_MS: i64 = 60_000;
const DISCORD_UNKNOWN_MESSAGE: i64 = 10008;
const DISCORD_HOSTS: [&str; 5] = [
    "discord.com",
    "discordapp.com",
    "canary.discord.com",
    "ptb.discord.com",
    "canary.discordapp.com",
];

const SHARE_ERROR_INVALID: &str = "invalid";
const SHARE_ERROR_TOO_LARGE: &str = "tooLarge";
const SHARE_ERROR_RATE_LIMITED: &str = "rateLimited";
const SHARE_ERROR_NETWORK: &str = "network";
const SHARE_ERROR_FILE: &str = "file";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTarget {
    id: String,
    name: String,
    url: String,
    fields: ScreenshotShareFields,
    quick: bool,
    invalid: bool,
    guild_id: Option<String>,
}

impl StoredTarget {
    fn view(&self) -> ScreenshotShareTarget {
        ScreenshotShareTarget {
            id: self.id.clone(),
            name: self.name.clone(),
            url_hint: url_hint(&self.url),
            fields: self.fields,
            quick: self.quick,
            invalid: self.invalid,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRecord {
    id: String,
    target_id: String,
    target_name: String,
    webhook_id: Option<String>,
    message_id: String,
    channel_id: String,
    guild_id: Option<String>,
    sent_at: String,
    file_names: Vec<String>,
}

impl StoredRecord {
    fn view(&self) -> ScreenshotShareRecord {
        ScreenshotShareRecord {
            id: self.id.clone(),
            target_id: self.target_id.clone(),
            target_name: self.target_name.clone(),
            message_url: self.guild_id.as_ref().map(|guild_id| {
                format!(
                    "https://discord.com/channels/{guild_id}/{}/{}",
                    self.channel_id, self.message_id
                )
            }),
            sent_at: self.sent_at.clone(),
            file_names: self.file_names.clone(),
        }
    }
}

#[derive(Deserialize)]
struct WebhookInfo {
    #[serde(default)]
    guild_id: Option<String>,
}

#[derive(Deserialize)]
struct SentMessage {
    id: String,
    channel_id: String,
}

#[derive(Deserialize)]
struct RateLimited {
    #[serde(default)]
    retry_after: f64,
}

#[derive(Deserialize)]
struct DiscordError {
    #[serde(default)]
    code: i64,
}

enum SendFailure {
    Invalid,
    TooLarge,
    RateLimited,
    Network,
    File,
    Http(i32),
}

impl SendFailure {
    fn from_status(status: i32) -> Self {
        match status {
            ..=0 => Self::Network,
            401 | 403 | 404 => Self::Invalid,
            413 => Self::TooLarge,
            429 => Self::RateLimited,
            _ => Self::Http(status),
        }
    }

    fn code(&self) -> String {
        match self {
            Self::Invalid => SHARE_ERROR_INVALID.into(),
            Self::TooLarge => SHARE_ERROR_TOO_LARGE.into(),
            Self::RateLimited => SHARE_ERROR_RATE_LIMITED.into(),
            Self::Network => SHARE_ERROR_NETWORK.into(),
            Self::File => SHARE_ERROR_FILE.into(),
            Self::Http(status) => format!("http{status}"),
        }
    }
}

impl From<SendFailure> for Error {
    fn from(failure: SendFailure) -> Self {
        Error::Custom(failure.code())
    }
}

#[derive(Clone)]
pub struct ScreenshotShareService {
    config: ConfigRepository,
    db: Arc<DatabaseService>,
    cache: MetadataCacheDb,
    photos_root: String,
    web: Arc<WebClient>,
    store_lock: Arc<Mutex<()>>,
    send_lock: Arc<tokio::sync::Mutex<()>>,
    progress: Arc<Mutex<ScreenshotShareProgress>>,
}

struct ProgressReset(Arc<Mutex<ScreenshotShareProgress>>);

impl Drop for ProgressReset {
    fn drop(&mut self) {
        *self.0.lock().unwrap() = ScreenshotShareProgress::default();
    }
}

impl ScreenshotShareService {
    pub fn new(
        db: Arc<DatabaseService>,
        cache: MetadataCacheDb,
        photos_root: String,
        web: Arc<WebClient>,
    ) -> Self {
        Self {
            config: ConfigRepository::new(Arc::clone(&db)),
            db,
            cache,
            photos_root,
            web,
            store_lock: Arc::new(Mutex::new(())),
            send_lock: Arc::new(tokio::sync::Mutex::new(())),
            progress: Arc::new(Mutex::new(ScreenshotShareProgress::default())),
        }
    }

    pub fn progress(&self) -> ScreenshotShareProgress {
        *self.progress.lock().unwrap()
    }

    pub fn targets(&self) -> Result<Vec<ScreenshotShareTarget>> {
        Ok(self
            .load_targets()?
            .iter()
            .map(StoredTarget::view)
            .collect())
    }

    pub async fn save_target(
        &self,
        input: ScreenshotShareTargetInput,
    ) -> Result<ScreenshotShareTarget> {
        let name = input.name.trim().to_string();
        if name.is_empty() {
            return Err(Error::Custom("Share target name is required.".into()));
        }
        let url = input
            .url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .map(str::to_string);
        let guild_id = match &url {
            Some(url) => Some(self.verify_webhook(url).await?),
            None => None,
        };
        let _guard = self.store_lock.lock().unwrap();
        let mut targets = self.load_targets()?;
        let target = match input.id.as_deref() {
            Some(id) => {
                let target = targets
                    .iter_mut()
                    .find(|target| target.id == id)
                    .ok_or_else(|| Error::Custom("Share target not found.".into()))?;
                if let Some(url) = url {
                    target.url = url;
                    target.guild_id = guild_id.flatten();
                    target.invalid = false;
                }
                target.name = name;
                target.fields = input.fields;
                target.quick = input.quick;
                target.clone()
            }
            None => {
                let url = url.ok_or_else(|| Error::Custom("Webhook URL is required.".into()))?;
                let target = StoredTarget {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    url,
                    fields: input.fields,
                    quick: input.quick,
                    invalid: false,
                    guild_id: guild_id.flatten(),
                };
                targets.push(target.clone());
                target
            }
        };
        self.save_targets(&targets)?;
        Ok(target.view())
    }

    pub fn delete_target(&self, id: &str) -> Result<()> {
        let _guard = self.store_lock.lock().unwrap();
        let mut targets = self.load_targets()?;
        targets.retain(|target| target.id != id);
        self.save_targets(&targets)
    }

    pub fn facts(&self, paths: &[String]) -> Result<Vec<ScreenshotShareFacts>> {
        let images = self
            .cache
            .list_library_images_by_paths_for_root(&self.photos_root, paths)?;
        Ok(images
            .into_iter()
            .map(|image| {
                let metadata = image.metadata.unwrap_or_default();
                let author = metadata.author.id.clone();
                let world_id = image
                    .world_id
                    .filter(|id| !id.is_empty())
                    .or_else(|| (!metadata.world.id.is_empty()).then(|| metadata.world.id.clone()));
                let world_name = image
                    .world_name
                    .filter(|name| !name.is_empty())
                    .or_else(|| metadata.world.name.clone().filter(|name| !name.is_empty()));
                let stay = self.stay_at(&author, world_id.as_deref(), image.captured_at_ms);
                let world_author_name = world_id
                    .clone()
                    .and_then(|id| worlds::world_cache_get(self.db.as_ref(), id).ok().flatten())
                    .map(|world| world.author_name)
                    .filter(|name| !name.is_empty());
                ScreenshotShareFacts {
                    path: image.path,
                    world_id,
                    world_name,
                    world_author_name,
                    author_name: metadata
                        .author
                        .display_name
                        .clone()
                        .filter(|name| !name.is_empty()),
                    captured_at_ms: image.captured_at_ms,
                    player_count: (!metadata.players.is_empty())
                        .then_some(metadata.players.len() as i64),
                    people: metadata
                        .players
                        .into_iter()
                        .filter(|player| player.id != author && !player.display_name.is_empty())
                        .map(|player| player.display_name)
                        .collect(),
                    stay,
                }
            })
            .collect())
    }

    pub async fn send(
        &self,
        target_id: &str,
        messages: Vec<ScreenshotShareMessage>,
    ) -> Result<ScreenshotShareSendResult> {
        let _sending = self.send_lock.lock().await;
        let target = self
            .load_targets()?
            .into_iter()
            .find(|target| target.id == target_id)
            .ok_or_else(|| Error::Custom("Share target not found.".into()))?;
        let total_files = messages
            .iter()
            .map(|message| message.paths.len())
            .sum::<usize>();
        *self.progress.lock().unwrap() = ScreenshotShareProgress {
            running: true,
            processed_files: 0,
            total_files: total_files as u32,
        };
        let _reset = ProgressReset(Arc::clone(&self.progress));
        let mut processed = 0;
        let mut result = ScreenshotShareSendResult::default();
        for message in messages {
            let sent = self
                .send_message(&target, &message, processed, &mut result)
                .await;
            processed += message.paths.len();
            if let Err(failure) = sent {
                if matches!(failure, SendFailure::Invalid) {
                    result.target_invalid = true;
                    self.mark_invalid(&target.id)?;
                }
                result.error = Some(failure.code());
                break;
            }
        }
        Ok(result)
    }

    pub fn history(&self) -> Result<Vec<ScreenshotShareRecord>> {
        Ok(self
            .load_history()?
            .iter()
            .map(StoredRecord::view)
            .collect())
    }

    pub async fn delete_record(&self, id: &str) -> Result<()> {
        let record = self
            .load_history()?
            .into_iter()
            .find(|record| record.id == id)
            .ok_or_else(|| Error::Custom("Share record not found.".into()))?;
        let target = self
            .load_targets()?
            .into_iter()
            .find(|target| target.id == record.target_id)
            .filter(|target| webhook_id(&target.url) == record.webhook_id)
            .ok_or(SendFailure::Invalid)?;
        let url = webhook_message_url(&target.url, &record.message_id)?;
        let mut request = WebExecuteRequest::new(url, "DELETE".into());
        request.response_body_limit = Some(RESPONSE_LIMIT);
        let (status, body) = self.web.execute(request).await?;
        let already_gone = status == 404
            && serde_json::from_str::<DiscordError>(&body)
                .is_ok_and(|error| error.code == DISCORD_UNKNOWN_MESSAGE);
        if !(200..300).contains(&status) && !already_gone {
            return Err(SendFailure::from_status(status).into());
        }
        let _guard = self.store_lock.lock().unwrap();
        let mut history = self.load_history()?;
        history.retain(|item| item.id != id);
        self.save_history(&history)
    }

    async fn verify_webhook(&self, url: &str) -> Result<Option<String>> {
        if !is_discord_webhook_url(url) {
            return Err(SendFailure::Invalid.into());
        }
        let mut request = WebExecuteRequest::new(url.to_string(), "GET".into());
        request.response_body_limit = Some(RESPONSE_LIMIT);
        let (status, body) = self.web.execute(request).await?;
        if !(200..300).contains(&status) {
            return Err(SendFailure::from_status(status).into());
        }
        Ok(serde_json::from_str::<WebhookInfo>(&body)
            .ok()
            .and_then(|info| info.guild_id))
    }

    async fn send_message(
        &self,
        target: &StoredTarget,
        message: &ScreenshotShareMessage,
        processed_before: usize,
        result: &mut ScreenshotShareSendResult,
    ) -> std::result::Result<(), SendFailure> {
        if !message.print_captions.is_empty() && message.print_captions.len() != message.paths.len()
        {
            return Err(SendFailure::File);
        }
        let options = EncodeOptions {
            spoiler: message.spoiler,
            metadata: message.metadata,
            compression: message.compression,
        };
        let paths = message.paths.clone();
        let captions = message.print_captions.clone();
        let progress = Arc::clone(&self.progress);
        let files = tokio::task::spawn_blocking(move || {
            encode_files(&paths, &captions, options, |encoded| {
                progress.lock().unwrap().processed_files = (processed_before + encoded) as u32;
            })
        })
        .await
        .map_err(|_| SendFailure::File)??;
        let limit = screenshot_share_upload_limit(message.compression);
        for (index, batch) in pack_batches(files, limit).iter().enumerate() {
            let content = if index == 0 {
                message.content.as_str()
            } else {
                ""
            };
            let embed = message.embed.as_ref().filter(|_| index == 0);
            let payload = discord_payload(content, embed, message.spoiler, batch);
            let record = self.post_batch(target, &payload, batch).await?;
            if let Err(error) = self.push_record(&record) {
                tracing::warn!("screenshot share history write failed: {error}");
            }
            result.records.push(record.view());
        }
        Ok(())
    }

    async fn post_batch(
        &self,
        target: &StoredTarget,
        payload: &Value,
        files: &[EncodedFile],
    ) -> std::result::Result<StoredRecord, SendFailure> {
        let url = with_wait(&target.url).map_err(|_| SendFailure::Invalid)?;
        let mut rate_limited = 0;
        loop {
            let mut parts = vec![WebMultipartPart {
                name: "payload_json".into(),
                file_name: None,
                mime: "application/json".into(),
                data: payload.to_string().into_bytes(),
            }];
            parts.extend(
                files
                    .iter()
                    .enumerate()
                    .map(|(index, file)| WebMultipartPart {
                        name: format!("files[{index}]"),
                        file_name: Some(file.name.clone()),
                        mime: file.mime.into(),
                        data: file.data.clone(),
                    }),
            );
            let mut request = WebExecuteRequest::new(url.clone(), "POST".into());
            request.upload = WebUploadMode::Multipart { parts };
            request.response_body_limit = Some(RESPONSE_LIMIT);
            let (status, body) = self
                .web
                .execute(request)
                .await
                .map_err(|_| SendFailure::Network)?;
            if (200..300).contains(&status) {
                let sent = serde_json::from_str::<SentMessage>(&body)
                    .map_err(|_| SendFailure::Http(status))?;
                return Ok(StoredRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    target_id: target.id.clone(),
                    target_name: target.name.clone(),
                    webhook_id: webhook_id(&target.url),
                    message_id: sent.id,
                    channel_id: sent.channel_id,
                    guild_id: target.guild_id.clone(),
                    sent_at: chrono::Utc::now().to_rfc3339(),
                    file_names: files.iter().map(|file| file.name.clone()).collect(),
                });
            }
            let wait = serde_json::from_str::<RateLimited>(&body)
                .map(|limit| Duration::from_secs_f64(limit.retry_after.max(0.0)))
                .unwrap_or(Duration::from_secs(1));
            if status != 429 || rate_limited >= RATE_LIMIT_RETRIES || wait > MAX_RETRY_WAIT {
                return Err(SendFailure::from_status(status));
            }
            rate_limited += 1;
            tokio::time::sleep(wait + Duration::from_millis(100 * rate_limited as u64)).await;
        }
    }

    fn stay_at(&self, author: &str, world_id: Option<&str>, at_ms: i64) -> Option<ScreenshotStay> {
        let world_id = world_id?;
        if author.is_empty() || at_ms <= 0 {
            return None;
        }
        let at = chrono::DateTime::from_timestamp_millis(at_ms)?
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let span = game_log::get_visit_span_at(self.db.as_ref(), &OwnerId::new(author), &at)
            .ok()
            .flatten()?;
        if span.world_id != world_id {
            return None;
        }
        let start_ms = chrono::DateTime::parse_from_rfc3339(&span.created_at)
            .ok()?
            .timestamp_millis();
        if span.time_ms > 0 {
            (at_ms <= start_ms + span.time_ms + VISIT_END_SLACK_MS).then_some(ScreenshotStay {
                ms: span.time_ms,
                ongoing: false,
            })
        } else {
            span.latest.then_some(ScreenshotStay {
                ms: (at_ms - start_ms).max(0),
                ongoing: true,
            })
        }
    }

    fn load_targets(&self) -> Result<Vec<StoredTarget>> {
        let raw = self.config.get_string(TARGETS_KEY, "[]")?;
        serde_json::from_str(&raw)
            .map_err(|error| Error::Custom(format!("parse share targets: {error}")))
    }

    fn save_targets(&self, targets: &[StoredTarget]) -> Result<()> {
        let raw = serde_json::to_string(targets)
            .map_err(|error| Error::Custom(format!("serialize share targets: {error}")))?;
        Ok(self.config.set_string(TARGETS_KEY, &raw)?)
    }

    fn load_history(&self) -> Result<Vec<StoredRecord>> {
        let raw = self.config.get_string(HISTORY_KEY, "[]")?;
        serde_json::from_str(&raw)
            .map_err(|error| Error::Custom(format!("parse share history: {error}")))
    }

    fn save_history(&self, history: &[StoredRecord]) -> Result<()> {
        let raw = serde_json::to_string(history)
            .map_err(|error| Error::Custom(format!("serialize share history: {error}")))?;
        Ok(self.config.set_string(HISTORY_KEY, &raw)?)
    }

    fn push_record(&self, record: &StoredRecord) -> Result<()> {
        let _guard = self.store_lock.lock().unwrap();
        let mut history = self.load_history()?;
        history.insert(0, record.clone());
        history.truncate(HISTORY_LIMIT);
        self.save_history(&history)
    }

    fn mark_invalid(&self, id: &str) -> Result<()> {
        let _guard = self.store_lock.lock().unwrap();
        let mut targets = self.load_targets()?;
        for target in targets.iter_mut().filter(|target| target.id == id) {
            target.invalid = true;
        }
        self.save_targets(&targets)
    }
}

fn is_discord_webhook_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|host| DISCORD_HOSTS.contains(&host))
            && url.path().starts_with("/api/webhooks/")
            && url
                .path_segments()
                .is_some_and(|segments| segments.count() >= 4)
    })
}

fn webhook_id(value: &str) -> Option<String> {
    url::Url::parse(value)
        .ok()?
        .path_segments()?
        .nth(2)
        .map(str::to_string)
}

fn url_hint(value: &str) -> String {
    let value = value.trim_end_matches('/');
    let start = value
        .char_indices()
        .rev()
        .nth(3)
        .map_or(0, |(index, _)| index);
    format!("…{}", &value[start..])
}

fn with_wait(value: &str) -> Result<String> {
    let mut url =
        url::Url::parse(value).map_err(|error| Error::Custom(format!("webhook url: {error}")))?;
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| key != "wait")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    url.query_pairs_mut()
        .clear()
        .extend_pairs(pairs)
        .append_pair("wait", "true");
    Ok(url.to_string())
}

fn webhook_message_url(value: &str, message_id: &str) -> Result<String> {
    let mut url =
        url::Url::parse(value).map_err(|error| Error::Custom(format!("webhook url: {error}")))?;
    let path = format!("{}/messages/{message_id}", url.path().trim_end_matches('/'));
    url.set_path(&path);
    Ok(url.to_string())
}

#[derive(Clone, Copy)]
struct EncodeOptions {
    spoiler: bool,
    metadata: bool,
    compression: ScreenshotShareCompression,
}

struct EncodedFile {
    name: String,
    mime: &'static str,
    data: Vec<u8>,
}

fn encode_files(
    paths: &[String],
    captions: &[String],
    options: EncodeOptions,
    mut on_encoded: impl FnMut(usize),
) -> std::result::Result<Vec<EncodedFile>, SendFailure> {
    let mut used = std::collections::HashSet::new();
    paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            let source = std::fs::read(path).map_err(|_| SendFailure::File)?;
            let caption = captions.get(index);
            let source = match caption {
                Some(caption) => {
                    compose_screenshot_print(&source, caption).map_err(|_| SendFailure::File)?
                }
                None => source,
            };
            let image = encode_screenshot_share(source, options.compression, options.metadata)
                .map_err(|_| SendFailure::File)?;
            on_encoded(index + 1);
            let extension = if image.jpeg { "jpg" } else { "png" };
            let print = caption.is_some();
            let mut name = attachment_name(path, options.spoiler, print, None, extension);
            let mut suffix = 1;
            while !used.insert(name.clone()) {
                suffix += 1;
                name = attachment_name(path, options.spoiler, print, Some(suffix), extension);
            }
            Ok(EncodedFile {
                name,
                mime: if image.jpeg {
                    "image/jpeg"
                } else {
                    "image/png"
                },
                data: image.data,
            })
        })
        .collect()
}

fn pack_batches(files: Vec<EncodedFile>, limit_bytes: Option<usize>) -> Vec<Vec<EncodedFile>> {
    let mut batches: Vec<Vec<EncodedFile>> = Vec::new();
    let mut batch_bytes = 0;
    for file in files {
        let fits = batches.last().is_some_and(|batch| {
            batch.len() < MAX_ATTACHMENTS
                && limit_bytes.is_none_or(|limit| batch_bytes + file.data.len() <= limit)
        });
        if !fits {
            batches.push(Vec::new());
            batch_bytes = 0;
        }
        batch_bytes += file.data.len();
        if let Some(batch) = batches.last_mut() {
            batch.push(file);
        }
    }
    batches
}

pub fn print_file_stem(path: &str) -> String {
    let stem = Path::new(path)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "screenshot".into());
    let stem = stem.strip_prefix("VRChat_").unwrap_or(&stem);
    format!("VRCX-0_print_{stem}")
}

fn attachment_name(
    path: &str,
    spoiler: bool,
    print: bool,
    suffix: Option<usize>,
    extension: &str,
) -> String {
    let stem = if print {
        print_file_stem(path)
    } else {
        Path::new(path)
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_else(|| "screenshot".into())
    };
    let safe: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let prefix = if spoiler { "SPOILER_" } else { "" };
    match suffix {
        Some(suffix) => format!("{prefix}{safe}_{suffix}.{extension}"),
        None => format!("{prefix}{safe}.{extension}"),
    }
}

fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let mut out: String = value.chars().take(limit.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn discord_payload(
    content: &str,
    embed: Option<&ScreenshotShareEmbed>,
    spoiler: bool,
    files: &[EncodedFile],
) -> Value {
    let attachments: Vec<Value> = files
        .iter()
        .enumerate()
        .map(|(index, file)| json!({ "id": index, "filename": file.name }))
        .collect();
    let mut payload = json!({
        "allowed_mentions": { "parse": [] },
        "attachments": attachments,
    });
    let content = truncate(content.trim(), 2000);
    if !content.is_empty() {
        payload["content"] = Value::String(content);
    }
    if let Some(embed) = embed {
        let image = (files.len() == 1 && !spoiler).then(|| files[0].name.as_str());
        payload["embeds"] = json!([embed_json(embed, image)]);
    }
    payload
}

fn embed_json(embed: &ScreenshotShareEmbed, image: Option<&str>) -> Value {
    let mut value = json!({});
    if let Some(title) = embed.title.as_deref().filter(|title| !title.is_empty()) {
        value["title"] = Value::String(truncate(title, 256));
    }
    if let Some(url) = embed
        .url
        .as_deref()
        .filter(|url| url.starts_with("https://"))
    {
        value["url"] = Value::String(url.to_string());
    }
    if let Some(timestamp) = embed.timestamp.as_deref().filter(|time| !time.is_empty()) {
        value["timestamp"] = Value::String(timestamp.to_string());
    }
    let fields: Vec<Value> = embed
        .fields
        .iter()
        .filter(|field| !field.name.is_empty() && !field.value.is_empty())
        .take(25)
        .map(|field| {
            json!({
                "name": truncate(&field.name, 256),
                "value": truncate(&field.value, 1024),
                "inline": field.inline,
            })
        })
        .collect();
    if !fields.is_empty() {
        value["fields"] = Value::Array(fields);
    }
    if let Some(name) = image {
        value["image"] = json!({ "url": format!("attachment://{name}") });
    }
    value
}

#[cfg(test)]
mod tests;
