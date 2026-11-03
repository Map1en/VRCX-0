use super::{
    is_windows_executable_path, split_command_line_args, steam_launch_url, AppLauncherEntry,
    AppLauncherEntryKind, AppLauncherRun, AppLauncherRunPolicy, AppLauncherRunStatus,
    AppLauncherStopPolicy, Command, HashSet, Inner, Path, Pid, ProcessesToUpdate, System,
    SystemTime, UNIX_EPOCH,
};

const UNTRACKED_CLOSE_PROCESS_DENYLIST: &[&str] = &["steam", "steam.sh"];

const PROTECTED_PROCESS_NAMES: &[&str] = &[
    "csrss",
    "ctfmon",
    "dwm",
    "explorer",
    "fontdrvhost",
    "lsass",
    "logonui",
    "runtimebroker",
    "searchhost",
    "services",
    "shellexperiencehost",
    "sihost",
    "smss",
    "startmenuexperiencehost",
    "svchost",
    "system",
    "taskhostw",
    "textinputhost",
    "userinit",
    "wininit",
    "winlogon",
];

const PROTECTED_PROCESS_IDS: &[u32] = &[0, 4];

#[cfg(any(windows, test))]
const SHELL_LAUNCH_REUSE_SLACK_SECONDS: u64 = 2;

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ShellExecuteVerb {
    Open,
    RunAs,
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum LocalLaunchStrategy {
    Direct,
    ShellExecute(ShellExecuteVerb),
}

#[derive(Debug)]
pub(super) struct LaunchFailure {
    message: String,
    pub(super) os_error_code: Option<i32>,
}

impl LaunchFailure {
    fn message(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            os_error_code: None,
        }
    }

    pub(super) fn from_io(target: &str, error: std::io::Error) -> Self {
        Self {
            message: format!("failed to launch {target}: {error}"),
            os_error_code: error.raw_os_error(),
        }
    }
}

#[cfg(any(windows, test))]
pub(super) fn local_launch_strategy(
    entry: &AppLauncherEntry,
    windows: bool,
) -> LocalLaunchStrategy {
    if !windows {
        return LocalLaunchStrategy::Direct;
    }
    if entry.run_as_administrator {
        return LocalLaunchStrategy::ShellExecute(ShellExecuteVerb::RunAs);
    }
    if is_windows_executable_path(Path::new(&entry.target)) {
        LocalLaunchStrategy::Direct
    } else {
        LocalLaunchStrategy::ShellExecute(ShellExecuteVerb::Open)
    }
}

pub(super) fn launch_entry(run: &mut AppLauncherRun, entry: &AppLauncherEntry) {
    run.started_at = Some(now_timestamp());
    run.finished_at = None;
    run.error = None;
    run.os_error_code = None;
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
                run.error = Some(error.message);
                run.os_error_code = error.os_error_code;
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
                run.error = Some(error.message);
                run.os_error_code = error.os_error_code;
            }
        },
    }
}

#[cfg(not(windows))]
fn start_local_app(entry: &AppLauncherEntry) -> Result<Option<u32>, LaunchFailure> {
    let target = entry.target.trim();
    if target.is_empty() {
        return Err(LaunchFailure::message("target is empty"));
    }

    let args = split_command_line_args(&entry.args).map_err(LaunchFailure::message)?;
    let mut command = Command::new(target);
    command.args(args);
    if let Some(working_directory) = entry.working_directory.as_deref() {
        command.current_dir(working_directory);
    }

    command
        .spawn()
        .map(|child| Some(child.id()))
        .map_err(|error| LaunchFailure::from_io(target, error))
}

#[cfg(windows)]
fn start_local_app(entry: &AppLauncherEntry) -> Result<Option<u32>, LaunchFailure> {
    let target = entry.target.trim();
    if target.is_empty() {
        return Err(LaunchFailure::message("target is empty"));
    }

    match local_launch_strategy(entry, true) {
        LocalLaunchStrategy::Direct => {
            let args = split_command_line_args(&entry.args).map_err(LaunchFailure::message)?;
            let mut command = Command::new(target);
            command.args(args);
            if let Some(working_directory) = entry.working_directory.as_deref() {
                command.current_dir(working_directory);
            }

            command
                .spawn()
                .map(|child| Some(child.id()))
                .map_err(|error| LaunchFailure::from_io(target, error))
        }
        LocalLaunchStrategy::ShellExecute(verb) => shell_execute_local_app(
            target,
            &entry.args,
            entry.working_directory.as_deref(),
            verb,
        ),
    }
}

#[cfg(windows)]
fn shell_execute_local_app(
    target: &str,
    args: &str,
    working_directory: Option<&str>,
    verb: ShellExecuteVerb,
) -> Result<Option<u32>, LaunchFailure> {
    use std::ptr;

    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::GetProcessId;
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let target_wide = wide_null(target);
    let verb_wide = match verb {
        ShellExecuteVerb::Open => None,
        ShellExecuteVerb::RunAs => Some(wide_null("runas")),
    };
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
        lpVerb: verb_wide
            .as_ref()
            .map_or(ptr::null(), |value| value.as_ptr()),
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

    let launched_at = now_timestamp();
    let launched = unsafe { ShellExecuteExW(&mut info) };
    if launched == 0 {
        return Err(LaunchFailure::from_io(
            target,
            std::io::Error::last_os_error(),
        ));
    }

    if info.hProcess.is_null() {
        return Ok(None);
    }

    let pid = unsafe { GetProcessId(info.hProcess) };
    let pid_error = std::io::Error::last_os_error();
    unsafe {
        CloseHandle(info.hProcess);
    }
    let tracked = tracked_shell_process_id(target, pid, pid_error)?;
    Ok(tracked.filter(|pid| shell_launch_is_trackable(*pid, launched_at)))
}

#[cfg(any(windows, test))]
pub(super) fn tracked_shell_process_id(
    target: &str,
    pid: u32,
    error: std::io::Error,
) -> Result<Option<u32>, LaunchFailure> {
    if pid == 0 {
        Err(LaunchFailure::from_io(target, error))
    } else {
        Ok(Some(pid))
    }
}

#[cfg(windows)]
fn shell_launch_is_trackable(pid: u32, launched_at: u64) -> bool {
    let mut sys = System::new().expect("sysinfo supports this platform");
    sys.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    let Some(process) = sys.process(Pid::from_u32(pid)) else {
        return false;
    };
    shell_launch_pid_is_trackable(
        &process.name().to_string_lossy(),
        process.start_time(),
        launched_at,
    )
}

#[cfg(any(windows, test))]
pub(super) fn shell_launch_pid_is_trackable(
    process_name: &str,
    process_start_time: u64,
    launched_at: u64,
) -> bool {
    !is_protected_process_name(process_name)
        && process_start_time.saturating_add(SHELL_LAUNCH_REUSE_SLACK_SECONDS) >= launched_at
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn start_steam_app(app_id: &str) -> Result<(), LaunchFailure> {
    let Some(url) = steam_launch_url(app_id) else {
        return Err(LaunchFailure::message("Steam app ID is empty"));
    };
    open::that(&url)
        .map_err(|error| LaunchFailure::message(format!("failed to launch {url}: {error}")))
}

pub(super) fn should_skip_entry(
    entry: &AppLauncherEntry,
    process_running: impl Fn(&str) -> bool,
) -> bool {
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
    let mut sys = System::new().expect("sysinfo supports this platform");
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .values()
        .any(|process| normalize_process_name(&process.name().to_string_lossy()) == expected)
}

pub(super) fn refresh_runs(inner: &mut Inner) {
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
    if run.root_pid.is_none() && run.tracked_pids.is_empty() {
        return;
    }
    if !matches!(run.status, AppLauncherRunStatus::Running) {
        return;
    }

    let mut sys = System::new().expect("sysinfo supports this platform");
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

pub(super) fn stop_close_by_vrcx_session(inner: &mut Inner) {
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

pub(super) fn stop_tracked_run(run: &mut AppLauncherRun) {
    refresh_run_tracking(run);
    let pids = tracked_stop_pids(run);
    if pids.is_empty() {
        run.status = AppLauncherRunStatus::Stopped;
        run.finished_at = Some(now_timestamp());
        return;
    }

    let mut sys = System::new().expect("sysinfo supports this platform");
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut all_pids = Vec::new();
    for pid in pids {
        all_pids.extend(find_child_pids_recursive(&sys, pid));
        all_pids.push(pid);
    }
    let mut seen_pids = HashSet::new();
    all_pids.retain(|pid| seen_pids.insert(*pid));

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

    finish_stop_attempt(run, &failed_pids);
}

pub(super) fn finish_stop_attempt(run: &mut AppLauncherRun, failed_pids: &[u32]) {
    if !failed_pids.is_empty() {
        let mut remaining_pids = failed_pids.to_vec();
        remaining_pids.sort_unstable();
        remaining_pids.dedup();
        run.root_pid = run.root_pid.filter(|pid| remaining_pids.contains(pid));
        run.tracked_pids = remaining_pids;
        run.status = AppLauncherRunStatus::Running;
        run.finished_at = None;
        run.error = Some(format!(
            "failed to stop process IDs: {}",
            run.tracked_pids
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ));
        return;
    }
    run.status = AppLauncherRunStatus::Stopped;
    run.finished_at = Some(now_timestamp());
    run.tracked_pids.clear();
    run.error = None;
}

pub(super) fn tracked_stop_pids(run: &AppLauncherRun) -> Vec<u32> {
    let mut pids: HashSet<u32> = run.tracked_pids.iter().copied().collect();
    if let Some(root_pid) = run.root_pid {
        pids.insert(root_pid);
    }
    let mut pids: Vec<u32> = pids.into_iter().collect();
    pids.sort_unstable();
    pids
}

pub(super) fn process_name_for_run(run: &AppLauncherRun) -> Option<String> {
    if !matches!(run.kind, AppLauncherEntryKind::LocalApp) {
        return None;
    }
    process_name_from_target_for_platform(&run.target, cfg!(windows))
}

pub(super) fn process_name_from_target_for_platform(target: &str, windows: bool) -> Option<String> {
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

pub(super) fn normalized_process_path_for_platform(path: &str, windows: bool) -> String {
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
    !normalized.is_empty()
        && !UNTRACKED_CLOSE_PROCESS_DENYLIST.contains(&normalized.as_str())
        && !is_protected_process_name(&normalized)
}

pub(super) fn is_protected_process_name(process_name: &str) -> bool {
    let normalized = normalize_process_name(process_name);
    normalized.is_empty() || PROTECTED_PROCESS_NAMES.contains(&normalized.as_str())
}

pub(super) fn should_close_untracked_matching_processes(
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
    if PROTECTED_PROCESS_IDS.contains(&pid) {
        missing_pids.push(pid);
        return;
    }
    if let Some(process) = sys.process(Pid::from_u32(pid)) {
        if is_protected_process_name(&process.name().to_string_lossy()) {
            missing_pids.push(pid);
            return;
        }
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
    let Some(parent_start_time) = sys
        .process(Pid::from_u32(parent_pid))
        .map(sysinfo::Process::start_time)
    else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for (pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            if parent.as_u32() == parent_pid
                && child_start_time_matches_parent(process.start_time(), parent_start_time)
            {
                let child = pid.as_u32();
                result.push(child);
                result.extend(find_child_pids_recursive(sys, child));
            }
        }
    }
    result
}

pub(super) fn child_start_time_matches_parent(
    child_start_time: u64,
    parent_start_time: u64,
) -> bool {
    child_start_time >= parent_start_time
}

pub(super) fn now_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}
