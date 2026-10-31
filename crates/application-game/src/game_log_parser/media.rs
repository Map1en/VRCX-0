use vrcx_0_core::game_log_parser::{GameLogEventKind, VIDEO_ERROR_EVENT_PREFIX};

use super::context::LogContext;
use super::sink::GameLogParseSink;

pub(super) fn parse_api_request(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.starts_with("[API] [") {
        return false;
    }
    if let Some(pos) = line.rfind("] Sending Get request to ") {
        let data = &line[pos + 25..];
        out.push_event(
            fname,
            line,
            GameLogEventKind::ApiRequest { url: data.into() },
        );
        return true;
    }
    false
}

pub(super) fn parse_avatar_change(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.starts_with("[Behaviour] Switching ") {
        return false;
    }
    if let Some(pos) = line.rfind(" to avatar ") {
        if let Some(start) = line.rfind("[Behaviour] Switching ") {
            let display_name = &line[start + 22..pos];
            let avatar_name = &line[pos + 11..];
            out.push_event(
                fname,
                line,
                GameLogEventKind::AvatarChange {
                    display_name: display_name.into(),
                    avatar_name: avatar_name.into(),
                },
            );
        }
    }
    true
}

pub(super) fn parse_join_blocked(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.contains("] Master is not sending any events! Moving to a new instance.") {
        return false;
    }
    out.push_event(
        fname,
        line,
        GameLogEventKind::Event {
            data: "Joining instance blocked by master".into(),
        },
    );
    true
}

pub(super) fn parse_avatar_pedestal_change(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let tag = "[Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for ";
    if !content.starts_with(tag) {
        return false;
    }
    let data = &content[tag.len()..];
    out.push_event(
        fname,
        line,
        GameLogEventKind::Event {
            data: format!("{data} changed avatar pedestal"),
        },
    );
    true
}

pub(super) fn parse_video_error(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
) -> bool {
    if content.contains("[Video Playback] ERROR: ") {
        if let Some(pos) = content.find("[Video Playback] ERROR: ") {
            let data = content[pos + 24..].to_string();
            if !ctx.video_errors.insert(data.clone()) {
                return true;
            }
            out.push_event(
                fname,
                line,
                GameLogEventKind::Event {
                    data: format!("{VIDEO_ERROR_EVENT_PREFIX} {data}"),
                },
            );
        }
        return true;
    }

    if content.contains("[AVProVideo] Error: ") {
        if let Some(pos) = content.find("[AVProVideo] Error: ") {
            let data = content[pos + 20..].to_string();
            if !ctx.video_errors.insert(data.clone()) {
                return true;
            }
            out.push_event(
                fname,
                line,
                GameLogEventKind::Event {
                    data: format!("{VIDEO_ERROR_EVENT_PREFIX} {data}"),
                },
            );
        }
        return true;
    }

    false
}

pub(super) fn parse_now_playing_log(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let Some(data) = content.strip_prefix("nowplaying ") else {
        return false;
    };
    let Some(end) = data.rfind('}').filter(|_| data.starts_with('{')) else {
        return false;
    };
    out.push_event(
        fname,
        line,
        GameLogEventKind::NowPlaying {
            data: data[..=end].into(),
        },
    );
    true
}

pub(super) fn parse_video_change(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let tag = "[Video Playback] Attempting to resolve URL '";
    if !content.starts_with(tag) {
        return false;
    }
    let rest = &content[tag.len()..];
    if let Some(end) = rest.rfind('\'') {
        let url = &rest[..end];
        out.push_event(
            fname,
            line,
            GameLogEventKind::VideoPlay {
                video_url: url.into(),
                display_name: String::new(),
            },
        );
    }
    true
}

pub(super) fn parse_avpro_video_change(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let tag = "[Video Playback] Resolving URL '";
    if !content.starts_with(tag) {
        return false;
    }
    let rest = &content[tag.len()..];
    if let Some(end) = rest.rfind('\'') {
        let url = &rest[..end];
        out.push_event(
            fname,
            line,
            GameLogEventKind::VideoPlay {
                video_url: url.into(),
                display_name: String::new(),
            },
        );
    }
    true
}

pub(super) fn parse_sdk2_video_play(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.starts_with("User ") {
        return false;
    }
    if let Some(pos) = content.rfind(" added URL ") {
        let display_name = &content[5..pos];
        let url = &content[pos + 11..];
        out.push_event(
            fname,
            line,
            GameLogEventKind::VideoPlay {
                video_url: url.into(),
                display_name: display_name.into(),
            },
        );
        return true;
    }
    false
}

pub(super) fn parse_usharp_video_play(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let tag = "[USharpVideo] Started video load for URL: ";
    if !content.starts_with(tag) {
        return false;
    }
    if let Some(pos) = content.rfind(", requested by ") {
        let url = &content[tag.len()..pos];
        let display_name = &content[pos + 15..];
        out.push_event(
            fname,
            line,
            GameLogEventKind::VideoPlay {
                video_url: url.into(),
                display_name: display_name.into(),
            },
        );
    }
    true
}

pub(super) fn parse_usharp_video_sync(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let tag = "[USharpVideo] Syncing video to ";
    if !content.starts_with(tag) {
        return false;
    }
    let data = &content[tag.len()..];
    out.push_event(
        fname,
        line,
        GameLogEventKind::VideoSync {
            timestamp: data.into(),
        },
    );
    true
}

pub(super) fn parse_world_vrcx(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.starts_with("[VRCX] ") {
        return false;
    }
    let data = &content[7..];
    out.push_event(fname, line, GameLogEventKind::Vrcx { data: data.into() });
    true
}

pub(super) fn parse_screenshot(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.contains("[VRC Camera] Took screenshot to: ") {
        return false;
    }
    if let Some(pos) = line.rfind("] Took screenshot to: ") {
        let path = &line[pos + 22..];
        out.push_event(
            fname,
            line,
            GameLogEventKind::Screenshot { path: path.into() },
        );
    }
    true
}
