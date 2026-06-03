use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, System};

pub const APP_LAUNCHER_ENABLED_CONFIG_KEY: &str = "VRCX_appLauncherEnabledV2";
pub const APP_LAUNCHER_ENTRIES_CONFIG_KEY: &str = "VRCX_appLauncherEntriesV2";
const UNTRACKED_CLOSE_PROCESS_DENYLIST: &[&str] = &["steam", "steam.sh"];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherEntryKind {
    LocalApp,
    SteamApp,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherScope {
    All,
    Desktop,
    Vr,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherRunPolicy {
    Always,
    SkipIfRunning,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherStopPolicy {
    KeepRunning,
    CloseByVrcx,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherRunStatus {
    Waiting,
    Running,
    Skipped,
    Failed,
    Stopped,
    Completed,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
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
    entry_signature: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherSession {
    pub id: String,
    pub steamvr_running: bool,
    pub started_at: u64,
    pub runs: Vec<AppLauncherRun>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherSnapshot {
    pub enabled: bool,
    pub entries: Vec<AppLauncherEntry>,
    pub active_session: Option<AppLauncherSession>,
    pub test_runs: Vec<AppLauncherRun>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherPickedTarget {
    pub kind: AppLauncherEntryKind,
    pub name: String,
    pub target: String,
    pub process_name: Option<String>,
    pub working_directory: Option<String>,
}

pub struct AutoAppLaunchManager {
    inner: Arc<Mutex<Inner>>,
}

impl Clone for AutoAppLaunchManager {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

struct Inner {
    enabled: bool,
    entries: Vec<AppLauncherEntry>,
    active_session: Option<AppLauncherSession>,
    test_runs: Vec<AppLauncherRun>,
    generation: u64,
    next_id: u64,
}

impl AutoAppLaunchManager {
    pub fn new(enabled: bool, entries: Vec<AppLauncherEntry>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                enabled,
                entries: normalize_app_launcher_entries(entries),
                active_session: None,
                test_runs: Vec::new(),
                generation: 0,
                next_id: 0,
            })),
        }
    }

    pub fn snapshot(&self) -> AppLauncherSnapshot {
        let mut inner = self.inner.lock().unwrap();
        refresh_runs(&mut inner);
        inner.snapshot()
    }

    pub fn set_enabled(&self, enabled: bool) -> AppLauncherSnapshot {
        let mut delayed = Vec::new();
        let snapshot = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            inner.enabled = enabled;
            if enabled {
                reconcile_active_session_entries(&mut inner, self, &mut delayed);
            } else if let Some(session) = inner.active_session.as_mut() {
                session.runs.clear();
            }
            refresh_runs(&mut inner);
            inner.snapshot()
        };
        spawn_delayed_launches(delayed);
        snapshot
    }

    pub fn set_entries(&self, entries: Vec<AppLauncherEntry>) -> AppLauncherSnapshot {
        let mut delayed = Vec::new();
        let snapshot = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            inner.entries = normalize_app_launcher_entries(entries);
            reconcile_active_session_entries(&mut inner, self, &mut delayed);
            refresh_runs(&mut inner);
            inner.snapshot()
        };
        spawn_delayed_launches(delayed);
        snapshot
    }

    pub fn on_game_started(&self, is_steamvr_running: bool) {
        let mut delayed = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();
            inner.generation = inner.generation.saturating_add(1);
            let generation = inner.generation;
            let session_id = inner.next_prefixed_id("session");
            let started_at = now_timestamp();
            if !inner.enabled {
                inner.active_session = Some(AppLauncherSession {
                    id: session_id,
                    steamvr_running: is_steamvr_running,
                    started_at,
                    runs: Vec::new(),
                });
                return;
            }

            stop_close_by_vrcx_session(&mut inner);

            let entries: Vec<AppLauncherEntry> = inner
                .entries
                .iter()
                .filter(|entry| entry.enabled && scope_matches(entry.scope, is_steamvr_running))
                .cloned()
                .collect();

            inner.active_session = Some(AppLauncherSession {
                id: session_id.clone(),
                steamvr_running: is_steamvr_running,
                started_at,
                runs: Vec::new(),
            });

            for entry in entries {
                schedule_session_entry(
                    &mut inner,
                    self,
                    &mut delayed,
                    &session_id,
                    generation,
                    entry,
                );
            }
        }

        spawn_delayed_launches(delayed);
    }

    pub fn on_game_stopped(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.generation = inner.generation.saturating_add(1);
        stop_close_by_vrcx_session(&mut inner);
        inner.active_session = None;
    }

    pub fn on_steamvr_changed(&self, is_steamvr_running: bool) {
        let mut delayed = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();
            let needs_reconcile = inner
                .active_session
                .as_ref()
                .is_some_and(|session| session.steamvr_running != is_steamvr_running);
            if !needs_reconcile {
                return;
            }
            inner.generation = inner.generation.saturating_add(1);
            if let Some(session) = inner.active_session.as_mut() {
                session.steamvr_running = is_steamvr_running;
            }
            reconcile_active_session_entries(&mut inner, self, &mut delayed);
            refresh_runs(&mut inner);
        }
        spawn_delayed_launches(delayed);
    }

    pub fn test_entry(&self, entry_id: &str) -> Result<AppLauncherSnapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let Some(entry) = inner
            .entries
            .iter()
            .find(|entry| entry.id == entry_id)
            .cloned()
        else {
            return Err(format!("VRChat Startup Apps entry not found: {entry_id}"));
        };

        let run_id = inner.next_prefixed_id("test");
        let mut run = new_run(&run_id, &entry, true);
        launch_entry(&mut run, &entry);
        inner.test_runs.push(run);
        refresh_runs(&mut inner);
        Ok(inner.snapshot())
    }

    pub fn stop_test_run(&self, run_id: &str) -> Result<AppLauncherSnapshot, String> {
        let mut inner = self.inner.lock().unwrap();
        let Some(run) = inner.test_runs.iter_mut().find(|run| run.id == run_id) else {
            return Err(format!("VRChat Startup Apps test run not found: {run_id}"));
        };
        stop_tracked_run(run);
        refresh_runs(&mut inner);
        Ok(inner.snapshot())
    }

    fn launch_delayed_session_entry(
        &self,
        session_id: &str,
        run_id: &str,
        entry: AppLauncherEntry,
        generation: u64,
    ) {
        let mut inner = self.inner.lock().unwrap();
        if inner.generation != generation {
            return;
        }
        let Some(session) = inner.active_session.as_ref() else {
            return;
        };
        if session.id != session_id {
            return;
        }
        let Some(run) = find_session_run_mut(&mut inner, run_id) else {
            return;
        };
        launch_entry(run, &entry);
    }
}

struct DelayedLaunch {
    manager: AutoAppLaunchManager,
    session_id: String,
    run_id: String,
    entry: AppLauncherEntry,
    generation: u64,
    delay_seconds: u32,
}

fn spawn_delayed_launches(delayed: Vec<DelayedLaunch>) {
    for launch in delayed {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(u64::from(launch.delay_seconds)));
            launch.manager.launch_delayed_session_entry(
                &launch.session_id,
                &launch.run_id,
                launch.entry,
                launch.generation,
            );
        });
    }
}

fn schedule_session_entry(
    inner: &mut Inner,
    manager: &AutoAppLaunchManager,
    delayed: &mut Vec<DelayedLaunch>,
    session_id: &str,
    generation: u64,
    entry: AppLauncherEntry,
) {
    let run_id = inner.next_prefixed_id("run");
    let delay = entry.launch_delay_seconds;
    push_session_run(inner, new_run(&run_id, &entry, false));
    if delay == 0 {
        if let Some(run) = find_session_run_mut(inner, &run_id) {
            launch_entry(run, &entry);
        }
    } else if let Some(run) = find_session_run_mut(inner, &run_id) {
        run.status = AppLauncherRunStatus::Waiting;
        delayed.push(DelayedLaunch {
            manager: manager.clone(),
            session_id: session_id.to_string(),
            run_id,
            entry,
            generation,
            delay_seconds: delay,
        });
    }
}

fn reconcile_active_session_entries(
    inner: &mut Inner,
    manager: &AutoAppLaunchManager,
    delayed: &mut Vec<DelayedLaunch>,
) {
    if !inner.enabled {
        if let Some(session) = inner.active_session.as_mut() {
            session.runs.clear();
        }
        return;
    }
    let Some(session) = inner.active_session.as_ref() else {
        return;
    };
    let steamvr_running = session.steamvr_running;
    let session_id = session.id.clone();
    let generation = inner.generation;
    let desired_entries: Vec<AppLauncherEntry> = inner
        .entries
        .iter()
        .filter(|entry| entry.enabled && scope_matches(entry.scope, steamvr_running))
        .cloned()
        .collect();

    if let Some(session) = inner.active_session.as_mut() {
        session.runs.retain_mut(|run| {
            let Some(entry) = desired_entries
                .iter()
                .find(|entry| entry.id == run.entry_id)
            else {
                return false;
            };
            if matches!(run.status, AppLauncherRunStatus::Waiting) {
                return false;
            }
            if run.entry_signature != entry_signature(entry) {
                return false;
            }
            run.entry_name = entry.name.clone();
            run.stop_policy = entry.stop_policy.clone();
            true
        });
    }

    let active_entry_ids: HashSet<String> = inner
        .active_session
        .as_ref()
        .map(|session| {
            session
                .runs
                .iter()
                .map(|run| run.entry_id.clone())
                .collect()
        })
        .unwrap_or_default();

    for entry in desired_entries {
        if !active_entry_ids.contains(&entry.id) {
            schedule_session_entry(inner, manager, delayed, &session_id, generation, entry);
        }
    }
}

impl Inner {
    fn next_prefixed_id(&mut self, prefix: &str) -> String {
        self.next_id = self.next_id.saturating_add(1);
        format!("{prefix}-{}-{}", now_timestamp(), self.next_id)
    }

    fn snapshot(&self) -> AppLauncherSnapshot {
        AppLauncherSnapshot {
            enabled: self.enabled,
            entries: self.entries.clone(),
            active_session: self.active_session.clone(),
            test_runs: self.test_runs.clone(),
        }
    }
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

fn display_name_for_path(path: &Path) -> String {
    path.file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "App".to_string())
}

fn path_extension_eq(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

fn is_windows_executable_path(path: &Path) -> bool {
    path_extension_eq(path, "exe")
}

fn new_run(id: &str, entry: &AppLauncherEntry, test: bool) -> AppLauncherRun {
    AppLauncherRun {
        id: id.to_string(),
        entry_id: entry.id.clone(),
        entry_name: entry.name.clone(),
        kind: entry.kind.clone(),
        target: entry.target.clone(),
        status: AppLauncherRunStatus::Waiting,
        stop_policy: entry.stop_policy.clone(),
        test,
        root_pid: None,
        tracked_pids: Vec::new(),
        started_at: None,
        finished_at: None,
        error: None,
        skipped_reason: None,
        entry_signature: entry_signature(entry),
    }
}

fn entry_signature(entry: &AppLauncherEntry) -> String {
    format!(
        "{:?}\u{1f}{}\u{1f}{}\u{1f}{}",
        entry.kind,
        entry.target,
        entry.args,
        entry.working_directory.as_deref().unwrap_or_default()
    )
}

fn push_session_run(inner: &mut Inner, run: AppLauncherRun) {
    if let Some(session) = inner.active_session.as_mut() {
        session.runs.push(run);
    }
}

fn find_session_run_mut<'a>(inner: &'a mut Inner, run_id: &str) -> Option<&'a mut AppLauncherRun> {
    inner
        .active_session
        .as_mut()?
        .runs
        .iter_mut()
        .find(|run| run.id == run_id)
}

fn launch_entry(run: &mut AppLauncherRun, entry: &AppLauncherEntry) {
    run.started_at = Some(now_timestamp());
    run.finished_at = None;
    run.error = None;
    run.skipped_reason = None;

    if should_skip_entry(entry, is_process_name_running) {
        run.status = AppLauncherRunStatus::Skipped;
        run.finished_at = Some(now_timestamp());
        run.skipped_reason =
            process_name_for_entry(entry).map(|name| format!("{name} is already running"));
        return;
    }

    match entry.kind {
        AppLauncherEntryKind::LocalApp => match start_local_app(entry) {
            Ok(Some(pid)) => {
                run.status = AppLauncherRunStatus::Running;
                run.root_pid = Some(pid);
                run.tracked_pids = vec![pid];
            }
            Ok(None) => {
                run.status = AppLauncherRunStatus::Completed;
                run.finished_at = Some(now_timestamp());
            }
            Err(error) => {
                run.status = AppLauncherRunStatus::Failed;
                run.finished_at = Some(now_timestamp());
                run.error = Some(error);
            }
        },
        AppLauncherEntryKind::SteamApp => match start_steam_app(&entry.target) {
            Ok(()) => {
                run.status = AppLauncherRunStatus::Completed;
                run.finished_at = Some(now_timestamp());
            }
            Err(error) => {
                run.status = AppLauncherRunStatus::Failed;
                run.finished_at = Some(now_timestamp());
                run.error = Some(error);
            }
        },
    }
}

#[cfg(not(windows))]
fn start_local_app(entry: &AppLauncherEntry) -> Result<Option<u32>, String> {
    let target = entry.target.trim();
    if target.is_empty() {
        return Err("target is empty".to_string());
    }

    let args = split_command_line_args(&entry.args)?;
    let mut command = Command::new(target);
    command.args(args);
    if let Some(working_directory) = entry.working_directory.as_deref() {
        command.current_dir(working_directory);
    }

    command
        .spawn()
        .map(|child| Some(child.id()))
        .map_err(|error| format!("failed to launch {target}: {error}"))
}

#[cfg(windows)]
fn start_local_app(entry: &AppLauncherEntry) -> Result<Option<u32>, String> {
    let target = entry.target.trim();
    if target.is_empty() {
        return Err("target is empty".to_string());
    }

    if is_windows_executable_path(Path::new(target)) {
        let args = split_command_line_args(&entry.args)?;
        let mut command = Command::new(target);
        command.args(args);
        if let Some(working_directory) = entry.working_directory.as_deref() {
            command.current_dir(working_directory);
        }

        return command
            .spawn()
            .map(|child| Some(child.id()))
            .map_err(|error| format!("failed to launch {target}: {error}"));
    }

    shell_execute_local_app(target, &entry.args, entry.working_directory.as_deref())
}

#[cfg(windows)]
fn shell_execute_local_app(
    target: &str,
    args: &str,
    working_directory: Option<&str>,
) -> Result<Option<u32>, String> {
    use std::ptr;

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::GetProcessId;
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let target_wide = wide_null(target);
    let args = args.trim();
    let args_wide = if args.is_empty() {
        None
    } else {
        Some(wide_null(args))
    };
    let directory_wide = working_directory
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(wide_null);

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        hwnd: ptr::null_mut(),
        lpVerb: ptr::null(),
        lpFile: target_wide.as_ptr(),
        lpParameters: args_wide
            .as_ref()
            .map_or(ptr::null(), |value| value.as_ptr()),
        lpDirectory: directory_wide
            .as_ref()
            .map_or(ptr::null(), |value| value.as_ptr()),
        nShow: SW_SHOWNORMAL,
        hInstApp: std::ptr::null_mut(),
        lpIDList: ptr::null_mut(),
        lpClass: ptr::null(),
        hkeyClass: std::ptr::null_mut(),
        dwHotKey: 0,
        Anonymous: Default::default(),
        hProcess: std::ptr::null_mut(),
    };

    let launched = unsafe { ShellExecuteExW(&mut info) };
    if launched == 0 {
        return Err(format!(
            "failed to launch {target}: {}",
            std::io::Error::last_os_error()
        ));
    }

    if info.hProcess.is_null() {
        return Ok(None);
    }

    let pid = unsafe { GetProcessId(info.hProcess) };
    unsafe {
        CloseHandle(info.hProcess);
    }
    if pid == 0 {
        Ok(None)
    } else {
        Ok(Some(pid))
    }
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn start_steam_app(app_id: &str) -> Result<(), String> {
    let Some(url) = steam_launch_url(app_id) else {
        return Err("Steam app ID is empty".to_string());
    };
    open::that(&url).map_err(|error| format!("failed to launch {url}: {error}"))
}

fn should_skip_entry(entry: &AppLauncherEntry, process_running: impl Fn(&str) -> bool) -> bool {
    if !matches!(entry.run_policy, AppLauncherRunPolicy::SkipIfRunning) {
        return false;
    }
    let Some(process_name) = process_name_for_entry(entry) else {
        return false;
    };
    process_running(&process_name)
}

fn process_name_for_entry(entry: &AppLauncherEntry) -> Option<String> {
    if let Some(process_name) = entry.process_name.as_deref() {
        let normalized = normalize_process_name(process_name);
        if !normalized.is_empty() {
            return Some(normalized);
        }
    }

    if matches!(entry.kind, AppLauncherEntryKind::LocalApp) {
        let target = Path::new(&entry.target);
        if is_windows_executable_path(target) {
            return target
                .file_stem()
                .map(|value| normalize_process_name(&value.to_string_lossy()))
                .filter(|value| !value.is_empty());
        }
    }
    None
}

fn normalize_process_name(name: &str) -> String {
    let name = name.trim().to_ascii_lowercase();
    name.strip_suffix(".exe").unwrap_or(&name).to_string()
}

fn is_process_name_running(name: &str) -> bool {
    let expected = normalize_process_name(name);
    if expected.is_empty() {
        return false;
    }
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .values()
        .any(|process| normalize_process_name(&process.name().to_string_lossy()) == expected)
}

fn refresh_runs(inner: &mut Inner) {
    if let Some(session) = inner.active_session.as_mut() {
        for run in &mut session.runs {
            refresh_run_tracking(run);
        }
    }
    for run in &mut inner.test_runs {
        refresh_run_tracking(run);
    }
    inner.test_runs.retain(|run| {
        !matches!(
            run.status,
            AppLauncherRunStatus::Completed
                | AppLauncherRunStatus::Failed
                | AppLauncherRunStatus::Skipped
                | AppLauncherRunStatus::Stopped
        ) || run
            .finished_at
            .is_none_or(|finished| now_timestamp().saturating_sub(finished) < 300)
    });
}

fn refresh_run_tracking(run: &mut AppLauncherRun) {
    if run.root_pid.is_none() || run.tracked_pids.is_empty() {
        return;
    }
    if !matches!(run.status, AppLauncherRunStatus::Running) {
        return;
    }

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut pids: HashSet<u32> = run.tracked_pids.iter().copied().collect();
    if let Some(root_pid) = run.root_pid {
        pids.insert(root_pid);
    }
    let snapshot: Vec<u32> = pids.iter().copied().collect();
    for pid in snapshot {
        for child in find_child_pids_recursive(&sys, pid) {
            pids.insert(child);
        }
    }
    pids.retain(|pid| sys.process(Pid::from_u32(*pid)).is_some());
    let mut sorted: Vec<u32> = pids.into_iter().collect();
    sorted.sort_unstable();
    run.tracked_pids = sorted;

    if run.tracked_pids.is_empty() {
        run.status = AppLauncherRunStatus::Completed;
        run.finished_at = Some(now_timestamp());
    }
}

fn stop_close_by_vrcx_session(inner: &mut Inner) {
    let Some(session) = inner.active_session.as_mut() else {
        return;
    };
    for run in &mut session.runs {
        if matches!(run.stop_policy, AppLauncherStopPolicy::CloseByVrcx) {
            stop_tracked_run(run);
        } else {
            refresh_run_tracking(run);
        }
    }
}

fn stop_tracked_run(run: &mut AppLauncherRun) {
    refresh_run_tracking(run);
    let pids = tracked_stop_pids(run);
    if pids.is_empty() {
        run.status = AppLauncherRunStatus::Stopped;
        run.finished_at = Some(now_timestamp());
        return;
    }

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut all_pids = Vec::new();
    for pid in pids {
        all_pids.extend(find_child_pids_recursive(&sys, pid));
        all_pids.push(pid);
    }
    all_pids.sort_unstable();
    all_pids.dedup();

    let untracked_matching_pids = process_pids_by_run_target(&sys, run)
        .into_iter()
        .filter(|pid| !all_pids.contains(pid))
        .collect::<Vec<_>>();
    let mut killed_pids = Vec::new();
    let mut failed_pids = Vec::new();
    let mut missing_pids = Vec::new();
    for pid in all_pids.iter().copied().rev() {
        kill_process_by_pid(
            &sys,
            pid,
            &mut killed_pids,
            &mut failed_pids,
            &mut missing_pids,
        );
    }

    let close_untracked_matching_pids = should_close_untracked_matching_processes(
        process_name_for_run(run).as_deref(),
        &killed_pids,
        &failed_pids,
    );
    if close_untracked_matching_pids {
        for pid in untracked_matching_pids.iter().copied().rev() {
            kill_process_by_pid(
                &sys,
                pid,
                &mut killed_pids,
                &mut failed_pids,
                &mut missing_pids,
            );
        }
    }

    run.status = AppLauncherRunStatus::Stopped;
    run.finished_at = Some(now_timestamp());
    run.tracked_pids.clear();
}

fn tracked_stop_pids(run: &AppLauncherRun) -> Vec<u32> {
    let mut pids: HashSet<u32> = run.tracked_pids.iter().copied().collect();
    if let Some(root_pid) = run.root_pid {
        pids.insert(root_pid);
    }
    let mut pids: Vec<u32> = pids.into_iter().collect();
    pids.sort_unstable();
    pids
}

fn process_name_for_run(run: &AppLauncherRun) -> Option<String> {
    if !matches!(run.kind, AppLauncherEntryKind::LocalApp) {
        return None;
    }
    process_name_from_target_for_platform(&run.target, cfg!(windows))
}

fn process_name_from_target_for_platform(target: &str, windows: bool) -> Option<String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return None;
    }
    let file_name = if windows {
        trimmed
            .trim_start_matches(r"\\?\")
            .rsplit(['\\', '/'])
            .next()
    } else {
        Path::new(trimmed)
            .file_name()
            .and_then(|value| value.to_str())
    }?;
    let process_name = normalize_process_name(file_name);
    (!process_name.is_empty()).then_some(process_name)
}

fn process_pids_by_run_target(sys: &System, run: &AppLauncherRun) -> Vec<u32> {
    let Some(expected_name) = process_name_for_run(run) else {
        return Vec::new();
    };
    let mut pids = sys
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            (normalize_process_name(&process.name().to_string_lossy()) == expected_name
                && process
                    .exe()
                    .and_then(|path| path.to_str())
                    .is_some_and(|path| process_exe_matches_run_target(path, run)))
            .then_some(pid.as_u32())
        })
        .collect::<Vec<_>>();
    pids.sort_unstable();
    pids
}

fn normalized_process_path(path: &str) -> String {
    #[cfg(windows)]
    {
        normalized_process_path_for_platform(path, true)
    }
    #[cfg(not(windows))]
    {
        normalized_process_path_for_platform(path, false)
    }
}

fn normalized_process_path_for_platform(path: &str, windows: bool) -> String {
    let normalized = path.trim().trim_start_matches(r"\\?\");
    if windows {
        normalized.replace('/', "\\").to_ascii_lowercase()
    } else {
        normalized.to_string()
    }
}

fn process_exe_matches_run_target(process_exe: &str, run: &AppLauncherRun) -> bool {
    normalized_process_path(process_exe) == normalized_process_path(&run.target)
}

fn should_close_untracked_process_name(process_name: &str) -> bool {
    let normalized = normalize_process_name(process_name);
    !normalized.is_empty() && !UNTRACKED_CLOSE_PROCESS_DENYLIST.contains(&normalized.as_str())
}

fn should_close_untracked_matching_processes(
    process_name: Option<&str>,
    killed_pids: &[u32],
    failed_pids: &[u32],
) -> bool {
    killed_pids.is_empty()
        && failed_pids.is_empty()
        && process_name.is_some_and(should_close_untracked_process_name)
}

fn kill_process_by_pid(
    sys: &System,
    pid: u32,
    killed_pids: &mut Vec<u32>,
    failed_pids: &mut Vec<u32>,
    missing_pids: &mut Vec<u32>,
) {
    if let Some(process) = sys.process(Pid::from_u32(pid)) {
        if process.kill() {
            killed_pids.push(pid);
        } else {
            failed_pids.push(pid);
        }
    } else {
        missing_pids.push(pid);
    }
}

fn find_child_pids_recursive(sys: &System, parent_pid: u32) -> Vec<u32> {
    let mut result = Vec::new();
    for (pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            if parent.as_u32() == parent_pid {
                let child = pid.as_u32();
                result.push(child);
                result.extend(find_child_pids_recursive(sys, child));
            }
        }
    }
    result
}

fn now_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

pub fn picked_local_target(path: impl Into<PathBuf>) -> AppLauncherPickedTarget {
    let path = path.into();
    let target = path.to_string_lossy().to_string();
    AppLauncherPickedTarget {
        kind: AppLauncherEntryKind::LocalApp,
        name: display_name_for_path(&path),
        process_name: if is_windows_executable_path(&path) {
            path.file_stem()
                .map(|value| value.to_string_lossy().to_string())
                .filter(|value| !value.trim().is_empty())
        } else {
            None
        },
        working_directory: None,
        target,
    }
}

pub fn picked_app_launcher_target(
    path: impl Into<PathBuf>,
) -> Result<AppLauncherPickedTarget, String> {
    let path = path.into();
    if path_extension_eq(&path, "url") {
        let Some(app_id) = steam_app_id_from_url_shortcut(&path)? else {
            return Err("selected URL shortcut is not a Steam app shortcut".to_string());
        };
        return Ok(AppLauncherPickedTarget {
            kind: AppLauncherEntryKind::SteamApp,
            name: display_name_for_path(&path),
            target: app_id,
            process_name: None,
            working_directory: None,
        });
    }

    Ok(picked_local_target(path))
}

fn steam_app_id_from_url_shortcut(path: &Path) -> Result<Option<String>, String> {
    let bytes = std::fs::read(path).map_err(|error| {
        format!(
            "failed to read shortcut {}: {error}",
            path.to_string_lossy()
        )
    })?;
    let content = shortcut_bytes_to_string(&bytes);
    for line in content.lines() {
        let line = line.trim();
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !key.eq_ignore_ascii_case("URL") {
            continue;
        }
        if let Some(app_id) = steam_app_id_from_url(value) {
            return Ok(Some(app_id));
        }
    }
    Ok(None)
}

fn shortcut_bytes_to_string(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).to_string();
    }
    String::from_utf8_lossy(bytes).to_string()
}

fn steam_app_id_from_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    for prefix in [
        "steam://rungameid/",
        "steam://launch/",
        "steam://run/",
        "steam://open/games/details/",
    ] {
        if !lower.starts_with(prefix) {
            continue;
        }
        let app_id: String = trimmed[prefix.len()..]
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect();
        if !app_id.is_empty() {
            return Some(app_id);
        }
    }
    None
}

#[cfg(test)]
mod app_launcher_tests {
    use super::*;

    fn local_entry(id: &str) -> AppLauncherEntry {
        AppLauncherEntry {
            id: id.to_string(),
            enabled: true,
            name: "Tool".to_string(),
            kind: AppLauncherEntryKind::LocalApp,
            scope: AppLauncherScope::All,
            target: "C:\\Tools\\Tool.exe".to_string(),
            args: String::new(),
            launch_delay_seconds: 0,
            run_policy: AppLauncherRunPolicy::Always,
            stop_policy: AppLauncherStopPolicy::KeepRunning,
            process_name: None,
            working_directory: None,
        }
    }

    #[test]
    fn app_launcher_scope_filter_matches_desktop_and_vr() {
        assert!(scope_matches(AppLauncherScope::All, false));
        assert!(scope_matches(AppLauncherScope::All, true));
        assert!(scope_matches(AppLauncherScope::Desktop, false));
        assert!(!scope_matches(AppLauncherScope::Desktop, true));
        assert!(!scope_matches(AppLauncherScope::Vr, false));
        assert!(scope_matches(AppLauncherScope::Vr, true));
    }

    #[test]
    fn app_launcher_sanitizes_steam_close_policy() {
        let mut entry = local_entry("steam");
        entry.kind = AppLauncherEntryKind::SteamApp;
        entry.target = "438100".to_string();
        entry.args = "--ignored".to_string();
        entry.working_directory = Some("C:\\Temp".to_string());
        entry.stop_policy = AppLauncherStopPolicy::CloseByVrcx;

        let entries = normalize_app_launcher_entries(vec![entry]);
        assert_eq!(entries[0].stop_policy, AppLauncherStopPolicy::KeepRunning);
        assert!(entries[0].args.is_empty());
        assert_eq!(entries[0].working_directory, None);
    }

    #[test]
    fn app_launcher_untracked_close_fallback_excludes_steam_client() {
        let mut cacher_entry = local_entry("cacher");
        cacher_entry.target = if cfg!(windows) {
            "D:\\SteamLibrary\\steamapps\\common\\VRCVideoCacher\\VRCVideoCacher.exe"
        } else {
            "/home/user/.local/share/Steam/steamapps/common/VRCVideoCacher/VRCVideoCacher"
        }
        .to_string();
        let cacher_run = new_run("run-cacher", &cacher_entry, false);

        assert_eq!(
            process_name_from_target_for_platform(
                r"D:\SteamLibrary\steamapps\common\VRCVideoCacher\VRCVideoCacher.exe",
                true
            )
            .as_deref(),
            Some("vrcvideocacher")
        );
        assert_eq!(
            process_name_for_run(&cacher_run).as_deref(),
            Some("vrcvideocacher")
        );
        assert!(should_close_untracked_matching_processes(
            process_name_for_run(&cacher_run).as_deref(),
            &[],
            &[]
        ));
        assert!(!should_close_untracked_matching_processes(
            process_name_for_run(&cacher_run).as_deref(),
            &[123],
            &[]
        ));
        assert!(!should_close_untracked_matching_processes(
            process_name_for_run(&cacher_run).as_deref(),
            &[],
            &[123]
        ));

        let mut steam_entry = local_entry("steam-local");
        steam_entry.target = if cfg!(windows) {
            "C:\\Program Files (x86)\\Steam\\steam.exe"
        } else {
            "/home/user/.local/share/Steam/steam"
        }
        .to_string();
        let steam_run = new_run("run-steam", &steam_entry, false);

        assert_eq!(
            process_name_from_target_for_platform(
                "C:\\Program Files (x86)\\Steam\\steam.exe",
                true
            )
            .as_deref(),
            Some("steam")
        );
        assert_eq!(process_name_for_run(&steam_run).as_deref(), Some("steam"));
        assert!(!should_close_untracked_matching_processes(
            process_name_for_run(&steam_run).as_deref(),
            &[],
            &[]
        ));

        assert_eq!(
            process_name_from_target_for_platform("/home/user/.local/share/Steam/steam.sh", false)
                .as_deref(),
            Some("steam.sh")
        );
        assert!(!should_close_untracked_matching_processes(
            Some("steam.sh"),
            &[],
            &[]
        ));
    }

    #[test]
    fn app_launcher_untracked_close_fallback_requires_matching_exe_path() {
        let windows_target = r"D:\SteamLibrary\steamapps\common\VRCVideoCacher\VRCVideoCacher.exe";
        assert_eq!(
            normalized_process_path_for_platform(
                r"\\?\D:/SteamLibrary/steamapps/common/VRCVideoCacher/VRCVideoCacher.exe",
                true
            ),
            normalized_process_path_for_platform(windows_target, true)
        );
        assert_eq!(
            normalized_process_path_for_platform(
                r"d:\steamlibrary\STEAMAPPS\common\VRCVideoCacher\VRCVideoCacher.exe",
                true
            ),
            normalized_process_path_for_platform(windows_target, true)
        );
        assert_ne!(
            normalized_process_path_for_platform(r"C:\Other\VRCVideoCacher.exe", true),
            normalized_process_path_for_platform(windows_target, true)
        );

        let linux_target = "/home/User/.local/share/Steam/steamapps/common/Tool/Tool.AppImage";
        assert_eq!(
            normalized_process_path_for_platform(linux_target, false),
            normalized_process_path_for_platform(linux_target, false)
        );
        assert_ne!(
            normalized_process_path_for_platform(
                "/home/user/.local/share/Steam/steamapps/common/Tool/Tool.AppImage",
                false
            ),
            normalized_process_path_for_platform(linux_target, false)
        );
    }

    #[test]
    fn app_launcher_omits_empty_args_from_serialized_entries() {
        let entry = normalize_app_launcher_entries(vec![local_entry("local")])
            .into_iter()
            .next()
            .unwrap();
        let value = serde_json::to_value(entry).unwrap();

        assert!(value.get("args").is_none());
    }

    #[test]
    fn app_launcher_normalization_makes_duplicate_ids_unique() {
        let first = local_entry("same");
        let second = local_entry("same");
        let entries = normalize_app_launcher_entries(vec![first, second]);

        assert_eq!(entries[0].id, "same");
        assert_eq!(entries[1].id, "same-1");
    }

    #[test]
    fn app_launcher_json_invalid_config_falls_back_to_empty_entries() {
        let entries = deserialize_app_launcher_entries(serde_json::json!({ "bad": true }));
        assert!(entries.is_empty());
    }

    #[test]
    fn app_launcher_json_round_trips_entries() {
        let entry = local_entry("local");
        let value = serde_json::to_value(vec![entry.clone()]).unwrap();
        assert_eq!(deserialize_app_launcher_entries(value), vec![entry]);
    }

    #[test]
    fn app_launcher_run_policy_skips_when_process_is_running() {
        let mut entry = local_entry("local");
        entry.run_policy = AppLauncherRunPolicy::SkipIfRunning;
        entry.process_name = Some("Tool.exe".to_string());

        assert!(should_skip_entry(&entry, |name| name == "tool"));
        assert!(!should_skip_entry(&entry, |name| name == "other"));
    }

    #[test]
    fn app_launcher_always_policy_does_not_skip_existing_process() {
        let entry = local_entry("local");
        assert!(!should_skip_entry(&entry, |_| true));
    }

    #[test]
    fn app_launcher_stop_policy_uses_only_tracked_pids() {
        let mut run = new_run("run", &local_entry("local"), false);
        run.root_pid = Some(42);
        run.tracked_pids = vec![10, 42, 99];
        assert_eq!(tracked_stop_pids(&run), vec![10, 42, 99]);
    }

    #[test]
    fn app_launcher_steam_url_uses_launch_scheme() {
        assert_eq!(
            steam_launch_url("438100"),
            Some("steam://launch/438100".to_string())
        );
        assert_eq!(steam_launch_url(""), None);
    }

    #[test]
    fn app_launcher_picks_steam_url_shortcut() {
        let path =
            std::env::temp_dir().join(format!("vrcx-steam-shortcut-{}.url", now_timestamp()));
        std::fs::write(&path, "[InternetShortcut]\nURL=steam://rungameid/438100\n").unwrap();

        let picked = picked_app_launcher_target(&path).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(picked.kind, AppLauncherEntryKind::SteamApp);
        assert_eq!(picked.target, "438100");
        assert_eq!(picked.process_name, None);
    }

    #[test]
    fn app_launcher_picks_local_exe_with_process_name() {
        let picked = picked_app_launcher_target("Overlay.exe").unwrap();

        assert_eq!(picked.kind, AppLauncherEntryKind::LocalApp);
        assert_eq!(picked.name, "Overlay");
        assert_eq!(picked.process_name, Some("Overlay".to_string()));
        assert_eq!(picked.working_directory, None);
    }

    #[test]
    fn app_launcher_picks_shortcut_without_guessing_process_name() {
        let picked = picked_app_launcher_target("Overlay.lnk").unwrap();

        assert_eq!(picked.kind, AppLauncherEntryKind::LocalApp);
        assert_eq!(picked.name, "Overlay");
        assert_eq!(picked.process_name, None);
        assert_eq!(picked.working_directory, None);
    }

    #[test]
    fn app_launcher_shortcut_skip_policy_requires_explicit_process_name() {
        let mut entry = local_entry("shortcut");
        entry.target = "Overlay.lnk".to_string();
        entry.run_policy = AppLauncherRunPolicy::SkipIfRunning;

        assert!(!should_skip_entry(&entry, |_| true));
    }

    #[test]
    fn app_launcher_entries_set_applies_to_active_session() {
        let manager = AutoAppLaunchManager::new(true, Vec::new());
        manager.on_game_started(false);

        let snapshot = manager.set_entries(vec![local_entry("local")]);
        assert_eq!(snapshot.active_session.unwrap().runs.len(), 1);

        let snapshot = manager.set_entries(Vec::new());
        assert!(snapshot.active_session.unwrap().runs.is_empty());
    }

    #[test]
    fn app_launcher_disabling_entry_removes_active_session_run() {
        let manager = AutoAppLaunchManager::new(true, vec![local_entry("local")]);
        manager.on_game_started(false);

        let mut disabled = local_entry("local");
        disabled.enabled = false;
        let snapshot = manager.set_entries(vec![disabled]);

        assert!(snapshot.active_session.unwrap().runs.is_empty());
    }

    #[test]
    fn app_launcher_global_disable_reenable_applies_to_active_session() {
        let manager = AutoAppLaunchManager::new(true, vec![local_entry("local")]);
        manager.on_game_started(false);

        let snapshot = manager.set_enabled(false);
        assert!(snapshot.active_session.as_ref().unwrap().runs.is_empty());

        let snapshot = manager.set_enabled(true);
        assert_eq!(snapshot.active_session.unwrap().runs.len(), 1);
    }

    #[test]
    fn app_launcher_enabling_after_disabled_game_start_applies_rules() {
        let manager = AutoAppLaunchManager::new(false, vec![local_entry("local")]);
        manager.on_game_started(false);

        let snapshot = manager.set_enabled(true);

        assert_eq!(snapshot.active_session.unwrap().runs.len(), 1);
    }

    #[test]
    fn app_launcher_steamvr_change_applies_vr_scope_to_active_session() {
        let mut desktop = local_entry("desktop");
        desktop.scope = AppLauncherScope::Desktop;
        let mut vr = local_entry("vr");
        vr.scope = AppLauncherScope::Vr;
        let manager = AutoAppLaunchManager::new(true, vec![desktop, vr]);
        manager.on_game_started(false);

        let snapshot = manager.snapshot();
        let session = snapshot.active_session.unwrap();
        assert!(!session.steamvr_running);
        assert_eq!(session.runs.len(), 1);
        assert_eq!(session.runs[0].entry_id, "desktop");

        manager.on_steamvr_changed(true);

        let snapshot = manager.snapshot();
        let session = snapshot.active_session.unwrap();
        assert!(session.steamvr_running);
        assert_eq!(session.runs.len(), 1);
        assert_eq!(session.runs[0].entry_id, "vr");
    }

    #[test]
    fn app_launcher_game_start_with_steamvr_applies_vr_scope() {
        let mut desktop = local_entry("desktop");
        desktop.scope = AppLauncherScope::Desktop;
        let mut vr = local_entry("vr");
        vr.scope = AppLauncherScope::Vr;
        let manager = AutoAppLaunchManager::new(true, vec![desktop, vr]);

        manager.on_game_started(true);

        let snapshot = manager.snapshot();
        let session = snapshot.active_session.unwrap();
        assert!(session.steamvr_running);
        assert_eq!(session.runs.len(), 1);
        assert_eq!(session.runs[0].entry_id, "vr");
    }

    #[test]
    fn app_launcher_args_split_preserves_quoted_values() {
        assert_eq!(
            split_command_line_args(r#"--flag "two words" \"literal\""#).unwrap(),
            vec!["--flag", "two words", r#""literal""#]
        );
        assert!(split_command_line_args(r#""unterminated"#).is_err());
    }
}
