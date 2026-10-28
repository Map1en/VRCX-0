use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::{Deserialize, Serialize};
use vrcx_0_core::game_log_parser::{parse_authenticated_user, parse_log_line_header};
use vrcx_0_core::vrchat_log_reader::parse_output_log_file_timestamp;
use vrcx_0_core::OwnerId;

use crate::game_log::video::{normalize_video_input, video_play_entry};
use crate::game_log::{GameLogIngestEngine, GameLogIngestOptions, GameLogSideEffect};
use crate::game_log_parser::{parse_log, GameLogEvent, GameLogParseSink, LogContext, LogReader};
use crate::{GameStateStore, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GameLogImportFileStatus {
    Ready,
    AccountUnverified,
    AccountMismatch,
    LiveFile,
    Unreadable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogImportFile {
    pub path: String,
    pub file_name: String,
    pub status: GameLogImportFileStatus,
    pub imported: bool,
    pub inserted_count: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogImportConsent {
    pub unverified_account: bool,
    pub account_mismatch: bool,
}

pub fn inspect_game_log_import_file(
    path: &Path,
    current_user_id: &str,
    game_running: bool,
) -> GameLogImportFile {
    let status = if game_running && is_newest_output_log(path) {
        GameLogImportFileStatus::LiveFile
    } else {
        account_status(path, current_user_id)
    };
    GameLogImportFile {
        path: path.to_string_lossy().into_owned(),
        file_name: file_name(path),
        status,
        imported: false,
        inserted_count: 0,
    }
}

pub fn import_game_log_file(
    store: &dyn GameStateStore,
    owner: &OwnerId,
    path: &Path,
    consent: GameLogImportConsent,
    game_running: bool,
) -> Result<GameLogImportFile> {
    let mut file = inspect_game_log_import_file(path, owner.as_str(), game_running);
    let importable = match file.status {
        GameLogImportFileStatus::Ready => true,
        GameLogImportFileStatus::AccountUnverified => consent.unverified_account,
        GameLogImportFileStatus::AccountMismatch => consent.account_mismatch,
        _ => false,
    };
    if !importable {
        return Ok(file);
    }
    let Some(events) = read_events(path, &file.file_name) else {
        file.status = GameLogImportFileStatus::Unreadable;
        return Ok(file);
    };

    let output = GameLogIngestEngine::default().ingest_events(
        &events,
        GameLogIngestOptions {
            log_resource_load: store.get_bool("logResourceLoad", false)?,
        },
    );
    let mut batch = output.batch;
    for side_effect in output.side_effects {
        let GameLogSideEffect::Video(mut input) = side_effect else {
            continue;
        };
        if normalize_video_input(&mut input).is_none() {
            continue;
        }
        if input.user_id.is_empty() && !input.display_name.is_empty() {
            input.user_id = store.user_id_from_display_name(owner, &input.display_name)?;
        }
        batch.video_plays.push(video_play_entry(&input));
    }

    let inserted_count = if batch.is_empty() {
        0
    } else {
        store.write_game_log(owner, &batch)?.inserted
    };

    file.imported = true;
    file.inserted_count = u32::try_from(inserted_count).unwrap_or(u32::MAX);
    Ok(file)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn is_newest_output_log(path: &Path) -> bool {
    let Some(timestamp) = parse_output_log_file_timestamp(&file_name(path)) else {
        return false;
    };
    let Some(Ok(entries)) = path.parent().map(fs::read_dir) else {
        return false;
    };
    !entries.filter_map(|entry| entry.ok()).any(|entry| {
        parse_output_log_file_timestamp(&entry.file_name().to_string_lossy())
            .is_some_and(|other| other > timestamp)
    })
}

fn account_status(path: &Path, current_user_id: &str) -> GameLogImportFileStatus {
    let Ok(file) = File::open(path) else {
        return GameLogImportFileStatus::Unreadable;
    };
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    let mut verified = false;
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => return GameLogImportFileStatus::Unreadable,
        }
        let line = String::from_utf8_lossy(&line);
        let Some((_, content)) = parse_log_line_header(line.trim_end()) else {
            continue;
        };
        let Some((_, user_id)) = parse_authenticated_user(content) else {
            continue;
        };
        if user_id != current_user_id {
            return GameLogImportFileStatus::AccountMismatch;
        }
        verified = true;
    }
    if verified {
        GameLogImportFileStatus::Ready
    } else {
        GameLogImportFileStatus::AccountUnverified
    }
}

#[derive(Default)]
struct CollectingSink {
    events: Vec<GameLogEvent>,
}

impl GameLogParseSink for CollectingSink {
    fn push(&mut self, event: GameLogEvent) {
        self.events.push(event);
    }

    fn set_vrc_closed_gracefully(&mut self, _value: bool) {}
}

fn read_events(path: &Path, file_name: &str) -> Option<Vec<GameLogEvent>> {
    let mut reader = LogReader::new();
    let mut sink = CollectingSink::default();
    let mut context = LogContext::new();
    let read_from = chrono::DateTime::UNIX_EPOCH.naive_utc();
    loop {
        let changed = parse_log(
            &mut reader,
            &mut sink,
            path,
            file_name,
            &mut context,
            read_from,
        );
        if context.read_failed {
            return None;
        }
        if !changed || context.at_end {
            return Some(sink.events);
        }
    }
}

#[cfg(test)]
mod tests;
