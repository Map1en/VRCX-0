use super::*;

pub const APP_LAUNCHER_ENABLED_CONFIG_KEY: &str = "VRCX_appLauncherEnabledV2";
pub const APP_LAUNCHER_ENTRIES_CONFIG_KEY: &str = "VRCX_appLauncherEntriesV2";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherEntryKind {
    LocalApp,
    SteamApp,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherScope {
    All,
    Desktop,
    Vr,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherRunPolicy {
    Always,
    SkipIfRunning,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherStopPolicy {
    KeepRunning,
    CloseByVrcx,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherEntry {
    pub id: String,
    pub enabled: bool,
    pub name: String,
    pub kind: AppLauncherEntryKind,
    pub scope: AppLauncherScope,
    pub target: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub args: String,
    pub launch_delay_seconds: u32,
    pub run_policy: AppLauncherRunPolicy,
    pub stop_policy: AppLauncherStopPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherRunStatus {
    Waiting,
    Running,
    Skipped,
    Failed,
    Stopped,
    Completed,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherRun {
    pub id: String,
    pub entry_id: String,
    pub entry_name: String,
    pub kind: AppLauncherEntryKind,
    pub target: String,
    pub status: AppLauncherRunStatus,
    pub stop_policy: AppLauncherStopPolicy,
    pub test: bool,
    pub root_pid: Option<u32>,
    pub tracked_pids: Vec<u32>,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub error: Option<String>,
    pub skipped_reason: Option<String>,
    #[serde(skip)]
    pub(super) entry_signature: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherSession {
    pub id: String,
    pub steamvr_running: bool,
    pub started_at: u64,
    pub runs: Vec<AppLauncherRun>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherSnapshot {
    pub enabled: bool,
    pub entries: Vec<AppLauncherEntry>,
    pub active_session: Option<AppLauncherSession>,
    pub test_runs: Vec<AppLauncherRun>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherPickedTarget {
    pub kind: AppLauncherEntryKind,
    pub name: String,
    pub target: String,
    pub process_name: Option<String>,
    pub working_directory: Option<String>,
}

pub fn normalize_app_launcher_entries(entries: Vec<AppLauncherEntry>) -> Vec<AppLauncherEntry> {
    let mut seen_ids = HashSet::new();
    entries
        .into_iter()
        .enumerate()
        .map(|(index, mut entry)| {
            if entry.id.trim().is_empty() {
                entry.id = format!("entry-{index}");
            }
            if !seen_ids.insert(entry.id.clone()) {
                entry.id = format!("{}-{index}", entry.id);
                seen_ids.insert(entry.id.clone());
            }
            entry.name = entry.name.trim().to_string();
            if entry.name.is_empty() {
                entry.name = display_name_for_target(&entry.target);
            }
            if matches!(entry.kind, AppLauncherEntryKind::SteamApp) {
                entry.stop_policy = AppLauncherStopPolicy::KeepRunning;
                entry.args.clear();
                entry.working_directory = None;
            }
            entry.process_name = normalize_optional_string(entry.process_name);
            entry.working_directory = normalize_optional_string(entry.working_directory);
            entry
        })
        .collect()
}

pub fn deserialize_app_launcher_entries(value: serde_json::Value) -> Vec<AppLauncherEntry> {
    serde_json::from_value::<Vec<AppLauncherEntry>>(value)
        .map(normalize_app_launcher_entries)
        .unwrap_or_default()
}

pub fn scope_matches(scope: AppLauncherScope, steamvr_running: bool) -> bool {
    match scope {
        AppLauncherScope::All => true,
        AppLauncherScope::Desktop => !steamvr_running,
        AppLauncherScope::Vr => steamvr_running,
    }
}

pub fn steam_launch_url(app_id: &str) -> Option<String> {
    let app_id = app_id.trim();
    if app_id.is_empty() {
        None
    } else {
        Some(format!("steam://launch/{app_id}"))
    }
}

pub fn split_command_line_args(input: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut in_quotes = false;
    let mut started = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                started = true;
            }
            '\\' if matches!(chars.peek(), Some('"') | Some('\\')) => {
                if let Some(next) = chars.next() {
                    current.push(next);
                    started = true;
                }
            }
            ch if ch.is_whitespace() && !in_quotes => {
                if started {
                    args.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            ch => {
                current.push(ch);
                started = true;
            }
        }
    }

    if in_quotes {
        return Err("unterminated quoted argument".to_string());
    }
    if started {
        args.push(current);
    }
    Ok(args)
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn display_name_for_target(target: &str) -> String {
    Path::new(target)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "App".to_string())
}

pub(super) fn display_name_for_path(path: &Path) -> String {
    path.file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "App".to_string())
}

pub(super) fn path_extension_eq(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

pub(super) fn is_windows_executable_path(path: &Path) -> bool {
    path_extension_eq(path, "exe")
}
