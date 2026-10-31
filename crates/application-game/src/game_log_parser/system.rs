use vrcx_0_core::game_log_parser::{GameLogEventKind, VIDEO_ERROR_EVENT_PREFIX};

use super::context::LogContext;
use super::sink::GameLogParseSink;

pub(crate) const APPLICATION_QUIT_MARKERS: [&str; 2] = [
    "VRCApplication: OnApplicationQuit at ",
    "VRCApplication: HandleApplicationQuit at ",
];

const VRCHAT_LOCAL_RESOURCE_URL_PREFIXES: [&str; 2] =
    ["http://127.0.0.1:22500", "http://localhost:22500"];

fn is_vrchat_local_resource_url(url: &str) -> bool {
    VRCHAT_LOCAL_RESOURCE_URL_PREFIXES
        .iter()
        .any(|prefix| url.starts_with(prefix))
}

pub(super) fn parse_shader_keywords_limit(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
) -> bool {
    if !content.contains("Maximum number (384) of shader global keywords exceeded") {
        return false;
    }
    if ctx.shader_keywords_limit_reached {
        return true;
    }
    out.push_event(
        fname,
        line,
        GameLogEventKind::Event {
            data: "Shader Keyword Limit has been reached".into(),
        },
    );
    ctx.shader_keywords_limit_reached = true;
    true
}

pub(super) fn parse_application_quit(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !APPLICATION_QUIT_MARKERS
        .iter()
        .any(|marker| content.starts_with(marker))
    {
        return false;
    }
    out.push_event(fname, line, GameLogEventKind::VrcQuit);
    out.set_vrc_closed_gracefully(true);
    true
}

pub(super) fn parse_openvr_init(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.starts_with("Initializing VRSDK.") && !content.starts_with("STEAMVR HMD Model: ") {
        return false;
    }
    out.push_event(fname, line, GameLogEventKind::OpenVrInit);
    true
}

pub(super) fn parse_desktop_mode(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.starts_with("VR Disabled") {
        return false;
    }
    out.push_event(fname, line, GameLogEventKind::DesktopMode);
    true
}

pub(super) fn parse_string_download(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let tag = "] Attempting to load String from URL '";
    if !content.contains(tag) {
        return false;
    }
    if let Some(pos) = line.rfind(tag) {
        let rest = &line[pos + tag.len()..];
        if let Some(end) = rest.rfind('\'') {
            let url = &rest[..end];
            if is_vrchat_local_resource_url(url) {
                return true;
            }
            out.push_event(
                fname,
                line,
                GameLogEventKind::ResourceLoad {
                    resource_type: "StringLoad".into(),
                    resource_url: url.into(),
                },
            );
        }
    }
    true
}

pub(super) fn parse_image_download(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let tag = "] Attempting to load image from URL '";
    if !content.contains(tag) {
        return false;
    }
    if let Some(pos) = line.rfind(tag) {
        let rest = &line[pos + tag.len()..];
        if let Some(end) = rest.rfind('\'') {
            let url = &rest[..end];
            if is_vrchat_local_resource_url(url) {
                return true;
            }
            out.push_event(
                fname,
                line,
                GameLogEventKind::ResourceLoad {
                    resource_type: "ImageLoad".into(),
                    resource_url: url.into(),
                },
            );
        }
    }
    true
}

pub(super) fn parse_vote_kick(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let tag = "[Behaviour] Received executive message: ";
    if !content.starts_with(tag) {
        return false;
    }
    out.push_event(
        fname,
        line,
        GameLogEventKind::Event {
            data: content[tag.len()..].into(),
        },
    );
    true
}

pub(super) fn parse_failed_to_join(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    let tag = "[Behaviour] Failed to join instance ";
    if !content.starts_with(tag) {
        return false;
    }
    out.push_event(
        fname,
        line,
        GameLogEventKind::Event {
            data: content[12..].into(),
        },
    );
    true
}

pub(super) fn parse_osc_failed(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.starts_with("Could not Start OSC: ") {
        return false;
    }
    out.push_event(
        fname,
        line,
        GameLogEventKind::Event {
            data: format!("VRChat couldn't start OSC server, \"{content}\""),
        },
    );
    true
}

pub(super) fn parse_untrusted_url(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
) -> bool {
    if !content.contains("Attempted to play an untrusted URL") {
        return false;
    }
    if !ctx.video_errors.insert(content.to_string()) {
        return true;
    }
    out.push_event(
        fname,
        line,
        GameLogEventKind::Event {
            data: format!("{VIDEO_ERROR_EVENT_PREFIX} {content}"),
        },
    );
    true
}

pub(super) fn parse_instance_reset(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.contains("[ModerationManager] This instance will be reset in ") {
        return false;
    }
    if let Some(pos) = content.find("[ModerationManager] ") {
        out.push_event(
            fname,
            line,
            GameLogEventKind::Event {
                data: content[pos + 20..].into(),
            },
        );
    }
    true
}

pub(super) fn parse_vote_kick_init(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.contains("[ModerationManager] A vote kick has been initiated against ") {
        return false;
    }
    if let Some(pos) = content.find("[ModerationManager] ") {
        out.push_event(
            fname,
            line,
            GameLogEventKind::Event {
                data: content[pos + 20..].into(),
            },
        );
    }
    true
}

pub(super) fn parse_vote_kick_success(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.contains("[ModerationManager] Vote to kick ") {
        return false;
    }
    if let Some(pos) = content.find("[ModerationManager] ") {
        out.push_event(
            fname,
            line,
            GameLogEventKind::Event {
                data: content[pos + 20..].into(),
            },
        );
    }
    true
}

pub(super) fn parse_sticker_spawn(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
) -> bool {
    if !content.contains("[StickersManager] User ")
        || !content.contains("inv_")
        || !content.contains("spawned sticker")
    {
        return false;
    }

    if let Some(pos) = content.find("[StickersManager] User ") {
        let info = &content[pos + 23..];
        let user_info = info
            .split_once(" spawned sticker")
            .map(|(user_info, _)| user_info)
            .unwrap_or(info);
        let (raw_user_id, display_name) = user_info
            .split_once(" (")
            .map(|(user_id, display_name)| {
                (
                    user_id,
                    display_name.strip_suffix(')').unwrap_or(display_name),
                )
            })
            .unwrap_or((user_info, ""));
        let user_id = raw_user_id
            .chars()
            .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '~' | ':' | '(' | ')'))
            .collect::<String>();
        let display_name = display_name.to_string();
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
        out.push_event(
            fname,
            line,
            GameLogEventKind::StickerSpawn {
                user_id,
                display_name,
                inventory_id: inv_id,
            },
        );
    }
    true
}

pub(super) fn parse_audio_config(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
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
            out.push_event(
                fname,
                line,
                GameLogEventKind::Event {
                    data: format!("Audio device changed, mic set to '{audio_device}'"),
                },
            );
            ctx.last_audio_device = audio_device.to_string();
            ctx.audio_device_changed = false;
        }
        return true;
    }

    false
}

pub(super) fn parse_udon_exception(
    out: &mut dyn GameLogParseSink,
    fname: &str,
    line: &str,
) -> bool {
    if line.contains("[PyPyDance]") {
        out.push_event(
            fname,
            line,
            GameLogEventKind::UdonException { data: line.into() },
        );
        return true;
    }
    if let Some(pos) = line.find(" ---> VRC.Udon.VM.UdonVMException: ") {
        out.push_event(
            fname,
            line,
            GameLogEventKind::UdonException {
                data: line[pos..].into(),
            },
        );
        return true;
    }
    false
}
