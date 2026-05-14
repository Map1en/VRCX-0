use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use chrono::{Local, NaiveDateTime, Utc};
use tauri::AppHandle;

use super::context::LogContext;
use super::event::GameLogEventKind;
use super::queue::append_event;
use super::watcher::Inner;

const LOG_TIMESTAMP_LEN: usize = 19;
const LOG_SEPARATOR_INDEX: usize = 31;
const LOG_CONTENT_OFFSET: usize = 34;
const LOG_MIN_LINE_LEN: usize = 36;
const LOG_TIME_FORMAT: &str = "%Y.%m.%d %H:%M:%S";
pub(super) fn parse_log(
    inner: &Inner,
    app_handle: &AppHandle,
    path: &Path,
    file_name: &str,
    ctx: &mut LogContext,
    till_date: NaiveDateTime,
    first_run: bool,
) -> bool {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut reader = BufReader::with_capacity(65536, file);
    if reader.seek(SeekFrom::Start(ctx.position)).is_err() {
        return false;
    }

    let mut line = String::new();
    let initial_position = ctx.position;
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Err(_) => break,
            _ => {}
        }

        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        if parse_udon_exception(inner, app_handle, file_name, trimmed, first_run) {
            continue;
        }

        let Some((line_date, content)) = parse_log_line_header(trimmed) else {
            continue;
        };

        if line_date <= till_date {
            continue;
        }

        let now_local = Local::now().naive_local();
        if line_date > now_local + chrono::Duration::minutes(61) {
            continue;
        }

        if content.starts_with('[') {
            let _ = parse_player_joined_or_left(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_location(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            ) || parse_location_destination(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            ) || parse_portal_spawn(inner, app_handle, file_name, trimmed, first_run)
                || parse_notification(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_api_request(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_avatar_change(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_join_blocked(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_avatar_pedestal_change(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_video_error(
                    inner, app_handle, file_name, trimmed, content, ctx, first_run,
                )
                || parse_video_change(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_avpro_video_change(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_usharp_video_play(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_usharp_video_sync(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_world_vrcx(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_audio_config(
                    inner, app_handle, file_name, trimmed, content, ctx, first_run,
                )
                || parse_screenshot(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_string_download(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_image_download(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_vote_kick(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_failed_to_join(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_instance_reset(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_vote_kick_init(inner, app_handle, file_name, trimmed, content, first_run)
                || parse_vote_kick_success(
                    inner, app_handle, file_name, trimmed, content, first_run,
                )
                || parse_sticker_spawn(inner, app_handle, file_name, trimmed, content, first_run);
        } else {
            let _ = parse_shader_keywords_limit(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            ) || parse_sdk2_video_play(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_application_quit(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            ) || parse_openvr_init(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_desktop_mode(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_osc_failed(
                inner, app_handle, file_name, trimmed, content, first_run,
            ) || parse_untrusted_url(
                inner, app_handle, file_name, trimmed, content, ctx, first_run,
            );
        }
    }

    ctx.position = reader.stream_position().unwrap_or(ctx.position);
    ctx.position > initial_position
}

pub(super) fn parse_log_line_header(line: &str) -> Option<(NaiveDateTime, &str)> {
    let bytes = line.as_bytes();
    if bytes.len() <= LOG_MIN_LINE_LEN || bytes.get(LOG_SEPARATOR_INDEX) != Some(&b'-') {
        return None;
    }
    if !has_log_timestamp_prefix(bytes) {
        return None;
    }

    let date_str = line.get(..LOG_TIMESTAMP_LEN)?;
    let line_date = NaiveDateTime::parse_from_str(date_str, LOG_TIME_FORMAT).ok()?;
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

pub(super) fn convert_log_time_to_iso8601(line: &str) -> String {
    let date_str = match line.get(..LOG_TIMESTAMP_LEN) {
        Some(value) => value,
        None => return Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
    };

    match NaiveDateTime::parse_from_str(date_str, LOG_TIME_FORMAT) {
        Ok(local_dt) => {
            let local_aware = chrono::TimeZone::from_local_datetime(&Local, &local_dt);
            match local_aware.single() {
                Some(dt) => dt
                    .with_timezone(&Utc)
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string(),
                None => format!("{}", local_dt.format("%Y-%m-%dT%H:%M:%S%.3fZ")),
            }
        }
        Err(_) => Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
    }
}

fn parse_user_info(s: &str) -> (String, String) {
    if let Some(pos) = s.rfind(" (") {
        let display_name = s[..pos].to_string();
        let end = s.rfind(')').unwrap_or(s.len());
        let user_id: String = s[pos + 2..end]
            .chars()
            .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '~' | ':' | '(' | ')'))
            .collect();
        (display_name, user_id)
    } else {
        (s.to_string(), String::new())
    }
}

pub(super) fn clean_location(s: &str) -> String {
    s.replace('/', "")
}

fn parse_location(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if content.contains("[Behaviour] Entering Room: ") {
        if let Some(pos) = line.rfind("] Entering Room: ") {
            ctx.recent_world_name = line[pos + 17..].to_string();
        }
        return true;
    }

    if content.contains("[Behaviour] Joining ")
        && !content.contains("] Joining or Creating Room: ")
        && !content.contains("] Joining friend: ")
    {
        if let Some(pos) = line.rfind("] Joining ") {
            let location = clean_location(&line[pos + 10..]);
            append_event(
                inner,
                app,
                fname,
                line,
                GameLogEventKind::Location {
                    location,
                    world_name: ctx.recent_world_name.clone(),
                },
                first_run,
            );
            ctx.last_audio_device.clear();
            ctx.video_errors.clear();
            *inner.vrc_closed_gracefully.lock().unwrap() = false;
        }
        return true;
    }

    false
}

fn parse_location_destination(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if content.contains("[Behaviour] OnLeftRoom") {
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::LocationDestination {
                location: ctx.location_destination.clone(),
            },
            first_run,
        );
        ctx.location_destination.clear();
        return true;
    }

    if content.contains("[Behaviour] Destination fetching: ") {
        if let Some(pos) = line.rfind("] Destination fetching: ") {
            ctx.location_destination = clean_location(&line[pos + 24..]);
        }
        return true;
    }

    false
}

fn parse_player_joined_or_left(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if content.contains("[Behaviour] OnPlayerJoined") && !content.contains("] OnPlayerJoined:") {
        if let Some(pos) = line.rfind("] OnPlayerJoined") {
            let user_info = &line[pos + 17..];
            let (display_name, user_id) = parse_user_info(user_info);
            if !display_name.is_empty() || !user_id.is_empty() {
                append_event(
                    inner,
                    app,
                    fname,
                    line,
                    GameLogEventKind::PlayerJoined {
                        display_name,
                        user_id,
                    },
                    first_run,
                );
            }
        }
        return true;
    }

    if content.contains("[Behaviour] OnPlayerLeft")
        && !content.contains("] OnPlayerLeftRoom")
        && !content.contains("] OnPlayerLeft:")
    {
        if let Some(pos) = line.rfind("] OnPlayerLeft") {
            let user_info = &line[pos + 15..];
            let (display_name, user_id) = parse_user_info(user_info);
            if !display_name.is_empty() || !user_id.is_empty() {
                append_event(
                    inner,
                    app,
                    fname,
                    line,
                    GameLogEventKind::PlayerLeft {
                        display_name,
                        user_id,
                    },
                    first_run,
                );
            }
        }
        return true;
    }

    false
}

fn parse_portal_spawn(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    first_run: bool,
) -> bool {
    if line.contains("[Behaviour] Instantiated a (Clone [")
        && line.contains("] Portals/PortalInternalDynamic)")
    {
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::PortalSpawn,
            first_run,
        );
        return true;
    }
    false
}

fn parse_notification(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("[API] Received Notification: <") {
        return false;
    }
    if let Some(pos) = line.rfind("> received at ") {
        if let Some(start) = line.find("[API] Received Notification: <") {
            let data = &line[start + 30..pos];
            append_event(
                inner,
                app,
                fname,
                line,
                GameLogEventKind::Notification { data: data.into() },
                first_run,
            );
        }
    }
    true
}

fn parse_api_request(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("[API] [") {
        return false;
    }
    if let Some(pos) = line.rfind("] Sending Get request to ") {
        let data = &line[pos + 25..];
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::ApiRequest { url: data.into() },
            first_run,
        );
        return true;
    }
    false
}

fn parse_avatar_change(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("[Behaviour] Switching ") {
        return false;
    }
    if let Some(pos) = line.rfind(" to avatar ") {
        if let Some(start) = line.rfind("[Behaviour] Switching ") {
            let display_name = &line[start + 22..pos];
            let avatar_name = &line[pos + 11..];
            append_event(
                inner,
                app,
                fname,
                line,
                GameLogEventKind::AvatarChange {
                    display_name: display_name.into(),
                    avatar_name: avatar_name.into(),
                },
                first_run,
            );
        }
    }
    true
}

fn parse_join_blocked(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("] Master is not sending any events! Moving to a new instance.") {
        return false;
    }
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::Event {
            data: "Joining instance blocked by master".into(),
        },
        first_run,
    );
    true
}

fn parse_avatar_pedestal_change(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for ";
    if !content.starts_with(tag) {
        return false;
    }
    let data = &content[tag.len()..];
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::Event {
            data: format!("{data} changed avatar pedestal"),
        },
        first_run,
    );
    true
}

fn parse_video_error(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    const YT_BOT_ERROR: &str = "Sign in to confirm";
    const YT_BOT_FIX: &str = "[VRCX] Fix error with this: https://github.com/EllyVR/VRCVideoCacher";

    if content.contains("[Video Playback] ERROR: ") {
        if let Some(pos) = content.find("[Video Playback] ERROR: ") {
            let mut data = content[pos + 24..].to_string();
            if !ctx.video_errors.insert(data.clone()) {
                return true;
            }
            if data.contains(YT_BOT_ERROR) {
                data = format!("{YT_BOT_FIX}\n{data}");
            }
            append_event(
                inner,
                app,
                fname,
                line,
                GameLogEventKind::Event {
                    data: format!("VideoError: {data}"),
                },
                first_run,
            );
        }
        return true;
    }

    if content.contains("[AVProVideo] Error: ") {
        if let Some(pos) = content.find("[AVProVideo] Error: ") {
            let mut data = content[pos + 20..].to_string();
            if !ctx.video_errors.insert(data.clone()) {
                return true;
            }
            if data.contains(YT_BOT_ERROR) {
                data = format!("{YT_BOT_FIX}\n{data}");
            }
            append_event(
                inner,
                app,
                fname,
                line,
                GameLogEventKind::Event {
                    data: format!("VideoError: {data}"),
                },
                first_run,
            );
        }
        return true;
    }

    false
}

fn parse_video_change(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Video Playback] Attempting to resolve URL '";
    if !content.starts_with(tag) {
        return false;
    }
    let rest = &content[tag.len()..];
    if let Some(end) = rest.rfind('\'') {
        let url = &rest[..end];
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::VideoPlay {
                video_url: url.into(),
                display_name: String::new(),
            },
            first_run,
        );
    }
    true
}

fn parse_avpro_video_change(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Video Playback] Resolving URL '";
    if !content.starts_with(tag) {
        return false;
    }
    let rest = &content[tag.len()..];
    if let Some(end) = rest.rfind('\'') {
        let url = &rest[..end];
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::VideoPlay {
                video_url: url.into(),
                display_name: String::new(),
            },
            first_run,
        );
    }
    true
}

fn parse_sdk2_video_play(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("User ") {
        return false;
    }
    if let Some(pos) = content.rfind(" added URL ") {
        let display_name = &content[5..pos];
        let url = &content[pos + 11..];
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::VideoPlay {
                video_url: url.into(),
                display_name: display_name.into(),
            },
            first_run,
        );
        return true;
    }
    false
}

fn parse_usharp_video_play(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[USharpVideo] Started video load for URL: ";
    if !content.starts_with(tag) {
        return false;
    }
    if let Some(pos) = content.rfind(", requested by ") {
        let url = &content[tag.len()..pos];
        let display_name = &content[pos + 15..];
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::VideoPlay {
                video_url: url.into(),
                display_name: display_name.into(),
            },
            first_run,
        );
    }
    true
}

fn parse_usharp_video_sync(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[USharpVideo] Syncing video to ";
    if !content.starts_with(tag) {
        return false;
    }
    let data = &content[tag.len()..];
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::VideoSync {
            timestamp: data.into(),
        },
        first_run,
    );
    true
}

fn parse_world_vrcx(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("[VRCX] ") {
        return false;
    }
    let data = &content[7..];
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::Vrcx { data: data.into() },
        first_run,
    );
    true
}

fn parse_screenshot(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[VRC Camera] Took screenshot to: ") {
        return false;
    }
    if let Some(pos) = line.rfind("] Took screenshot to: ") {
        let path = &line[pos + 22..];
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::Screenshot { path: path.into() },
            first_run,
        );
    }
    true
}

fn parse_shader_keywords_limit(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if !content.contains("Maximum number (384) of shader global keywords exceeded") {
        return false;
    }
    if ctx.shader_keywords_limit_reached {
        return true;
    }
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::Event {
            data: "Shader Keyword Limit has been reached".into(),
        },
        first_run,
    );
    ctx.shader_keywords_limit_reached = true;
    true
}

fn parse_application_quit(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    _ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if !content.starts_with("VRCApplication: OnApplicationQuit at ")
        && !content.starts_with("VRCApplication: HandleApplicationQuit at ")
    {
        return false;
    }
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::VrcQuit,
        first_run,
    );
    *inner.vrc_closed_gracefully.lock().unwrap() = true;
    true
}

fn parse_openvr_init(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("Initializing VRSDK.") && !content.starts_with("STEAMVR HMD Model: ") {
        return false;
    }
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::OpenVrInit,
        first_run,
    );
    true
}

fn parse_desktop_mode(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("VR Disabled") {
        return false;
    }
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::DesktopMode,
        first_run,
    );
    true
}

fn parse_string_download(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "] Attempting to load String from URL '";
    if !content.contains(tag) {
        return false;
    }
    if let Some(pos) = line.rfind(tag) {
        let rest = &line[pos + tag.len()..];
        if let Some(end) = rest.rfind('\'') {
            let url = &rest[..end];
            if url.starts_with("http://127.0.0.1:22500")
                || url.starts_with("http://localhost:22500")
            {
                return true;
            }
            append_event(
                inner,
                app,
                fname,
                line,
                GameLogEventKind::ResourceLoad {
                    resource_type: "StringLoad".into(),
                    resource_url: url.into(),
                },
                first_run,
            );
        }
    }
    true
}

fn parse_image_download(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "] Attempting to load image from URL '";
    if !content.contains(tag) {
        return false;
    }
    if let Some(pos) = line.rfind(tag) {
        let rest = &line[pos + tag.len()..];
        if let Some(end) = rest.rfind('\'') {
            let url = &rest[..end];
            if url.starts_with("http://127.0.0.1:22500")
                || url.starts_with("http://localhost:22500")
            {
                return true;
            }
            append_event(
                inner,
                app,
                fname,
                line,
                GameLogEventKind::ResourceLoad {
                    resource_type: "ImageLoad".into(),
                    resource_url: url.into(),
                },
                first_run,
            );
        }
    }
    true
}

fn parse_vote_kick(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Behaviour] Received executive message: ";
    if !content.starts_with(tag) {
        return false;
    }
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::Event {
            data: content[tag.len()..].into(),
        },
        first_run,
    );
    true
}

fn parse_failed_to_join(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    let tag = "[Behaviour] Failed to join instance ";
    if !content.starts_with(tag) {
        return false;
    }
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::Event {
            data: content[12..].into(),
        },
        first_run,
    );
    true
}

fn parse_osc_failed(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("Could not Start OSC: ") {
        return false;
    }
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::Event {
            data: format!("VRChat couldn't start OSC server, \"{content}\""),
        },
        first_run,
    );
    true
}

fn parse_untrusted_url(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if !content.contains("Attempted to play an untrusted URL") {
        return false;
    }
    if !ctx.video_errors.insert(content.to_string()) {
        return true;
    }
    append_event(
        inner,
        app,
        fname,
        line,
        GameLogEventKind::Event {
            data: format!("VideoError: {content}"),
        },
        first_run,
    );
    true
}

fn parse_instance_reset(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[ModerationManager] This instance will be reset in ") {
        return false;
    }
    if let Some(pos) = content.find("[ModerationManager] ") {
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::Event {
                data: content[pos + 20..].into(),
            },
            first_run,
        );
    }
    true
}

fn parse_vote_kick_init(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[ModerationManager] A vote kick has been initiated against ") {
        return false;
    }
    if let Some(pos) = content.find("[ModerationManager] ") {
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::Event {
                data: content[pos + 20..].into(),
            },
            first_run,
        );
    }
    true
}

fn parse_vote_kick_success(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[ModerationManager] Vote to kick ") {
        return false;
    }
    if let Some(pos) = content.find("[ModerationManager] ") {
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::Event {
                data: content[pos + 20..].into(),
            },
            first_run,
        );
    }
    true
}

fn parse_sticker_spawn(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.contains("[StickersManager] User ")
        || !content.contains("inv_")
        || !content.contains("spawned sticker")
    {
        return false;
    }

    if let Some(pos) = content.find("[StickersManager] User ") {
        let info = &content[pos + 23..];
        let (user_id, display_name) = parse_user_info(info);
        if display_name.is_empty() && user_id.is_empty() {
            return true;
        }
        let inv_id = if let Some(inv_pos) = info.find("inv_") {
            info[inv_pos..]
                .chars()
                .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '~' | ':' | '(' | ')'))
                .collect::<String>()
        } else {
            String::new()
        };
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::StickerSpawn {
                user_id,
                display_name,
                inventory_id: inv_id,
            },
            first_run,
        );
    }
    true
}

fn parse_audio_config(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if content.contains("[Always] uSpeak: OnAudioConfigurationChanged") {
        ctx.audio_device_changed = true;
        return true;
    }

    if content.contains("[Always] uSpeak: SetInputDevice 0") {
        if let Some(pos) = line.rfind(") '") {
            let start = pos + 3;
            let end = line.len().saturating_sub(1);
            if start >= end {
                return true;
            }
            let audio_device = &line[start..end];
            if ctx.last_audio_device.is_empty() {
                ctx.audio_device_changed = false;
                ctx.last_audio_device = audio_device.to_string();
                return true;
            }
            if !ctx.audio_device_changed || ctx.last_audio_device == audio_device {
                return true;
            }
            append_event(
                inner,
                app,
                fname,
                line,
                GameLogEventKind::Event {
                    data: format!("Audio device changed, mic set to '{audio_device}'"),
                },
                first_run,
            );
            ctx.last_audio_device = audio_device.to_string();
            ctx.audio_device_changed = false;
        }
        return true;
    }

    false
}

fn parse_udon_exception(
    inner: &Inner,
    app: &AppHandle,
    fname: &str,
    line: &str,
    first_run: bool,
) -> bool {
    if line.contains("[PyPyDance]") {
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::UdonException { data: line.into() },
            first_run,
        );
        return true;
    }
    if let Some(pos) = line.find(" ---> VRC.Udon.VM.UdonVMException: ") {
        append_event(
            inner,
            app,
            fname,
            line,
            GameLogEventKind::UdonException {
                data: line[pos..].into(),
            },
            first_run,
        );
        return true;
    }
    false
}
