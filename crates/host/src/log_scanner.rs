use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{Local, NaiveDateTime};
use vrcx_0_core::log_watcher::{
    clean_location, convert_log_time_to_iso8601, parse_log_line_header, LogLocationSnapshot,
};

#[derive(Clone)]
struct LogFileCandidate {
    path: PathBuf,
    file_name: String,
    timestamp: Option<NaiveDateTime>,
    modified: SystemTime,
}

pub fn scan_current_location_snapshot(log_dir: &Path) -> Option<LogLocationSnapshot> {
    let candidate = latest_output_log_candidate(log_dir)?;
    scan_log_file_location_snapshot(&candidate.path, &candidate.file_name)
}

pub fn scan_latest_vr_mode(log_dir: &Path) -> Option<bool> {
    let candidate = latest_output_log_candidate(log_dir)?;
    scan_log_file_vr_mode(&candidate.path)
}

fn latest_output_log_candidate(log_dir: &Path) -> Option<LogFileCandidate> {
    if !log_dir.exists() {
        return None;
    }

    let candidates: Vec<_> = fs::read_dir(log_dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("output_log_") || !name.ends_with(".txt") {
                return None;
            }
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            Some(LogFileCandidate {
                path,
                timestamp: parse_output_log_file_timestamp(&name),
                file_name: name,
                modified,
            })
        })
        .collect();

    candidates
        .iter()
        .filter(|candidate| candidate.timestamp.is_some())
        .max_by_key(|candidate| candidate.timestamp)
        .cloned()
        .or_else(|| {
            candidates
                .into_iter()
                .max_by_key(|candidate| candidate.modified)
        })
}

fn parse_output_log_file_timestamp(file_name: &str) -> Option<NaiveDateTime> {
    let timestamp = file_name
        .strip_prefix("output_log_")?
        .strip_suffix(".txt")?;
    NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%d_%H-%M-%S").ok()
}

fn scan_log_file_location_snapshot(path: &Path, file_name: &str) -> Option<LogLocationSnapshot> {
    let file = File::open(path).ok()?;
    let reader = BufReader::with_capacity(65536, file);
    let mut recent_world_name = String::new();
    let mut current_location: Option<LogLocationSnapshot> = None;

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim_end();
        let Some((line_date, content)) = parse_log_line_header(trimmed) else {
            continue;
        };
        let now_local = Local::now().naive_local();
        if line_date > now_local + chrono::Duration::minutes(61) {
            continue;
        }

        if content.contains("[Behaviour] Entering Room: ") {
            if let Some(pos) = trimmed.rfind("] Entering Room: ") {
                recent_world_name = trimmed[pos + 17..].to_string();
            }
            continue;
        }

        if content.contains("[Behaviour] OnLeftRoom") {
            current_location = None;
            continue;
        }

        if content.contains("[Behaviour] Joining ")
            && !content.contains("] Joining or Creating Room: ")
            && !content.contains("] Joining friend: ")
        {
            if let Some(pos) = trimmed.rfind("] Joining ") {
                let location = clean_location(&trimmed[pos + 10..]);
                if !location.is_empty() {
                    current_location = Some(LogLocationSnapshot {
                        location,
                        world_name: recent_world_name.clone(),
                        created_at: convert_log_time_to_iso8601(trimmed),
                        file_name: file_name.to_string(),
                    });
                }
            }
        }
    }

    current_location
}

fn scan_log_file_vr_mode(path: &Path) -> Option<bool> {
    let file = File::open(path).ok()?;
    let reader = BufReader::with_capacity(65536, file);
    let mut vr_mode = None;

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim_end();
        let Some((_line_date, content)) = parse_log_line_header(trimmed) else {
            continue;
        };
        if content.starts_with("Initializing VRSDK.") || content.starts_with("STEAMVR HMD Model: ")
        {
            vr_mode = Some(true);
        } else if content.starts_with("VR Disabled")
            || content.starts_with("VRCApplication: OnApplicationQuit at ")
            || content.starts_with("VRCApplication: HandleApplicationQuit at ")
        {
            vr_mode = Some(false);
        }
    }

    vr_mode
}
