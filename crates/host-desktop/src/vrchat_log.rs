use std::fs;
use std::io::{BufRead, BufReader, ErrorKind};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use vrcx_0_core::vrchat_log_reader::{
    parse_log_document, LogEntry, LogEntryFilter, LogQuery, ParsedLogDocument, LOG_LEVELS,
};
use vrcx_0_platform::Error;

use crate::host_capabilities::{require_host_capability, HostCapability};
use crate::vrchat_paths;

const DEFAULT_ENTRY_LIMIT: usize = 300;
const MAX_ENTRY_LIMIT: usize = 1000;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatLogFileOutput {
    pub file_name: String,
    pub modified_at: Option<String>,
    pub size: u64,
    pub latest: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatLogEntryOutput {
    pub timestamp: String,
    pub level: String,
    pub category: Option<String>,
    pub message: String,
    pub raw: String,
    pub line_number: u32,
    pub end_line_number: u32,
    pub file_name: String,
    pub continuation_lines: Vec<String>,
}

impl From<LogEntry> for VrchatLogEntryOutput {
    fn from(entry: LogEntry) -> Self {
        Self {
            timestamp: entry.timestamp,
            level: entry.level,
            category: entry.category,
            message: entry.message,
            raw: entry.raw,
            line_number: entry.line_number,
            end_line_number: entry.end_line_number,
            file_name: entry.file_name,
            continuation_lines: entry.continuation_lines,
        }
    }
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatLogEntriesReadInput {
    pub file_name: String,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
    pub query: Option<String>,
    pub query_case_sensitive: Option<bool>,
    pub query_regex: Option<bool>,
    pub levels: Option<Vec<String>>,
    pub categories: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatLogTailReadInput {
    pub file_name: Option<String>,
    pub after_line_number: Option<u32>,
    pub file_size: Option<u64>,
    pub limit: Option<u32>,
    pub query: Option<String>,
    pub query_case_sensitive: Option<bool>,
    pub query_regex: Option<bool>,
    pub levels: Option<Vec<String>>,
    pub categories: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatLogLevelCountOutput {
    pub level: String,
    pub count: u32,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatLogEntriesReadOutput {
    pub file_name: String,
    pub entries: Vec<VrchatLogEntryOutput>,
    pub level_counts: Option<Vec<VrchatLogLevelCountOutput>>,
    pub offset: u32,
    pub next_offset: Option<u32>,
    pub total_entries: u32,
    pub total_lines: u32,
    pub last_line_number: u32,
    pub file_size: u64,
    pub file_modified_at: Option<String>,
    pub reset_required: bool,
}

struct LogFileCandidate {
    output: VrchatLogFileOutput,
    modified: SystemTime,
}

struct LogFileState {
    size: u64,
    modified_at: Option<String>,
}

pub fn files_list() -> Result<Vec<VrchatLogFileOutput>, Error> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    list_log_files(&vrchat_paths::vrchat_app_data())
}

pub fn entries_read(input: VrchatLogEntriesReadInput) -> Result<VrchatLogEntriesReadOutput, Error> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    read_log_entries(&vrchat_paths::vrchat_app_data(), input)
}

pub fn tail_read(input: VrchatLogTailReadInput) -> Result<VrchatLogEntriesReadOutput, Error> {
    require_host_capability(HostCapability::VrchatPathDiscovery)?;
    read_log_tail(&vrchat_paths::vrchat_app_data(), input)
}

fn read_log_entries(
    base_dir: &Path,
    input: VrchatLogEntriesReadInput,
) -> Result<VrchatLogEntriesReadOutput, Error> {
    let file_name = validate_log_file_name(&input.file_name)?.to_string();
    let file_state = log_file_state(base_dir, &file_name)?;
    let ParsedLogDocument {
        entries,
        total_lines,
    } = read_log_document(base_dir, &file_name)?;
    let filter = LogEntryFilter::from_parts(
        LogQuery {
            text: input.query,
            case_sensitive: input.query_case_sensitive.unwrap_or(false),
            use_regex: input.query_regex.unwrap_or(false),
        },
        input.levels,
        input.categories,
    )
    .map_err(|message| Error::Custom(format!("Invalid search pattern: {message}")))?;
    let level_counts = count_levels(&entries, &filter);
    let output_offset = input.offset.unwrap_or(0);
    let offset = output_offset as usize;
    let limit = normalize_limit(input.limit);
    let filtered_entries = entries
        .into_iter()
        .filter(|entry| filter.matches(entry))
        .collect::<Vec<_>>();
    let total_entries = filtered_entries.len();
    let page = filtered_entries
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(VrchatLogEntryOutput::from)
        .collect::<Vec<_>>();
    let next_offset = offset + page.len();
    let output_next_offset = u32::try_from(next_offset).unwrap_or(u32::MAX);

    Ok(VrchatLogEntriesReadOutput {
        file_name,
        entries: page,
        level_counts: Some(level_counts),
        offset: output_offset,
        next_offset: (next_offset < total_entries).then_some(output_next_offset),
        total_entries: u32::try_from(total_entries).unwrap_or(u32::MAX),
        total_lines: u32::try_from(total_lines).unwrap_or(u32::MAX),
        last_line_number: u32::try_from(total_lines).unwrap_or(u32::MAX),
        file_size: file_state.size,
        file_modified_at: file_state.modified_at,
        reset_required: false,
    })
}

fn read_log_tail(
    base_dir: &Path,
    input: VrchatLogTailReadInput,
) -> Result<VrchatLogEntriesReadOutput, Error> {
    let file_name = match input.file_name.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => validate_log_file_name(value)?.to_string(),
        _ => latest_log_file_name(base_dir)?,
    };
    let after_line_number = input.after_line_number.unwrap_or(0);
    let limit = normalize_limit(input.limit);
    let file_state = log_file_state(base_dir, &file_name)?;

    if input
        .file_size
        .is_some_and(|previous_size| file_state.size < previous_size)
    {
        return Ok(VrchatLogEntriesReadOutput {
            file_name,
            entries: Vec::new(),
            level_counts: None,
            offset: 0,
            next_offset: None,
            total_entries: 0,
            total_lines: 0,
            last_line_number: 0,
            file_size: file_state.size,
            file_modified_at: file_state.modified_at,
            reset_required: true,
        });
    }

    let total_lines = count_log_lines(base_dir, &file_name)?;
    let output_total_lines = u32::try_from(total_lines).unwrap_or(u32::MAX);
    if output_total_lines <= after_line_number {
        return Ok(VrchatLogEntriesReadOutput {
            file_name,
            entries: Vec::new(),
            level_counts: None,
            offset: 0,
            next_offset: None,
            total_entries: 0,
            total_lines: output_total_lines,
            last_line_number: output_total_lines,
            file_size: file_state.size,
            file_modified_at: file_state.modified_at,
            reset_required: false,
        });
    }

    let ParsedLogDocument {
        entries,
        total_lines: _,
    } = read_log_document(base_dir, &file_name)?;
    let filter = LogEntryFilter::from_parts(
        LogQuery {
            text: input.query,
            case_sensitive: input.query_case_sensitive.unwrap_or(false),
            use_regex: input.query_regex.unwrap_or(false),
        },
        input.levels,
        input.categories,
    )
    .map_err(|message| Error::Custom(format!("Invalid search pattern: {message}")))?;
    let level_counts = count_levels(&entries, &filter);
    let filtered_entries = entries
        .into_iter()
        .filter(|entry| entry.end_line_number > after_line_number && filter.matches(entry))
        .collect::<Vec<_>>();
    let total_entries = filtered_entries.len();
    let tail_entries = filtered_entries.into_iter().take(limit).collect::<Vec<_>>();
    let last_line_number = if tail_entries.len() >= limit {
        tail_entries
            .last()
            .map(|entry| entry.end_line_number)
            .unwrap_or(after_line_number)
    } else {
        output_total_lines
    };
    let tail_entries = tail_entries
        .into_iter()
        .map(VrchatLogEntryOutput::from)
        .collect::<Vec<_>>();

    Ok(VrchatLogEntriesReadOutput {
        file_name,
        entries: tail_entries,
        level_counts: Some(level_counts),
        offset: 0,
        next_offset: None,
        total_entries: u32::try_from(total_entries).unwrap_or(u32::MAX),
        total_lines: output_total_lines,
        last_line_number,
        file_size: file_state.size,
        file_modified_at: file_state.modified_at,
        reset_required: false,
    })
}

fn count_levels(entries: &[LogEntry], filter: &LogEntryFilter) -> Vec<VrchatLogLevelCountOutput> {
    let mut counts = [0u32; LOG_LEVELS.len()];
    for entry in entries {
        let Some(index) = LOG_LEVELS.iter().position(|level| *level == entry.level) else {
            continue;
        };
        if filter.matches_ignoring_level(entry) {
            counts[index] = counts[index].saturating_add(1);
        }
    }

    LOG_LEVELS
        .iter()
        .zip(counts)
        .map(|(level, count)| VrchatLogLevelCountOutput {
            level: (*level).to_string(),
            count,
        })
        .collect()
}

fn normalize_limit(limit: Option<u32>) -> usize {
    limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_ENTRY_LIMIT)
        .clamp(1, MAX_ENTRY_LIMIT)
}

fn latest_log_file_name(base_dir: &Path) -> Result<String, Error> {
    list_log_files(base_dir)?
        .into_iter()
        .next()
        .map(|file| file.file_name)
        .ok_or_else(|| Error::Custom("No VRChat output_log_*.txt files were found.".into()))
}

fn list_log_files(base_dir: &Path) -> Result<Vec<VrchatLogFileOutput>, Error> {
    if !base_dir.exists() {
        return Ok(Vec::new());
    }

    let read_dir = match fs::read_dir(base_dir) {
        Ok(read_dir) => read_dir,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut candidates = Vec::new();
    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if validate_log_file_name(&file_name).is_err() {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if !file_type.is_file() {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        candidates.push(LogFileCandidate {
            output: VrchatLogFileOutput {
                file_name,
                modified_at: Some(system_time_to_iso(modified)),
                size: metadata.len(),
                latest: false,
            },
            modified,
        });
    }

    candidates.sort_by(|left, right| {
        right
            .modified
            .cmp(&left.modified)
            .then_with(|| right.output.file_name.cmp(&left.output.file_name))
    });

    let mut files = candidates
        .into_iter()
        .map(|candidate| candidate.output)
        .collect::<Vec<_>>();
    if let Some(file) = files.first_mut() {
        file.latest = true;
    }
    Ok(files)
}

fn system_time_to_iso(time: SystemTime) -> String {
    let timestamp: chrono::DateTime<chrono::Utc> = time.into();
    timestamp.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn read_log_document(base_dir: &Path, file_name: &str) -> Result<ParsedLogDocument, Error> {
    let path = resolve_log_file_path(base_dir, file_name)?;
    let bytes = fs::read(path)?;
    let content = String::from_utf8_lossy(&bytes);
    Ok(parse_log_document(file_name, &content))
}

fn log_file_state(base_dir: &Path, file_name: &str) -> Result<LogFileState, Error> {
    let path = resolve_log_file_path(base_dir, file_name)?;
    let metadata = fs::metadata(path)?;
    Ok(LogFileState {
        size: metadata.len(),
        modified_at: metadata.modified().ok().map(system_time_to_iso),
    })
}

fn count_log_lines(base_dir: &Path, file_name: &str) -> Result<usize, Error> {
    let path = resolve_log_file_path(base_dir, file_name)?;
    let file = fs::File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut buffer = Vec::new();
    let mut count = 0;
    loop {
        buffer.clear();
        if reader.read_until(b'\n', &mut buffer)? == 0 {
            break;
        }
        count += 1;
    }
    Ok(count)
}

fn resolve_log_file_path(base_dir: &Path, file_name: &str) -> Result<PathBuf, Error> {
    let file_name = validate_log_file_name(file_name)?;
    let canonical_base = base_dir.canonicalize().map_err(|error| {
        Error::Custom(format!(
            "VRChat app data directory is not available: {error}"
        ))
    })?;
    let raw_path = base_dir.join(file_name);
    let raw_metadata = fs::symlink_metadata(&raw_path)?;
    if raw_metadata.file_type().is_symlink() || !raw_metadata.file_type().is_file() {
        return Err(Error::Custom(
            "The selected VRChat log file is not a regular file.".into(),
        ));
    }
    let canonical_file = raw_path.canonicalize()?;
    if !canonical_file.starts_with(&canonical_base) {
        return Err(Error::Custom(
            "VRChat log reads are limited to the VRChat app data directory.".into(),
        ));
    }
    if !canonical_file.is_file() {
        return Err(Error::Custom(
            "The selected VRChat log file is not a regular file.".into(),
        ));
    }
    Ok(canonical_file)
}

fn validate_log_file_name(file_name: &str) -> Result<&str, Error> {
    let file_name = file_name.trim();
    if file_name.is_empty()
        || file_name.contains("..")
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains(':')
    {
        return Err(Error::Custom("Invalid VRChat output log file name.".into()));
    }

    if !file_name.starts_with("output_log_") || !file_name.ends_with(".txt") {
        return Err(Error::Custom(
            "VRChat log reads require an output_log_*.txt file.".into(),
        ));
    }
    Ok(file_name)
}

#[cfg(test)]
mod tests;
