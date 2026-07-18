use super::media::{
    parse_api_request, parse_avatar_change, parse_avatar_pedestal_change, parse_avpro_video_change,
    parse_join_blocked, parse_screenshot, parse_sdk2_video_play, parse_usharp_video_play,
    parse_usharp_video_sync, parse_video_change, parse_video_error, parse_world_vrcx,
};
use super::presence::{
    parse_location, parse_location_destination, parse_notification, parse_player_joined_or_left,
    parse_portal_spawn,
};
use super::system::{
    parse_application_quit, parse_audio_config, parse_desktop_mode, parse_failed_to_join,
    parse_image_download, parse_instance_reset, parse_openvr_init, parse_osc_failed,
    parse_shader_keywords_limit, parse_sticker_spawn, parse_string_download, parse_udon_exception,
    parse_untrusted_url, parse_vote_kick, parse_vote_kick_init, parse_vote_kick_success,
};
use super::*;

pub(in crate::log_watcher) fn parse_log(
    inner: &Inner,
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

        if parse_udon_exception(inner, file_name, trimmed, first_run) {
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
            let _ = parse_player_joined_or_left(inner, file_name, trimmed, content, first_run)
                || parse_location(inner, file_name, trimmed, content, ctx, first_run)
                || parse_location_destination(inner, file_name, trimmed, content, ctx, first_run)
                || parse_portal_spawn(inner, file_name, trimmed, first_run)
                || parse_notification(inner, file_name, trimmed, content, first_run)
                || parse_api_request(inner, file_name, trimmed, content, first_run)
                || parse_avatar_change(inner, file_name, trimmed, content, first_run)
                || parse_join_blocked(inner, file_name, trimmed, content, first_run)
                || parse_avatar_pedestal_change(inner, file_name, trimmed, content, first_run)
                || parse_video_error(inner, file_name, trimmed, content, ctx, first_run)
                || parse_video_change(inner, file_name, trimmed, content, first_run)
                || parse_avpro_video_change(inner, file_name, trimmed, content, first_run)
                || parse_usharp_video_play(inner, file_name, trimmed, content, first_run)
                || parse_usharp_video_sync(inner, file_name, trimmed, content, first_run)
                || parse_world_vrcx(inner, file_name, trimmed, content, first_run)
                || parse_audio_config(inner, file_name, trimmed, content, ctx, first_run)
                || parse_screenshot(inner, file_name, trimmed, content, first_run)
                || parse_string_download(inner, file_name, trimmed, content, first_run)
                || parse_image_download(inner, file_name, trimmed, content, first_run)
                || parse_vote_kick(inner, file_name, trimmed, content, first_run)
                || parse_failed_to_join(inner, file_name, trimmed, content, first_run)
                || parse_instance_reset(inner, file_name, trimmed, content, first_run)
                || parse_vote_kick_init(inner, file_name, trimmed, content, first_run)
                || parse_vote_kick_success(inner, file_name, trimmed, content, first_run)
                || parse_sticker_spawn(inner, file_name, trimmed, content, first_run);
        } else {
            let _ = parse_shader_keywords_limit(inner, file_name, trimmed, content, ctx, first_run)
                || parse_sdk2_video_play(inner, file_name, trimmed, content, first_run)
                || parse_application_quit(inner, file_name, trimmed, content, ctx, first_run)
                || parse_openvr_init(inner, file_name, trimmed, content, first_run)
                || parse_desktop_mode(inner, file_name, trimmed, content, first_run)
                || parse_osc_failed(inner, file_name, trimmed, content, first_run)
                || parse_untrusted_url(inner, file_name, trimmed, content, ctx, first_run);
        }
    }

    ctx.position = reader.stream_position().unwrap_or(ctx.position);
    ctx.position > initial_position
}
