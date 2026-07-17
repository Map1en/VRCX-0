use super::*;

pub(super) fn parse_api_request(
    inner: &Inner,
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
            fname,
            line,
            GameLogEventKind::ApiRequest { url: data.into() },
            first_run,
        );
        return true;
    }
    false
}

pub(super) fn parse_avatar_change(
    inner: &Inner,
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

pub(super) fn parse_join_blocked(
    inner: &Inner,
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
        fname,
        line,
        GameLogEventKind::Event {
            data: "Joining instance blocked by master".into(),
        },
        first_run,
    );
    true
}

pub(super) fn parse_avatar_pedestal_change(
    inner: &Inner,
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
        fname,
        line,
        GameLogEventKind::Event {
            data: format!("{data} changed avatar pedestal"),
        },
        first_run,
    );
    true
}

pub(super) fn parse_video_error(
    inner: &Inner,
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

pub(super) fn parse_video_change(
    inner: &Inner,
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

pub(super) fn parse_avpro_video_change(
    inner: &Inner,
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

pub(super) fn parse_sdk2_video_play(
    inner: &Inner,
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

pub(super) fn parse_usharp_video_play(
    inner: &Inner,
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

pub(super) fn parse_usharp_video_sync(
    inner: &Inner,
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
        fname,
        line,
        GameLogEventKind::VideoSync {
            timestamp: data.into(),
        },
        first_run,
    );
    true
}

pub(super) fn parse_world_vrcx(
    inner: &Inner,
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
        fname,
        line,
        GameLogEventKind::Vrcx { data: data.into() },
        first_run,
    );
    true
}

pub(super) fn parse_screenshot(
    inner: &Inner,
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
            fname,
            line,
            GameLogEventKind::Screenshot { path: path.into() },
            first_run,
        );
    }
    true
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use std::sync::{Arc, Mutex, RwLock};

    use super::*;
    use crate::log_watcher::watcher::NoopLogLocationSnapshotScanner;

    fn make_inner() -> Inner {
        Inner {
            log_list: RwLock::new(Vec::new()),
            event_buffer: Mutex::new(Vec::new()),
            compat_event_buffer: Mutex::new(Vec::new()),
            event_sink: None,
            log_dir: RwLock::new(None),
            till_date: Mutex::new(None),
            active: Mutex::new(false),
            reset_flag: Mutex::new(false),
            vrc_closed_gracefully: Mutex::new(false),
            game_running: Mutex::new(false),
            poll_without_process_monitor: Mutex::new(false),
            keep_polling_until: Mutex::new(None),
            location_snapshot_scanner: Arc::new(NoopLogLocationSnapshotScanner),
            started: AtomicBool::new(false),
            stop_requested: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            handle: Mutex::new(None),
        }
    }

    fn content(line: &str) -> &str {
        parse_log_line_header(line).unwrap().1
    }

    fn parsed_payloads(inner: &Inner) -> Vec<Vec<String>> {
        inner
            .log_list
            .read()
            .unwrap()
            .iter()
            .map(|row| row[2..].to_vec())
            .collect()
    }

    fn payload(fields: &[&str]) -> Vec<String> {
        fields.iter().map(|field| (*field).to_string()).collect()
    }

    #[test]
    fn parses_avatar_api_join_blocked_pedestal_vrcx_and_screenshot_events() {
        let inner = make_inner();
        let api_line =
            "2026.06.21 23:00:00 Log        -  [API] [123] Sending Get request to https://api.vrchat.cloud/api/1/users/usr_test";
        let avatar_line =
            "2026.06.21 23:00:10 Log        -  [Behaviour] Switching Maple to avatar Test Avatar";
        let blocked_line = "2026.06.21 23:00:20 Log        -  [Behaviour] Master is not sending any events! Moving to a new instance.";
        let pedestal_line =
            "2026.06.21 23:00:30 Log        -  [Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for Pedestal User";
        let vrcx_line =
            "2026.06.21 23:00:40 Log        -  [VRCX] VideoPlay(PyPyDance) \"https://example.test\",0,10,\"Song\"";
        let screenshot_line =
            "2026.06.21 23:00:50 Log        -  [VRC Camera] Took screenshot to: C:\\Users\\about\\Pictures\\VRChat\\shot.png";

        assert!(parse_api_request(
            &inner,
            "output_log.txt",
            api_line,
            content(api_line),
            false,
        ));
        assert!(parse_avatar_change(
            &inner,
            "output_log.txt",
            avatar_line,
            content(avatar_line),
            false,
        ));
        assert!(parse_join_blocked(
            &inner,
            "output_log.txt",
            blocked_line,
            content(blocked_line),
            false,
        ));
        assert!(parse_avatar_pedestal_change(
            &inner,
            "output_log.txt",
            pedestal_line,
            content(pedestal_line),
            false,
        ));
        assert!(parse_world_vrcx(
            &inner,
            "output_log.txt",
            vrcx_line,
            content(vrcx_line),
            false,
        ));
        assert!(parse_screenshot(
            &inner,
            "output_log.txt",
            screenshot_line,
            content(screenshot_line),
            false,
        ));

        assert_eq!(
            parsed_payloads(&inner),
            vec![
                payload(&[
                    "api-request",
                    "https://api.vrchat.cloud/api/1/users/usr_test",
                ]),
                payload(&["avatar-change", "Maple", "Test Avatar"]),
                payload(&["event", "Joining instance blocked by master"]),
                payload(&["event", "Pedestal User changed avatar pedestal"]),
                payload(&[
                    "vrcx",
                    "VideoPlay(PyPyDance) \"https://example.test\",0,10,\"Song\"",
                ]),
                payload(&["screenshot", "C:\\Users\\about\\Pictures\\VRChat\\shot.png",]),
            ]
        );
    }

    #[test]
    fn parses_video_play_sources_and_sync_events() {
        let inner = make_inner();
        let video_line =
            "2026.06.21 23:01:00 Log        -  [Video Playback] Attempting to resolve URL 'https://example.test/video.mp4'";
        let avpro_line =
            "2026.06.21 23:01:10 Log        -  [Video Playback] Resolving URL 'https://youtu.be/video'";
        let sdk2_line =
            "2026.06.21 23:01:20 Log        -  User Maple added URL https://example.test/sdk2";
        let usharp_line =
            "2026.06.21 23:01:30 Log        -  [USharpVideo] Started video load for URL: https://example.test/usharp, requested by Udon User";
        let sync_line = "2026.06.21 23:01:40 Log        -  [USharpVideo] Syncing video to 12.34";

        assert!(parse_video_change(
            &inner,
            "output_log.txt",
            video_line,
            content(video_line),
            false,
        ));
        assert!(parse_avpro_video_change(
            &inner,
            "output_log.txt",
            avpro_line,
            content(avpro_line),
            false,
        ));
        assert!(parse_sdk2_video_play(
            &inner,
            "output_log.txt",
            sdk2_line,
            content(sdk2_line),
            false,
        ));
        assert!(parse_usharp_video_play(
            &inner,
            "output_log.txt",
            usharp_line,
            content(usharp_line),
            false,
        ));
        assert!(parse_usharp_video_sync(
            &inner,
            "output_log.txt",
            sync_line,
            content(sync_line),
            false,
        ));

        assert_eq!(
            parsed_payloads(&inner),
            vec![
                payload(&["video-play", "https://example.test/video.mp4", ""]),
                payload(&["video-play", "https://youtu.be/video", ""]),
                payload(&["video-play", "https://example.test/sdk2", "Maple"]),
                payload(&["video-play", "https://example.test/usharp", "Udon User"]),
                payload(&["video-sync", "12.34"]),
            ]
        );
    }

    #[test]
    fn deduplicates_video_errors_and_adds_youtube_bot_hint() {
        let inner = make_inner();
        let mut ctx = LogContext::new();
        let playback_line =
            "2026.06.21 23:02:00 Error      -  [Video Playback] ERROR: Sign in to confirm you are not a bot";
        let avpro_line = "2026.06.21 23:02:10 Error      -  [AVProVideo] Error: HTTP 403 Forbidden";

        assert!(parse_video_error(
            &inner,
            "output_log.txt",
            playback_line,
            content(playback_line),
            &mut ctx,
            false,
        ));
        assert!(parse_video_error(
            &inner,
            "output_log.txt",
            playback_line,
            content(playback_line),
            &mut ctx,
            false,
        ));
        assert!(parse_video_error(
            &inner,
            "output_log.txt",
            avpro_line,
            content(avpro_line),
            &mut ctx,
            false,
        ));

        assert_eq!(
            parsed_payloads(&inner),
            vec![
                payload(&[
                    "event",
                    "VideoError: [VRCX] Fix error with this: https://github.com/EllyVR/VRCVideoCacher\nSign in to confirm you are not a bot",
                ]),
                payload(&["event", "VideoError: HTTP 403 Forbidden"]),
            ]
        );
        assert_eq!(ctx.video_errors.len(), 2);
    }
}
