use super::*;

const UNTRACKED_CLOSE_PROCESS_DENYLIST: &[&str] = &["steam", "steam.sh"];

pub(super) fn launch_entry(run: &mut AppLauncherRun, entry: &AppLauncherEntry) {
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
    let mut sys = System::new();
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
    !normalized.is_empty() && !UNTRACKED_CLOSE_PROCESS_DENYLIST.contains(&normalized.as_str())
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

pub(super) fn now_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}
