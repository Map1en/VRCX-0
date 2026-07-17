use super::presence::parse_user_info;
use super::*;

const VRCHAT_LOCAL_RESOURCE_URL_PREFIXES: [&str; 2] =
    ["http://127.0.0.1:22500", "http://localhost:22500"];

fn is_vrchat_local_resource_url(url: &str) -> bool {
    VRCHAT_LOCAL_RESOURCE_URL_PREFIXES
        .iter()
        .any(|prefix| url.starts_with(prefix))
}

pub(super) fn parse_shader_keywords_limit(
    inner: &Inner,
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

pub(super) fn parse_application_quit(
    inner: &Inner,
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
    append_event(inner, fname, line, GameLogEventKind::VrcQuit, first_run);
    *inner.vrc_closed_gracefully.lock().unwrap() = true;
    true
}

pub(super) fn parse_openvr_init(
    inner: &Inner,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("Initializing VRSDK.") && !content.starts_with("STEAMVR HMD Model: ") {
        return false;
    }
    append_event(inner, fname, line, GameLogEventKind::OpenVrInit, first_run);
    true
}

pub(super) fn parse_desktop_mode(
    inner: &Inner,
    fname: &str,
    line: &str,
    content: &str,
    first_run: bool,
) -> bool {
    if !content.starts_with("VR Disabled") {
        return false;
    }
    append_event(inner, fname, line, GameLogEventKind::DesktopMode, first_run);
    true
}

pub(super) fn parse_string_download(
    inner: &Inner,
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
            if is_vrchat_local_resource_url(url) {
                return true;
            }
            append_event(
                inner,
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

pub(super) fn parse_image_download(
    inner: &Inner,
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
            if is_vrchat_local_resource_url(url) {
                return true;
            }
            append_event(
                inner,
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

pub(super) fn parse_vote_kick(
    inner: &Inner,
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
        fname,
        line,
        GameLogEventKind::Event {
            data: content[tag.len()..].into(),
        },
        first_run,
    );
    true
}

pub(super) fn parse_failed_to_join(
    inner: &Inner,
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
        fname,
        line,
        GameLogEventKind::Event {
            data: content[12..].into(),
        },
        first_run,
    );
    true
}

pub(super) fn parse_osc_failed(
    inner: &Inner,
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
        fname,
        line,
        GameLogEventKind::Event {
            data: format!("VRChat couldn't start OSC server, \"{content}\""),
        },
        first_run,
    );
    true
}

pub(super) fn parse_untrusted_url(
    inner: &Inner,
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
        fname,
        line,
        GameLogEventKind::Event {
            data: format!("VideoError: {content}"),
        },
        first_run,
    );
    true
}

pub(super) fn parse_instance_reset(
    inner: &Inner,
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

pub(super) fn parse_vote_kick_init(
    inner: &Inner,
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

pub(super) fn parse_vote_kick_success(
    inner: &Inner,
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

pub(super) fn parse_sticker_spawn(
    inner: &Inner,
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
        let user_info = info
            .split_once(" spawned sticker")
            .map(|(user_info, _)| user_info)
            .unwrap_or(info);
        let (display_name, user_id) = parse_user_info(user_info);
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

pub(super) fn parse_audio_config(
    inner: &Inner,
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

pub(super) fn parse_udon_exception(
    inner: &Inner,
    fname: &str,
    line: &str,
    first_run: bool,
) -> bool {
    if line.contains("[PyPyDance]") {
        append_event(
            inner,
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
