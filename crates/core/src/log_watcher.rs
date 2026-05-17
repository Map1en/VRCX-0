#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogEvent {
    pub file_name: String,
    pub created_at: String,
    pub kind: GameLogEventKind,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLocationSnapshot {
    pub location: String,
    pub world_name: String,
    pub created_at: String,
    pub file_name: String,
}

const LOG_TIMESTAMP_LEN: usize = 19;
const LOG_SEPARATOR_INDEX: usize = 31;
const LOG_CONTENT_OFFSET: usize = 34;
const LOG_MIN_LINE_LEN: usize = 36;
const LOG_TIME_FORMAT: &str = "%Y.%m.%d %H:%M:%S";

pub fn parse_log_line_header(line: &str) -> Option<(chrono::NaiveDateTime, &str)> {
    let bytes = line.as_bytes();
    if bytes.len() <= LOG_MIN_LINE_LEN || bytes.get(LOG_SEPARATOR_INDEX) != Some(&b'-') {
        return None;
    }
    if !has_log_timestamp_prefix(bytes) {
        return None;
    }

    let date_str = line.get(..LOG_TIMESTAMP_LEN)?;
    let line_date = chrono::NaiveDateTime::parse_from_str(date_str, LOG_TIME_FORMAT).ok()?;
    let content = line.get(LOG_CONTENT_OFFSET..)?;
    Some((line_date, content))
}

fn has_log_timestamp_prefix(bytes: &[u8]) -> bool {
    if bytes.len() < LOG_TIMESTAMP_LEN {
        return false;
    }

    bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[2].is_ascii_digit()
        && bytes[3].is_ascii_digit()
        && bytes[4] == b'.'
        && bytes[5].is_ascii_digit()
        && bytes[6].is_ascii_digit()
        && bytes[7] == b'.'
        && bytes[8].is_ascii_digit()
        && bytes[9].is_ascii_digit()
        && bytes[10] == b' '
        && bytes[11].is_ascii_digit()
        && bytes[12].is_ascii_digit()
        && bytes[13] == b':'
        && bytes[14].is_ascii_digit()
        && bytes[15].is_ascii_digit()
        && bytes[16] == b':'
        && bytes[17].is_ascii_digit()
        && bytes[18].is_ascii_digit()
}

pub fn convert_log_time_to_iso8601(line: &str) -> String {
    let date_str = match line.get(..LOG_TIMESTAMP_LEN) {
        Some(value) => value,
        None => {
            return chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string()
        }
    };

    match chrono::NaiveDateTime::parse_from_str(date_str, LOG_TIME_FORMAT) {
        Ok(local_dt) => {
            let local_aware = chrono::TimeZone::from_local_datetime(&chrono::Local, &local_dt);
            match local_aware.single() {
                Some(dt) => dt
                    .with_timezone(&chrono::Utc)
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string(),
                None => format!("{}", local_dt.format("%Y-%m-%dT%H:%M:%S%.3fZ")),
            }
        }
        Err(_) => chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string(),
    }
}

pub fn clean_location(value: &str) -> String {
    value.replace('/', "")
}

#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GameLogEventKind {
    Location {
        location: String,
        world_name: String,
    },
    LocationDestination {
        location: String,
    },
    PlayerJoined {
        display_name: String,
        user_id: String,
    },
    PlayerLeft {
        display_name: String,
        user_id: String,
    },
    PortalSpawn,
    Notification {
        data: String,
    },
    AvatarChange {
        display_name: String,
        avatar_name: String,
    },
    ResourceLoad {
        resource_type: String,
        resource_url: String,
    },
    VideoPlay {
        video_url: String,
        display_name: String,
    },
    VideoSync {
        timestamp: String,
    },
    Vrcx {
        data: String,
    },
    ApiRequest {
        url: String,
    },
    Screenshot {
        path: String,
    },
    StickerSpawn {
        user_id: String,
        display_name: String,
        inventory_id: String,
    },
    VrcQuit,
    OpenVrInit,
    DesktopMode,
    UdonException {
        data: String,
    },
    Event {
        data: String,
    },
    External {
        data: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedLogEntry {
    pub event: GameLogEvent,
    pub compat_row: Vec<String>,
}

impl ParsedLogEntry {
    pub fn new(file_name: &str, created_at: String, kind: GameLogEventKind) -> Self {
        let event = GameLogEvent {
            file_name: file_name.to_string(),
            created_at,
            kind,
        };
        let compat_row = event.to_compat_row();
        Self { event, compat_row }
    }
}

impl GameLogEvent {
    pub fn to_compat_row(&self) -> Vec<String> {
        let mut row = vec![
            self.file_name.clone(),
            self.created_at.clone(),
            self.kind.compat_type().to_string(),
        ];
        row.extend(self.kind.compat_args());
        row
    }

    #[allow(dead_code)]
    pub fn from_compat_row(row: &[String]) -> Option<Self> {
        let file_name = row.first()?.to_string();
        let created_at = row.get(1)?.to_string();
        let event_type = row.get(2)?.as_str();
        if created_at.is_empty() || event_type.is_empty() {
            return None;
        }
        let kind = GameLogEventKind::from_compat_parts(event_type, &row[3..])?;
        Some(Self {
            file_name,
            created_at,
            kind,
        })
    }
}

impl GameLogEventKind {
    fn compat_type(&self) -> &'static str {
        match self {
            Self::Location { .. } => "location",
            Self::LocationDestination { .. } => "location-destination",
            Self::PlayerJoined { .. } => "player-joined",
            Self::PlayerLeft { .. } => "player-left",
            Self::PortalSpawn => "portal-spawn",
            Self::Notification { .. } => "notification",
            Self::AvatarChange { .. } => "avatar-change",
            Self::ResourceLoad { resource_type, .. } => {
                if resource_type == "ImageLoad" {
                    "resource-load-image"
                } else {
                    "resource-load-string"
                }
            }
            Self::VideoPlay { .. } => "video-play",
            Self::VideoSync { .. } => "video-sync",
            Self::Vrcx { .. } => "vrcx",
            Self::ApiRequest { .. } => "api-request",
            Self::Screenshot { .. } => "screenshot",
            Self::StickerSpawn { .. } => "sticker-spawn",
            Self::VrcQuit => "vrc-quit",
            Self::OpenVrInit => "openvr-init",
            Self::DesktopMode => "desktop-mode",
            Self::UdonException { .. } => "udon-exception",
            Self::Event { .. } => "event",
            Self::External { .. } => "external",
        }
    }

    fn compat_args(&self) -> Vec<String> {
        match self {
            Self::Location {
                location,
                world_name,
            } => vec![location.clone(), world_name.clone()],
            Self::LocationDestination { location } => vec![location.clone()],
            Self::PlayerJoined {
                display_name,
                user_id,
            }
            | Self::PlayerLeft {
                display_name,
                user_id,
            } => vec![display_name.clone(), user_id.clone()],
            Self::PortalSpawn | Self::VrcQuit | Self::OpenVrInit | Self::DesktopMode => Vec::new(),
            Self::Notification { data }
            | Self::Vrcx { data }
            | Self::UdonException { data }
            | Self::Event { data }
            | Self::External { data } => vec![data.clone()],
            Self::AvatarChange {
                display_name,
                avatar_name,
            } => vec![display_name.clone(), avatar_name.clone()],
            Self::ResourceLoad { resource_url, .. } => vec![resource_url.clone()],
            Self::VideoPlay {
                video_url,
                display_name,
            } => vec![video_url.clone(), display_name.clone()],
            Self::VideoSync { timestamp } => vec![timestamp.clone()],
            Self::ApiRequest { url } => vec![url.clone()],
            Self::Screenshot { path } => vec![path.clone()],
            Self::StickerSpawn {
                user_id,
                display_name,
                inventory_id,
            } => vec![user_id.clone(), display_name.clone(), inventory_id.clone()],
        }
    }

    #[allow(dead_code)]
    fn from_compat_parts(event_type: &str, args: &[String]) -> Option<Self> {
        let arg = |index: usize| args.get(index).cloned().unwrap_or_default();
        match event_type {
            "location" => Some(Self::Location {
                location: arg(0),
                world_name: arg(1),
            }),
            "location-destination" => Some(Self::LocationDestination { location: arg(0) }),
            "player-joined" => Some(Self::PlayerJoined {
                display_name: arg(0),
                user_id: arg(1),
            }),
            "player-left" => Some(Self::PlayerLeft {
                display_name: arg(0),
                user_id: arg(1),
            }),
            "portal-spawn" => Some(Self::PortalSpawn),
            "notification" => Some(Self::Notification { data: arg(0) }),
            "avatar-change" => Some(Self::AvatarChange {
                display_name: arg(0),
                avatar_name: arg(1),
            }),
            "resource-load-string" => Some(Self::ResourceLoad {
                resource_type: "StringLoad".into(),
                resource_url: arg(0),
            }),
            "resource-load-image" => Some(Self::ResourceLoad {
                resource_type: "ImageLoad".into(),
                resource_url: arg(0),
            }),
            "video-play" => Some(Self::VideoPlay {
                video_url: arg(0),
                display_name: arg(1),
            }),
            "video-sync" => Some(Self::VideoSync { timestamp: arg(0) }),
            "api-request" => Some(Self::ApiRequest { url: arg(0) }),
            "screenshot" => Some(Self::Screenshot { path: arg(0) }),
            "sticker-spawn" => Some(Self::StickerSpawn {
                user_id: arg(0),
                display_name: arg(1),
                inventory_id: arg(2),
            }),
            "vrc-quit" => Some(Self::VrcQuit),
            "openvr-init" => Some(Self::OpenVrInit),
            "desktop-mode" => Some(Self::DesktopMode),
            "udon-exception" => Some(Self::UdonException { data: arg(0) }),
            "event" => Some(Self::Event { data: arg(0) }),
            "vrcx" => Some(Self::Vrcx { data: arg(0) }),
            "external" => Some(Self::External { data: arg(0) }),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{GameLogEvent, GameLogEventKind, ParsedLogEntry};

    fn row(fields: &[&str]) -> Vec<String> {
        fields.iter().map(|field| (*field).to_string()).collect()
    }

    #[test]
    fn converts_raw_location_and_multibyte_player_rows_to_structured_events() {
        let location = GameLogEvent::from_compat_row(&row(&[
            "output_log.txt",
            "2026-05-14T01:00:00.000Z",
            "location",
            "wrld_test:123",
            "测试世界",
        ]))
        .unwrap();
        assert_eq!(
            location.kind,
            GameLogEventKind::Location {
                location: "wrld_test:123".into(),
                world_name: "测试世界".into(),
            }
        );

        let join = GameLogEvent::from_compat_row(&row(&[
            "output_log.txt",
            "2026-05-14T01:00:10.000Z",
            "player-joined",
            "做鳄梦small-fry",
            "usr_1",
        ]))
        .unwrap();
        assert_eq!(
            join.kind,
            GameLogEventKind::PlayerJoined {
                display_name: "做鳄梦small-fry".into(),
                user_id: "usr_1".into(),
            }
        );
    }

    #[test]
    fn converts_resource_load_rows_to_display_entry_types() {
        let resource = GameLogEvent::from_compat_row(&row(&[
            "output_log.txt",
            "2026-05-14T01:00:30.000Z",
            "resource-load-image",
            "https://example.test/image.png",
        ]))
        .unwrap();
        assert_eq!(
            resource.kind,
            GameLogEventKind::ResourceLoad {
                resource_type: "ImageLoad".into(),
                resource_url: "https://example.test/image.png".into(),
            }
        );
    }

    #[test]
    fn converts_side_effect_rows_to_structured_events() {
        let video = GameLogEvent::from_compat_row(&row(&[
            "output_log.txt",
            "2026-05-14T01:00:35.000Z",
            "video-play",
            "https://youtu.be/dQw4w9WgXcQ",
            "做鳄梦small-fry",
        ]))
        .unwrap();
        assert_eq!(
            video.kind,
            GameLogEventKind::VideoPlay {
                video_url: "https://youtu.be/dQw4w9WgXcQ".into(),
                display_name: "做鳄梦small-fry".into(),
            }
        );

        let vrcx = GameLogEvent::from_compat_row(&row(&[
            "output_log.txt",
            "2026-05-14T01:00:40.000Z",
            "vrcx",
            "VideoPlay(PyPyDance) \"https://example.test\",0,10,\"Song (User)\"",
        ]))
        .unwrap();
        assert_eq!(
            vrcx.kind,
            GameLogEventKind::Vrcx {
                data: "VideoPlay(PyPyDance) \"https://example.test\",0,10,\"Song (User)\"".into(),
            }
        );

        let sticker = GameLogEvent::from_compat_row(&row(&[
            "output_log.txt",
            "2026-05-14T01:00:45.000Z",
            "sticker-spawn",
            "usr_1",
            "做鳄梦small-fry",
            "inv_123",
        ]))
        .unwrap();
        assert_eq!(
            sticker.kind,
            GameLogEventKind::StickerSpawn {
                user_id: "usr_1".into(),
                display_name: "做鳄梦small-fry".into(),
                inventory_id: "inv_123".into(),
            }
        );
    }

    #[test]
    fn typed_entry_generates_compatible_raw_row() {
        let entry = ParsedLogEntry::new(
            "output_log.txt",
            "2026-05-14T01:00:00.000Z".into(),
            GameLogEventKind::Location {
                location: "wrld_test:123".into(),
                world_name: "测试世界".into(),
            },
        );

        assert_eq!(
            entry.compat_row,
            row(&[
                "output_log.txt",
                "2026-05-14T01:00:00.000Z",
                "location",
                "wrld_test:123",
                "测试世界",
            ])
        );
    }
}
