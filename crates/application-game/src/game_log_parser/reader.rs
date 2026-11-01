use std::fs::File;
use std::io::{BufRead, BufReader, Cursor, Read, Seek, SeekFrom};
use std::path::Path;

use chrono::{Local, NaiveDateTime};
use vrcx_0_core::game_log_parser::{parse_authenticated_user, parse_log_line_header};

use super::context::{GameLogAuthenticatedUser, LogContext};
use super::media::{
    parse_api_request, parse_avatar_change, parse_avatar_pedestal_change, parse_avpro_video_change,
    parse_join_blocked, parse_now_playing_log, parse_screenshot, parse_sdk2_video_play,
    parse_usharp_video_play, parse_usharp_video_sync, parse_video_change, parse_video_error,
    parse_world_vrcx,
};
use super::presence::{
    parse_location, parse_location_destination, parse_notification, parse_player_joined_or_left,
    parse_portal_spawn,
};
use super::sink::GameLogParseSink;
use super::system::{
    parse_application_quit, parse_audio_config, parse_desktop_mode, parse_failed_to_join,
    parse_image_download, parse_instance_reset, parse_openvr_init, parse_osc_failed,
    parse_shader_keywords_limit, parse_sticker_spawn, parse_string_download, parse_udon_exception,
    parse_untrusted_url, parse_vote_kick, parse_vote_kick_init, parse_vote_kick_success,
};

enum LogReaderSource {
    Empty(Cursor<[u8; 0]>),
    File(File),
}

impl Read for LogReaderSource {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Empty(reader) => reader.read(buffer),
            Self::File(reader) => reader.read(buffer),
        }
    }
}

impl Seek for LogReaderSource {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        match self {
            Self::Empty(reader) => reader.seek(position),
            Self::File(reader) => reader.seek(position),
        }
    }
}

pub(crate) struct LogReader {
    reader: Option<BufReader<LogReaderSource>>,
    #[cfg(test)]
    buffer_initialization_count: usize,
}

impl LogReader {
    pub(crate) fn new() -> Self {
        Self {
            reader: None,
            #[cfg(test)]
            buffer_initialization_count: 0,
        }
    }

    fn with_file<T>(
        &mut self,
        path: &Path,
        read: impl FnOnce(&mut BufReader<LogReaderSource>) -> T,
    ) -> std::io::Result<T> {
        let file = File::open(path)?;
        if let Some(reader) = self.reader.as_mut() {
            *reader.get_mut() = LogReaderSource::File(file);
        } else {
            self.reader = Some(BufReader::with_capacity(65536, LogReaderSource::File(file)));
            #[cfg(test)]
            {
                self.buffer_initialization_count += 1;
            }
        }
        let reader = self
            .reader
            .as_mut()
            .expect("GameLog reader was initialized");
        let result = read(reader);
        *reader.get_mut() = LogReaderSource::Empty(Cursor::new([]));
        Ok(result)
    }

    #[cfg(test)]
    pub(crate) fn buffer_initialization_count(&self) -> usize {
        self.buffer_initialization_count
    }

    #[cfg(test)]
    pub(crate) fn has_open_file(&self) -> bool {
        self.reader
            .as_ref()
            .is_some_and(|reader| matches!(reader.get_ref(), LogReaderSource::File(_)))
    }
}

pub(crate) fn parse_log(
    log_reader: &mut LogReader,
    out: &mut dyn GameLogParseSink,
    path: &Path,
    file_name: &str,
    ctx: &mut LogContext,
    till_date: NaiveDateTime,
) -> bool {
    ctx.read_failed = false;
    match log_reader.with_file(path, |reader| {
        parse_opened_log(out, reader, file_name, ctx, till_date)
    }) {
        Ok(changed) => changed,
        Err(error) => {
            ctx.read_failed = true;
            tracing::warn!("failed to read GameLog file {file_name}: {error}");
            false
        }
    }
}

fn parse_opened_log(
    out: &mut dyn GameLogParseSink,
    reader: &mut BufReader<LogReaderSource>,
    file_name: &str,
    ctx: &mut LogContext,
    till_date: NaiveDateTime,
) -> bool {
    if reader.seek(SeekFrom::Start(ctx.position)).is_err() {
        ctx.read_failed = true;
        return false;
    }

    let mut line = String::new();
    let initial_position = ctx.position;
    ctx.at_end = true;
    let mut line_count = 0;
    loop {
        let line_start = reader.stream_position().unwrap_or(ctx.position);
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Err(error) => {
                ctx.read_failed = true;
                tracing::warn!("failed to read GameLog line in {file_name}: {error}");
                break;
            }
            _ => {}
        }

        if !line.ends_with('\n') {
            let _ = reader.seek(SeekFrom::Start(line_start));
            break;
        }
        line_count += 1;
        if line_count > 256 {
            let _ = reader.seek(SeekFrom::Start(line_start));
            ctx.at_end = false;
            break;
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        if parse_udon_exception(out, file_name, trimmed) {
            continue;
        }

        let Some((line_date, content)) = parse_log_line_header(trimmed) else {
            continue;
        };

        if let Some((display_name, user_id)) = parse_authenticated_user(content) {
            ctx.authenticated_user = Some(GameLogAuthenticatedUser {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
            });
            continue;
        }

        if line_date <= till_date {
            continue;
        }

        let now_local = Local::now().naive_local();
        if line_date > now_local + chrono::Duration::minutes(61) {
            continue;
        }

        if content.starts_with('[') {
            let _ = parse_player_joined_or_left(out, file_name, trimmed, content)
                || parse_location(out, file_name, trimmed, content, ctx)
                || parse_location_destination(out, file_name, trimmed, content, ctx)
                || parse_portal_spawn(out, file_name, trimmed)
                || parse_notification(out, file_name, trimmed, content)
                || parse_api_request(out, file_name, trimmed, content)
                || parse_avatar_change(out, file_name, trimmed, content)
                || parse_join_blocked(out, file_name, trimmed, content)
                || parse_avatar_pedestal_change(out, file_name, trimmed, content)
                || parse_video_error(out, file_name, trimmed, content, ctx)
                || parse_video_change(out, file_name, trimmed, content)
                || parse_avpro_video_change(out, file_name, trimmed, content)
                || parse_usharp_video_play(out, file_name, trimmed, content)
                || parse_usharp_video_sync(out, file_name, trimmed, content)
                || parse_world_vrcx(out, file_name, trimmed, content)
                || parse_audio_config(out, file_name, trimmed, content, ctx)
                || parse_screenshot(out, file_name, trimmed, content)
                || parse_string_download(out, file_name, trimmed, content)
                || parse_image_download(out, file_name, trimmed, content)
                || parse_vote_kick(out, file_name, trimmed, content)
                || parse_failed_to_join(out, file_name, trimmed, content)
                || parse_instance_reset(out, file_name, trimmed, content)
                || parse_vote_kick_init(out, file_name, trimmed, content)
                || parse_vote_kick_success(out, file_name, trimmed, content)
                || parse_sticker_spawn(out, file_name, trimmed, content);
        } else {
            let _ = parse_now_playing_log(out, file_name, trimmed, content)
                || parse_shader_keywords_limit(out, file_name, trimmed, content, ctx)
                || parse_sdk2_video_play(out, file_name, trimmed, content)
                || parse_application_quit(out, file_name, trimmed, content)
                || parse_openvr_init(out, file_name, trimmed, content)
                || parse_desktop_mode(out, file_name, trimmed, content)
                || parse_osc_failed(out, file_name, trimmed, content)
                || parse_untrusted_url(out, file_name, trimmed, content, ctx);
        }
    }

    ctx.position = reader.stream_position().unwrap_or(ctx.position);
    ctx.position > initial_position
}
