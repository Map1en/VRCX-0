use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sysinfo::{Pid, ProcessesToUpdate, System};

const LNK_SIGNATURE: [u8; 4] = [0x4C, 0x00, 0x00, 0x00];

const URL_HEADER: &[u8] = b"[{000214A0-0000-0000-C000-000000000046}]";

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
    kill_on_exit: bool,
    run_process_once: bool,
    shortcut_dir: PathBuf,
    shortcut_desktop: PathBuf,
    shortcut_vr: PathBuf,
    started_processes: HashMap<String, HashSet<u32>>,
    timer_ticks: u32,
    timer_interval_ms: u64,
}

impl AutoAppLaunchManager {
    pub fn new(app_data: &Path) -> Self {
        let shortcut_dir = app_data.join("startup");
        let shortcut_desktop = shortcut_dir.join("desktop");
        let shortcut_vr = shortcut_dir.join("vr");

        let _ = fs::create_dir_all(&shortcut_dir);
        let _ = fs::create_dir_all(&shortcut_desktop);
        let _ = fs::create_dir_all(&shortcut_vr);

        let inner = Arc::new(Mutex::new(Inner {
            enabled: false,
            kill_on_exit: true,
            run_process_once: true,
            shortcut_dir,
            shortcut_desktop,
            shortcut_vr,
            started_processes: HashMap::new(),
            timer_ticks: 0,
            timer_interval_ms: 60000,
        }));

        {
            let inner_clone = Arc::clone(&inner);
            std::thread::spawn(move || loop {
                let interval = {
                    let state = inner_clone.lock().unwrap();
                    state.timer_interval_ms
                };
                std::thread::sleep(Duration::from_millis(interval));

                let mut state = inner_clone.lock().unwrap();
                update_child_processes(&mut state.started_processes);
                if state.timer_ticks < 5 {
                    state.timer_ticks += 1;
                    if state.timer_ticks == 5 {
                        state.timer_interval_ms = 60000;
                    }
                }
            });
        }

        Self { inner }
    }

    pub fn set_settings(&self, enabled: bool, kill_on_exit: bool, run_process_once: bool) {
        let mut inner = self.inner.lock().unwrap();
        inner.enabled = enabled;
        inner.kill_on_exit = kill_on_exit;
        inner.run_process_once = run_process_once;
    }

    pub fn on_game_started(&self, is_steamvr_running: bool) {
        let mut inner = self.inner.lock().unwrap();
        if !inner.enabled {
            return;
        }

        if inner.kill_on_exit {
            kill_child_processes(&mut inner.started_processes);
        } else {
            update_child_processes(&mut inner.started_processes);
        }

        let (mut shortcuts, mut steam_ids) = find_shortcut_files(&inner.shortcut_dir);
        let platform_dir = if is_steamvr_running {
            &inner.shortcut_vr
        } else {
            &inner.shortcut_desktop
        };
        let (plat_shortcuts, plat_steam_ids) = find_shortcut_files(platform_dir);
        shortcuts.extend(plat_shortcuts);
        steam_ids.extend(plat_steam_ids);

        for file in &shortcuts {
            if inner.run_process_once && is_process_running(file) {
                continue;
            }
            if inner.started_processes.contains_key(file.as_str()) {
                continue;
            }
            start_child_process(file, &mut inner.started_processes);
        }

        for app_id in &steam_ids {
            start_steam_game(app_id);
        }

        if shortcuts.is_empty() && steam_ids.is_empty() {
            return;
        }

        inner.timer_ticks = 0;
        inner.timer_interval_ms = 1000;
    }

    pub fn on_game_stopped(&self) {
        let mut inner = self.inner.lock().unwrap();
        if inner.kill_on_exit {
            kill_child_processes(&mut inner.started_processes);
        } else {
            update_child_processes(&mut inner.started_processes);
        }
    }
}

fn find_shortcut_files(dir: &Path) -> (Vec<String>, Vec<String>) {
    let mut shortcuts = Vec::new();
    let mut steam_ids = Vec::new();

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return (shortcuts, steam_ids),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let path_str = path.to_string_lossy().to_string();

        if is_shortcut_file(&path) {
            shortcuts.push(path_str);
            continue;
        }

        if is_url_shortcut_file(&path) {
            if let Ok(content) = fs::read_to_string(&path) {
                const PREFIX: &str = "URL=steam://rungameid/";
                if let Some(line) = content.lines().find(|l| l.starts_with(PREFIX)) {
                    let app_id = line[PREFIX.len()..].trim().to_string();
                    if !app_id.is_empty() {
                        steam_ids.push(app_id);
                    }
                }
            }
        }
    }

    (shortcuts, steam_ids)
}

fn is_shortcut_file(path: &Path) -> bool {
    let mut buf = [0u8; 4];
    let Ok(mut f) = fs::File::open(path) else {
        return false;
    };
    f.read_exact(&mut buf).is_ok() && buf == LNK_SIGNATURE
}

fn is_url_shortcut_file(path: &Path) -> bool {
    let mut buf = vec![0u8; URL_HEADER.len()];
    let Ok(mut f) = fs::File::open(path) else {
        return false;
    };
    f.read_exact(&mut buf).is_ok() && buf == URL_HEADER
}

fn is_process_running(file_path: &str) -> bool {
    let name = Path::new(file_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.is_empty() {
        return false;
    }
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes().values().any(|p| {
        let pname = p.name().to_string_lossy().to_lowercase();
        let pname = pname.strip_suffix(".exe").unwrap_or(&pname);
        pname == name
    })
}

fn start_child_process(path: &str, started_processes: &mut HashMap<String, HashSet<u32>>) {
    match shell_execute_and_get_pid(path) {
        Ok(Some(pid)) => {
            let mut pids = HashSet::new();
            pids.insert(pid);
            started_processes.insert(path.to_string(), pids);
        }
        Ok(None) => {
            started_processes.insert(path.to_string(), HashSet::new());
        }
        Err(e) => {
            tracing::error!("[AutoLaunch] failed to start {path}: {e}");
        }
    }
}

#[cfg(windows)]
fn shell_execute_and_get_pid(path: &str) -> Result<Option<u32>, String> {
    use std::mem;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::GetProcessId;

    #[allow(non_snake_case)]
    #[repr(C)]
    struct ShellExecuteInfoW {
        cbSize: u32,
        fMask: u32,
        hwnd: isize,
        lpVerb: *const u16,
        lpFile: *const u16,
        lpParameters: *const u16,
        lpDirectory: *const u16,
        nShow: i32,
        hInstApp: isize,
        lpIDList: *mut std::ffi::c_void,
        lpClass: *const u16,
        hkeyClass: isize,
        dwHotKey: u32,
        hIcon: isize,
        hProcess: isize,
    }
    const SEE_MASK_NOCLOSEPROCESS: u32 = 0x40;
    extern "system" {
        fn ShellExecuteExW(info: *mut ShellExecuteInfoW) -> i32;
    }

    let wide_path: Vec<u16> = std::ffi::OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let verb: Vec<u16> = std::ffi::OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut info: ShellExecuteInfoW = unsafe { mem::zeroed() };
    info.cbSize = mem::size_of::<ShellExecuteInfoW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = wide_path.as_ptr();
    info.nShow = 1;

    let ok = unsafe { ShellExecuteExW(&mut info) };
    if ok == 0 {
        return Err(format!("ShellExecuteExW failed for {path}"));
    }

    if info.hProcess == 0 {
        return Ok(None);
    }

    let pid = unsafe { GetProcessId(info.hProcess as _) };
    unsafe {
        CloseHandle(info.hProcess as _);
    }

    if pid == 0 {
        Ok(None)
    } else {
        Ok(Some(pid))
    }
}

#[cfg(not(windows))]
fn shell_execute_and_get_pid(_path: &str) -> Result<Option<u32>, String> {
    Err("ShellExecuteEx not available on this platform".into())
}

fn start_steam_game(app_id: &str) {
    let url = format!("steam://launch/{app_id}");
    if let Err(e) = open::that(&url) {
        tracing::error!("[AutoLaunch] failed to launch steam app {app_id}: {e}");
    }
}

fn update_child_processes(started_processes: &mut HashMap<String, HashSet<u32>>) {
    if started_processes.is_empty() {
        return;
    }

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    for pids in started_processes.values_mut() {
        let snapshot: Vec<u32> = pids.iter().copied().collect();
        for pid in &snapshot {
            if pids.len() == 1 {
                for child in find_child_pids_recursive(&sys, *pid) {
                    pids.insert(child);
                }
            }
            if sys.process(Pid::from_u32(*pid)).is_none() {
                pids.remove(pid);
            }
        }
    }

    started_processes.retain(|_, pids| !pids.is_empty());
}

fn find_child_pids_recursive(sys: &System, parent_pid: u32) -> Vec<u32> {
    let mut result = Vec::new();
    for (pid, proc_) in sys.processes() {
        if let Some(ppid) = proc_.parent() {
            if ppid.as_u32() == parent_pid {
                let child = pid.as_u32();
                result.push(child);
                result.extend(find_child_pids_recursive(sys, child));
            }
        }
    }
    result
}

fn kill_child_processes(started_processes: &mut HashMap<String, HashSet<u32>>) {
    update_child_processes(started_processes);

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    for pids in started_processes.values() {
        for &pid in pids {
            kill_process_tree(&mut sys, pid);
        }
    }

    started_processes.clear();
}

fn kill_process_tree(sys: &mut System, pid: u32) {
    let mut all_pids = find_child_pids_recursive(sys, pid);
    all_pids.push(pid);

    for p in all_pids {
        if let Some(process) = sys.process(Pid::from_u32(p)) {
            process.kill();
        }
    }
}
