use super::*;

pub(super) fn parse_user_info(s: &str) -> (String, String) {
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

pub(super) fn parse_location(
    inner: &Inner,
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

pub(super) fn parse_location_destination(
    inner: &Inner,
    fname: &str,
    line: &str,
    content: &str,
    ctx: &mut LogContext,
    first_run: bool,
) -> bool {
    if content.contains("[Behaviour] OnLeftRoom") {
        append_event(
            inner,
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

pub(super) fn parse_player_joined_or_left(
    inner: &Inner,
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

pub(super) fn parse_portal_spawn(inner: &Inner, fname: &str, line: &str, first_run: bool) -> bool {
    if line.contains("[Behaviour] Instantiated a (Clone [")
        && line.contains("] Portals/PortalInternalDynamic)")
    {
        append_event(inner, fname, line, GameLogEventKind::PortalSpawn, first_run);
        return true;
    }
    false
}

pub(super) fn parse_notification(
    inner: &Inner,
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
                fname,
                line,
                GameLogEventKind::Notification { data: data.into() },
                first_run,
            );
        }
    }
    true
}
