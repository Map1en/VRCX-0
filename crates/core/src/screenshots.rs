use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application: Option<String>,
    #[serde(default)]
    pub version: i32,
    pub author: AuthorDetail,
    pub world: WorldDetail,
    pub players: Vec<PlayerDetail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos: Option<[f32; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotLibraryScanStatus {
    pub running: bool,
    pub scanned: u32,
    pub indexed: u32,
    pub changed: u32,
    pub skipped: u32,
    pub deleted: u32,
    pub error: Option<String>,
    pub last_scan_at: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotExportProgress {
    pub running: bool,
    pub finalizing: bool,
    pub total_files: u32,
    pub written_files: u32,
    pub skipped_files: u32,
    pub total_bytes: u64,
    pub written_bytes: u64,
    pub cancelled: bool,
    pub error: Option<String>,
    pub output_path: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotFolderInfo {
    pub path: String,
    pub parent_path: Option<String>,
    pub name: String,
    pub image_count: u32,
    pub total_image_count: u32,
    pub latest_modified_at: Option<i64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotFolderTree {
    pub root_path: String,
    pub folders: Vec<ScreenshotFolderInfo>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotLibraryImage {
    pub path: String,
    pub folder_path: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub modified_at: i64,
    pub created_at: Option<i64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub world_id: Option<String>,
    pub world_name: Option<String>,
    pub captured_at: Option<String>,
    pub captured_at_ms: i64,
    pub metadata: Option<ScreenshotMetadata>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteScreenshots {
    pub paths: Vec<String>,
    pub images: Vec<ScreenshotLibraryImage>,
    pub missing_count: u32,
}

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotTimeWindow {
    pub from_ms: i64,
    pub to_ms: i64,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotWindowImages {
    pub total: i64,
    pub images: Vec<ScreenshotLibraryImage>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthorDetail {
    #[serde(default)]
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldDetail {
    #[serde(default)]
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default)]
    pub instance_id: String,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDetail {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos: Option<[f32; 3]>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSearchResult {
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: i64,
    pub creation_date: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub metadata: ScreenshotMetadata,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScreenshotSearchType {
    Username = 0,
    UserId = 1,
    WorldName = 2,
    WorldId = 3,
}

impl ScreenshotSearchType {
    pub fn from_i32(value: i32) -> Self {
        match value {
            1 => Self::UserId,
            2 => Self::WorldName,
            3 => Self::WorldId,
            _ => Self::Username,
        }
    }
}

impl ScreenshotMetadata {
    pub fn just_error(source_file: &str, error: &str) -> Self {
        Self {
            source_file: Some(source_file.into()),
            error: Some(error.into()),
            ..Default::default()
        }
    }

    pub fn contains_player_id(&self, id: &str) -> bool {
        self.players.iter().any(|p| p.id == id)
    }

    pub fn contains_player_name_lowercase(&self, lowercase_name: &str) -> bool {
        self.players.iter().any(|p| {
            crate::text::contains_lowercase_query_case_insensitive(&p.display_name, lowercase_name)
        })
    }
}

pub fn parse_vrc_image(xml_string: &str) -> ScreenshotMetadata {
    let idx = match xml_string.find("<x:xmpmeta") {
        Some(i) => i,
        None => return ScreenshotMetadata::default(),
    };
    let xml = &xml_string[idx..];

    let mut creator_tool: Option<String> = None;
    let mut author_name: Option<String> = None;
    let mut author_id: Option<String> = None;
    let mut date_time: Option<String> = None;
    let mut note: Option<String> = None;
    let mut world_id: Option<String> = None;
    let mut world_display_name: Option<String> = None;

    use quick_xml::escape::unescape;
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    let mut current_tag = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                current_tag = name;
            }
            Ok(Event::Text(ref e)) => {
                let text = e
                    .decode()
                    .ok()
                    .and_then(|text| unescape(&text).ok().map(|text| text.into_owned()))
                    .unwrap_or_default();
                if text.trim().is_empty() {
                    continue;
                }
                match current_tag.as_str() {
                    "CreatorTool" => creator_tool = Some(text),
                    "Author" => author_name = Some(text),
                    "DateTime" => date_time = Some(text),
                    "li" if note.is_none() => {
                        note = Some(text);
                    }
                    "WorldID" | "World" if world_id.is_none() => {
                        world_id = Some(text);
                    }
                    "WorldDisplayName" => world_display_name = Some(text),
                    "AuthorID" => author_id = Some(text),
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    if author_id.is_none() {
        author_id = author_name.take();
    }

    ScreenshotMetadata {
        application: creator_tool,
        version: 1,
        author: AuthorDetail {
            id: author_id.unwrap_or_default(),
            display_name: author_name,
        },
        world: WorldDetail {
            id: world_id.clone().unwrap_or_default(),
            name: world_display_name,
            instance_id: world_id.unwrap_or_default(),
        },
        timestamp: date_time,
        note,
        ..Default::default()
    }
}

pub fn parse_lfs_picture(metadata_string: &str) -> ScreenshotMetadata {
    let mut metadata = ScreenshotMetadata::default();
    let mut parts: Vec<&str> = metadata_string.split('|').collect();

    if parts.len() > 1 && parts[1] == "cvr" {
        parts.remove(0);
    }

    if parts.len() < 2 {
        return metadata;
    }

    let application = parts[0];
    let version: i32 = parts[1].parse().unwrap_or(0);
    metadata.application = Some(application.into());
    metadata.version = version;

    let is_cvr = application == "cvr";

    if application == "screenshotmanager" {
        if parts.len() >= 4 {
            let mut author_parts = parts[2]
                .strip_prefix("author:")
                .unwrap_or(parts[2])
                .splitn(2, ',');
            if let (Some(id), Some(display_name)) = (author_parts.next(), author_parts.next()) {
                metadata.author.id = id.into();
                metadata.author.display_name = Some(display_name.into());
            }
            let mut world_parts = parts[3].splitn(3, ',');
            if let (Some(id), Some(instance_id), Some(name)) =
                (world_parts.next(), world_parts.next(), world_parts.next())
            {
                metadata.world.id = id.into();
                metadata.world.name = Some(name.into());
                metadata.world.instance_id = format!("{id}:{instance_id}");
            }
        }
        return metadata;
    }

    for part in parts.iter().skip(2) {
        let split: Vec<&str> = part.splitn(2, ':').collect();
        if split.len() < 2 || split[1].is_empty() {
            continue;
        }
        let key = split[0];
        let value = split[1];

        match key {
            "author" => {
                let Some((id, display_name)) = value.split_once(',') else {
                    continue;
                };
                metadata.author.id = if is_cvr { String::new() } else { id.into() };
                metadata.author.display_name = Some(if is_cvr {
                    format!("{display_name} ({id})")
                } else {
                    display_name.into()
                });
            }
            "world" => {
                if is_cvr || version == 1 {
                    metadata.world.id = String::new();
                    metadata.world.instance_id = String::new();
                    metadata.world.name = Some(if is_cvr {
                        let mut world_parts = value.splitn(3, ',');
                        match (world_parts.next(), world_parts.next(), world_parts.next()) {
                            (Some(id), Some(_), Some(name)) => format!("{name} ({id})"),
                            _ => value.into(),
                        }
                    } else {
                        value.into()
                    });
                } else {
                    let mut world_parts = value.splitn(3, ',');
                    if let (Some(id), Some(instance_id), Some(name)) =
                        (world_parts.next(), world_parts.next(), world_parts.next())
                    {
                        metadata.world.id = id.into();
                        metadata.world.instance_id = format!("{id}:{instance_id}");
                        metadata.world.name = Some(name.into());
                    }
                }
            }
            "pos" => {
                let coordinates = value.splitn(3, ',').collect::<Vec<_>>();
                if coordinates.len() >= 3 {
                    let x: f32 = coordinates[0].parse().unwrap_or(0.0);
                    let y: f32 = coordinates[1].parse().unwrap_or(0.0);
                    let z: f32 = coordinates[2].parse().unwrap_or(0.0);
                    metadata.pos = Some([x, y, z]);
                }
            }
            "players" => {
                let players_str = value.split(';');
                for player in players_str {
                    let pp: Vec<&str> = player.splitn(5, ',').collect();
                    if pp.len() >= 5 {
                        let x: f32 = pp[1].parse().unwrap_or(0.0);
                        let y: f32 = pp[2].parse().unwrap_or(0.0);
                        let z: f32 = pp[3].parse().unwrap_or(0.0);
                        metadata.players.push(PlayerDetail {
                            id: if is_cvr { String::new() } else { pp[0].into() },
                            display_name: if is_cvr {
                                format!("{} ({})", pp[4], pp[0])
                            } else {
                                pp[4].into()
                            },
                            pos: Some([x, y, z]),
                        });
                    }
                }
            }
            _ => {}
        }
    }

    metadata
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScreenshotZipEntry {
    pub source_path: String,
    pub entry_name: String,
}

fn path_file_name(path: &str) -> Option<String> {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
}

fn path_parent_key(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn unique_name(taken: &mut HashSet<String>, candidate: &str) -> String {
    if taken.insert(candidate.to_string()) {
        return candidate.to_string();
    }
    let path = Path::new(candidate);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| candidate.to_string());
    let extension = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    let mut suffix = 2;
    loop {
        let next = format!("{stem}-{suffix}{extension}");
        if taken.insert(next.clone()) {
            return next;
        }
        suffix += 1;
    }
}

pub fn plan_screenshot_zip_entries(
    paths: &[String],
    group_by_folder: bool,
) -> Vec<ScreenshotZipEntry> {
    let mut folder_names: HashMap<String, String> = HashMap::new();
    let mut taken_folder_names: HashSet<String> = HashSet::new();
    let mut taken_entry_names: HashMap<String, HashSet<String>> = HashMap::new();
    let mut entries = Vec::new();

    for path in paths {
        let Some(file_name) = path_file_name(path) else {
            continue;
        };

        let folder_name = if group_by_folder {
            let parent_key = path_parent_key(path);
            match folder_names.get(&parent_key) {
                Some(existing) => existing.clone(),
                None => {
                    let base = path_file_name(&parent_key).unwrap_or_default();
                    let assigned = if base.is_empty() {
                        String::new()
                    } else {
                        unique_name(&mut taken_folder_names, &base)
                    };
                    folder_names.insert(parent_key, assigned.clone());
                    assigned
                }
            }
        } else {
            String::new()
        };

        let scope = taken_entry_names.entry(folder_name.clone()).or_default();
        let unique_file_name = unique_name(scope, &file_name);
        let entry_name = if folder_name.is_empty() {
            unique_file_name
        } else {
            format!("{folder_name}/{unique_file_name}")
        };

        entries.push(ScreenshotZipEntry {
            source_path: path.clone(),
            entry_name,
        });
    }

    entries
}

pub fn screenshot_export_file_name(timestamp: &str, count: usize) -> String {
    format!("VRCX-0-Shots-{timestamp}-{count}.zip")
}

static VRCHAT_FILE_NAME_TIME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"VRChat_(?:\d{3,}x\d{3,}_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(\d+)|(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(\d{3})_\d{3,}x\d{3,})",
    )
    .unwrap()
});

pub fn screenshot_captured_at_ms(
    timestamp: Option<&str>,
    file_name: &str,
    modified_at: i64,
) -> i64 {
    captured_at_ms_in(&chrono::Local, timestamp, file_name, modified_at)
}

fn captured_at_ms_in<Tz: chrono::TimeZone>(
    tz: &Tz,
    timestamp: Option<&str>,
    file_name: &str,
    modified_at: i64,
) -> i64 {
    timestamp
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value.trim()).ok())
        .map(|value| value.timestamp_millis())
        .or_else(|| {
            file_name_local_time(file_name)
                .map(|local| crate::game_log_parser::log_time_to_utc(tz, local).timestamp_millis())
        })
        .unwrap_or(modified_at)
}

fn file_name_local_time(file_name: &str) -> Option<chrono::NaiveDateTime> {
    let captures = VRCHAT_FILE_NAME_TIME.captures(file_name)?;
    let offset = if captures.get(1).is_some() { 1 } else { 8 };
    let part =
        |index: usize| -> Option<u32> { captures.get(offset + index)?.as_str().parse().ok() };
    let fraction = captures.get(offset + 6)?.as_str();
    let millis: u32 = format!("{fraction:0<3}").get(..3)?.parse().ok()?;
    chrono::NaiveDate::from_ymd_opt(i32::try_from(part(0)?).ok()?, part(1)?, part(2)?)?
        .and_hms_milli_opt(part(3)?, part(4)?, part(5)?, millis)
}

#[cfg(test)]
mod tests;
