pub const VIDEO_ERROR_EVENT_PREFIX: &str = "VideoError:";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogEvent {
    pub file_name: String,
    pub created_at: String,
    pub kind: GameLogEventKind,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LogLocationSnapshot {
    pub location: String,
    pub world_name: String,
    pub created_at: String,
    pub file_name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoomLogEvent<'a> {
    Entering { world_name: &'a str },
    Joining { location: &'a str },
    Left,
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

pub fn parse_authenticated_user(content: &str) -> Option<(&str, &str)> {
    let (display_name, user_id) = content
        .strip_prefix("User Authenticated: ")?
        .strip_suffix(')')?
        .rsplit_once(" (")?;
    user_id
        .starts_with("usr_")
        .then_some((display_name, user_id))
}

pub fn parse_room_log_event<'a>(line: &'a str, content: &str) -> Option<RoomLogEvent<'a>> {
    if content.contains("[Behaviour] Entering Room: ") {
        let position = line.rfind("] Entering Room: ")?;
        return Some(RoomLogEvent::Entering {
            world_name: &line[position + 17..],
        });
    }

    if content.contains("[Behaviour] OnLeftRoom") {
        return Some(RoomLogEvent::Left);
    }

    if content.contains("[Behaviour] Joining ")
        && !content.contains("] Joining or Creating Room: ")
        && !content.contains("] Joining friend: ")
    {
        let position = line.rfind("] Joining ")?;
        return Some(RoomLogEvent::Joining {
            location: &line[position + 10..],
        });
    }

    None
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
        None => return crate::time::now_iso(),
    };

    match chrono::NaiveDateTime::parse_from_str(date_str, LOG_TIME_FORMAT) {
        Ok(local_dt) => crate::time::iso_millis(log_time_to_utc(&chrono::Local, local_dt)),
        Err(_) => crate::time::now_iso(),
    }
}

pub(crate) fn log_time_to_utc<Tz: chrono::TimeZone>(
    tz: &Tz,
    local: chrono::NaiveDateTime,
) -> chrono::DateTime<chrono::Utc> {
    if let Some(dt) = tz.from_local_datetime(&local).latest() {
        return dt.with_timezone(&chrono::Utc);
    }
    let offset_before_gap = tz
        .from_local_datetime(&(local - chrono::TimeDelta::hours(1)))
        .latest()
        .map(|dt| chrono::Offset::fix(dt.offset()).local_minus_utc())
        .unwrap_or(0);
    (local - chrono::TimeDelta::seconds(i64::from(offset_before_gap))).and_utc()
}

pub fn clean_location(value: &str) -> String {
    value.replace('/', "")
}

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
    NowPlaying {
        data: String,
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

impl GameLogEvent {
    pub fn compat_type(&self) -> &'static str {
        self.kind.compat_type()
    }

    pub fn to_compat_row(&self) -> Vec<String> {
        let mut row = vec![
            self.file_name.clone(),
            self.created_at.clone(),
            self.compat_type().to_string(),
        ];
        row.extend(self.kind.compat_args());
        row
    }

    #[cfg(test)]
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
            Self::NowPlaying { .. } => "nowplaying",
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
            | Self::NowPlaying { data }
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

    #[cfg(test)]
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
            "nowplaying" => Some(Self::NowPlaying { data: arg(0) }),
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
    use super::{
        parse_authenticated_user, parse_log_line_header, parse_room_log_event, GameLogEvent,
        GameLogEventKind, RoomLogEvent,
    };

    fn row(fields: &[&str]) -> Vec<String> {
        fields.iter().map(|field| (*field).to_string()).collect()
    }

    #[test]
    fn parses_authenticated_user_lines() {
        let line = "2026.10.01 00:24:52 Debug      -  User Authenticated: Name (with) parens (usr_63f57413-1470-4703-b655-50b7c0845414)";
        let (_, content) = parse_log_line_header(line).unwrap();
        assert_eq!(
            parse_authenticated_user(content),
            Some((
                "Name (with) parens",
                "usr_63f57413-1470-4703-b655-50b7c0845414"
            ))
        );

        for content in [
            "User Authenticated: Name",
            "User Authenticated: Name (grp_1)",
            "[Behaviour] User Authenticated: Name (usr_1)",
        ] {
            assert_eq!(parse_authenticated_user(content), None);
        }
    }

    #[test]
    fn parses_room_lifecycle_events() {
        let entering =
            "2026.06.21 22:10:00 Log        -  [Behaviour] Entering Room: Midnight Rooftop";
        assert_eq!(
            parse_room_log_event(entering, &entering[34..]),
            Some(RoomLogEvent::Entering {
                world_name: "Midnight Rooftop",
            })
        );

        let joining =
            "2026.06.21 22:10:05 Log        -  [Behaviour] Joining wrld_abc:123~group(grp_1)";
        assert_eq!(
            parse_room_log_event(joining, &joining[34..]),
            Some(RoomLogEvent::Joining {
                location: "wrld_abc:123~group(grp_1)",
            })
        );

        let left = "2026.06.21 22:17:10 Log        -  [Behaviour] OnLeftRoom";
        assert_eq!(
            parse_room_log_event(left, &left[34..]),
            Some(RoomLogEvent::Left)
        );
    }

    #[test]
    fn excludes_non_location_join_events() {
        for line in [
            "2026.06.21 22:10:05 Log        -  [Behaviour] Joining friend: Example User",
            "2026.06.21 22:10:05 Log        -  [Behaviour] Joining or Creating Room: wrld_abc:123",
        ] {
            assert_eq!(parse_room_log_event(line, &line[34..]), None);
        }
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
    fn typed_event_generates_compatible_raw_row() {
        let event = GameLogEvent {
            file_name: "output_log.txt".into(),
            created_at: "2026-05-14T01:00:00.000Z".into(),
            kind: GameLogEventKind::Location {
                location: "wrld_test:123".into(),
                world_name: "测试世界".into(),
            },
        };

        assert_eq!(
            event.to_compat_row(),
            row(&[
                "output_log.txt",
                "2026-05-14T01:00:00.000Z",
                "location",
                "wrld_test:123",
                "测试世界",
            ])
        );
    }

    #[derive(Clone, Copy)]
    struct UsEasternZone2026;

    impl UsEasternZone2026 {
        fn offset_at_utc(utc: &chrono::NaiveDateTime) -> chrono::FixedOffset {
            let dst_start = chrono::NaiveDate::from_ymd_opt(2026, 3, 8)
                .unwrap()
                .and_hms_opt(7, 0, 0)
                .unwrap();
            let dst_end = chrono::NaiveDate::from_ymd_opt(2026, 11, 1)
                .unwrap()
                .and_hms_opt(6, 0, 0)
                .unwrap();
            let hours = if (dst_start..dst_end).contains(utc) {
                -4
            } else {
                -5
            };
            chrono::FixedOffset::east_opt(hours * 3600).unwrap()
        }
    }

    impl chrono::TimeZone for UsEasternZone2026 {
        type Offset = chrono::FixedOffset;

        fn from_offset(_offset: &chrono::FixedOffset) -> Self {
            Self
        }

        fn offset_from_local_date(
            &self,
            local: &chrono::NaiveDate,
        ) -> chrono::MappedLocalTime<chrono::FixedOffset> {
            self.offset_from_local_datetime(&local.and_hms_opt(12, 0, 0).unwrap())
        }

        fn offset_from_local_datetime(
            &self,
            local: &chrono::NaiveDateTime,
        ) -> chrono::MappedLocalTime<chrono::FixedOffset> {
            let valid = [-4, -5]
                .into_iter()
                .map(|hours| chrono::FixedOffset::east_opt(hours * 3600).unwrap())
                .filter(|offset| Self::offset_at_utc(&(*local - *offset)) == *offset)
                .collect::<Vec<_>>();
            match valid.as_slice() {
                [] => chrono::MappedLocalTime::None,
                [offset] => chrono::MappedLocalTime::Single(*offset),
                [earliest, latest, ..] => chrono::MappedLocalTime::Ambiguous(*earliest, *latest),
            }
        }

        fn offset_from_utc_date(&self, utc: &chrono::NaiveDate) -> chrono::FixedOffset {
            Self::offset_at_utc(&utc.and_hms_opt(12, 0, 0).unwrap())
        }

        fn offset_from_utc_datetime(&self, utc: &chrono::NaiveDateTime) -> chrono::FixedOffset {
            Self::offset_at_utc(utc)
        }
    }

    fn utc_log_time(local: &str) -> String {
        let local = chrono::NaiveDateTime::parse_from_str(local, super::LOG_TIME_FORMAT).unwrap();
        crate::time::iso_millis(super::log_time_to_utc(&UsEasternZone2026, local))
    }

    #[test]
    fn converts_unambiguous_local_log_times_to_utc() {
        assert_eq!(
            utc_log_time("2026.06.21 22:10:00"),
            "2026-06-22T02:10:00.000Z"
        );
    }

    #[test]
    fn ambiguous_fall_back_log_times_use_standard_time() {
        assert_eq!(
            utc_log_time("2026.11.01 01:30:00"),
            "2026-11-01T06:30:00.000Z"
        );
    }

    #[test]
    fn skipped_spring_forward_log_times_use_the_offset_before_the_gap() {
        assert_eq!(
            utc_log_time("2026.03.08 02:30:00"),
            "2026-03-08T07:30:00.000Z"
        );
    }
}
