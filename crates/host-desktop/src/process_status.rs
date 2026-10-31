#[cfg(windows)]
use std::num::NonZeroUsize;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_TIMEOUT};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VrcProcessStatus {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
}

pub struct ProcessStatusDetector {
    sys: System,
    #[cfg(windows)]
    process_handles: ProcessHandleCache<WindowsProcessHandle>,
}

impl ProcessStatusDetector {
    pub fn new() -> Self {
        #[cfg(target_os = "linux")]
        sysinfo::set_open_files_limit(0);
        Self {
            sys: System::new(),
            #[cfg(windows)]
            process_handles: ProcessHandleCache::default(),
        }
    }

    pub fn detect(&mut self) -> VrcProcessStatus {
        #[cfg(windows)]
        {
            let cached_status = self
                .process_handles
                .retain_running(WindowsProcessHandle::is_running);
            if cached_status.is_game_running && cached_status.is_steamvr_running {
                return cached_status;
            }

            self.sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing(),
            );
            self.process_handles.update_from_processes(
                self.sys
                    .processes()
                    .values()
                    .map(|process| (process.pid(), process.name().to_string_lossy())),
                WindowsProcessHandle::open,
            )
        }

        #[cfg(not(windows))]
        {
            self.sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing(),
            );
            detect_process_status_from_names(
                self.sys
                    .processes()
                    .values()
                    .map(|process| process.name().to_string_lossy()),
            )
        }
    }
}

#[cfg(any(windows, test))]
struct ProcessHandleCache<H> {
    game: Option<H>,
    steamvr: Option<H>,
}

#[cfg(any(windows, test))]
impl<H> ProcessHandleCache<H> {
    fn retain_running(&mut self, mut is_running: impl FnMut(&H) -> bool) -> VrcProcessStatus {
        self.game = self.game.take().filter(|handle| is_running(handle));
        self.steamvr = self.steamvr.take().filter(|handle| is_running(handle));
        VrcProcessStatus {
            is_game_running: self.game.is_some(),
            is_steamvr_running: self.steamvr.is_some(),
        }
    }

    fn update_from_processes<I, S>(
        &mut self,
        processes: I,
        mut open_handle: impl FnMut(Pid) -> Option<H>,
    ) -> VrcProcessStatus
    where
        I: IntoIterator<Item = (Pid, S)>,
        S: AsRef<str>,
    {
        let mut status = VrcProcessStatus {
            is_game_running: self.game.is_some(),
            is_steamvr_running: self.steamvr.is_some(),
        };

        for (pid, name) in processes {
            let name = name.as_ref();
            if is_vrchat_process_name(name) {
                status.is_game_running = true;
                if self.game.is_none() {
                    self.game = open_handle(pid);
                }
            }
            if is_steamvr_process_name(name) {
                status.is_steamvr_running = true;
                if self.steamvr.is_none() {
                    self.steamvr = open_handle(pid);
                }
            }
            if self.game.is_some() && self.steamvr.is_some() {
                break;
            }
        }

        status
    }
}

#[cfg(any(windows, test))]
impl<H> Default for ProcessHandleCache<H> {
    fn default() -> Self {
        Self {
            game: None,
            steamvr: None,
        }
    }
}

#[cfg(windows)]
struct WindowsProcessHandle {
    handle: NonZeroUsize,
}

#[cfg(windows)]
impl WindowsProcessHandle {
    fn open(pid: Pid) -> Option<Self> {
        let handle = unsafe { OpenProcess(SYNCHRONIZE, false.into(), pid.as_u32()) };
        NonZeroUsize::new(handle as usize).map(|handle| Self { handle })
    }

    fn is_running(&self) -> bool {
        unsafe { WaitForSingleObject(self.handle.get() as HANDLE, 0) == WAIT_TIMEOUT }
    }
}

#[cfg(windows)]
impl Drop for WindowsProcessHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle.get() as HANDLE);
        }
    }
}

impl Default for ProcessStatusDetector {
    fn default() -> Self {
        Self::new()
    }
}

pub fn detect_process_status() -> VrcProcessStatus {
    ProcessStatusDetector::new().detect()
}

pub fn detect_game_running() -> bool {
    detect_process_status().is_game_running
}

pub fn detect_steamvr_running() -> bool {
    detect_process_status().is_steamvr_running
}

pub fn vrchat_process_ids() -> Vec<u32> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .values()
        .filter(|process| is_vrchat_process_name(&process.name().to_string_lossy()))
        .map(|process| process.pid().as_u32())
        .collect()
}

#[cfg(target_os = "linux")]
pub fn linux_vrchat_process_id() -> Option<u32> {
    select_linux_vrchat_process_id(vrchat_process_ids(), |process_id| {
        std::fs::read(format!("/proc/{process_id}/environ")).ok()
    })
}

#[cfg(any(target_os = "linux", test))]
fn select_linux_vrchat_process_id(
    process_ids: Vec<u32>,
    mut read_environment: impl FnMut(u32) -> Option<Vec<u8>>,
) -> Option<u32> {
    const VRCHAT_COMPATDATA_MARKER: &[u8] = b"compatdata/438100";

    process_ids
        .iter()
        .copied()
        .find(|process_id| {
            read_environment(*process_id).is_some_and(|environment| {
                environment
                    .windows(VRCHAT_COMPATDATA_MARKER.len())
                    .any(|window| window == VRCHAT_COMPATDATA_MARKER)
            })
        })
        .or_else(|| process_ids.first().copied())
}

pub fn detect_legacy_vrcx_running() -> bool {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .values()
        .any(|process| is_legacy_vrcx_process_name(&process.name().to_string_lossy()))
}

pub fn is_process_running(pid: u32) -> bool {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.process(Pid::from_u32(pid)).is_some()
}

fn is_legacy_vrcx_process_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("VRCX.exe") || name.eq_ignore_ascii_case("VRCX")
}

#[cfg(any(not(windows), test))]
fn detect_process_status_from_names<I, S>(names: I) -> VrcProcessStatus
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut status = VrcProcessStatus::default();
    for name in names {
        let name = name.as_ref();
        if !status.is_game_running && is_vrchat_process_name(name) {
            status.is_game_running = true;
        }
        if !status.is_steamvr_running && is_steamvr_process_name(name) {
            status.is_steamvr_running = true;
        }
        if status.is_game_running && status.is_steamvr_running {
            break;
        }
    }
    status
}

#[cfg(target_os = "linux")]
fn is_vrchat_process_name(name: &str) -> bool {
    name == "VRChat.exe"
}

#[cfg(not(target_os = "linux"))]
fn is_vrchat_process_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("VRChat.exe") || name.eq_ignore_ascii_case("VRChat")
}

#[cfg(target_os = "linux")]
fn is_steamvr_process_name(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "vrmonitor" | "vrserver" | "vrserver.exe" | "vrcompositor" | "monado-service"
    ) || normalized.ends_with("wivrn-server")
}

#[cfg(not(target_os = "linux"))]
fn is_steamvr_process_name(name: &str) -> bool {
    name.as_bytes()
        .get(.."vrserver".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"vrserver"))
}

#[cfg(test)]
mod tests {
    use super::{
        detect_process_status_from_names, is_legacy_vrcx_process_name, is_steamvr_process_name,
        is_vrchat_process_name, select_linux_vrchat_process_id, ProcessHandleCache,
    };
    use sysinfo::Pid;

    #[cfg(target_os = "linux")]
    const STEAMVR_PROCESS_FIXTURE: &str = "vrmonitor";

    #[cfg(not(target_os = "linux"))]
    const STEAMVR_PROCESS_FIXTURE: &str = "vrserver.exe";

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_vrchat_process_name_matches_vue_electron_host() {
        assert!(is_vrchat_process_name("VRChat.exe"));
        assert!(!is_vrchat_process_name("VRChat"));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_steamvr_process_name_matches_vue_electron_host() {
        assert!(is_steamvr_process_name("vrmonitor"));
        assert!(is_steamvr_process_name("vrserver"));
        assert!(is_steamvr_process_name("VRServer.exe"));
        assert!(is_steamvr_process_name("vrcompositor"));
        assert!(is_steamvr_process_name("monado-service"));
        assert!(is_steamvr_process_name("WiVRn-wivrn-server"));
    }

    #[test]
    #[cfg(not(target_os = "linux"))]
    fn non_linux_vrchat_process_name_matches_game_process_only() {
        assert!(is_vrchat_process_name("VRChat.exe"));
        assert!(is_vrchat_process_name("vrchat.exe"));
        assert!(is_vrchat_process_name("VRChat"));
        assert!(!is_vrchat_process_name("VRChatHelper.exe"));
        assert!(is_steamvr_process_name("vrserver"));
        assert!(is_steamvr_process_name("vrserver.exe"));
        assert!(is_steamvr_process_name("VRServer.exe"));
    }

    #[test]
    fn detects_combined_status_from_process_names() {
        let status = detect_process_status_from_names(["VRChat.exe", STEAMVR_PROCESS_FIXTURE]);
        assert!(status.is_game_running);
        assert!(status.is_steamvr_running);
    }

    #[test]
    fn initial_discovery_tracks_targets_started_before_app() {
        let game_pid = Pid::from_u32(10);
        let steamvr_pid = Pid::from_u32(20);
        let mut cache = ProcessHandleCache::default();

        let cached_status = cache.retain_running(|_: &u32| true);
        assert!(!cached_status.is_game_running);
        assert!(!cached_status.is_steamvr_running);

        let status = cache.update_from_processes(
            [
                (game_pid, "VRChat.exe"),
                (steamvr_pid, STEAMVR_PROCESS_FIXTURE),
            ],
            |pid| Some(pid.as_u32()),
        );

        assert!(status.is_game_running);
        assert!(status.is_steamvr_running);
        assert_eq!(cache.game, Some(game_pid.as_u32()));
        assert_eq!(cache.steamvr, Some(steamvr_pid.as_u32()));
    }

    #[test]
    fn missing_target_keeps_discovery_enabled_until_it_starts() {
        let game_pid = Pid::from_u32(10);
        let steamvr_pid = Pid::from_u32(20);
        let mut cache = ProcessHandleCache::default();

        let initial =
            cache.update_from_processes([(game_pid, "VRChat.exe")], |pid| Some(pid.as_u32()));
        assert!(initial.is_game_running);
        assert!(!initial.is_steamvr_running);

        let cached_status = cache.retain_running(|_: &u32| true);
        assert!(cached_status.is_game_running);
        assert!(!cached_status.is_steamvr_running);

        let status = cache.update_from_processes([(steamvr_pid, STEAMVR_PROCESS_FIXTURE)], |pid| {
            Some(pid.as_u32())
        });

        assert!(status.is_game_running);
        assert!(status.is_steamvr_running);
        assert_eq!(cache.game, Some(game_pid.as_u32()));
        assert_eq!(cache.steamvr, Some(steamvr_pid.as_u32()));
    }

    #[test]
    fn exited_target_is_rediscovered_in_the_same_poll() {
        let old_game_pid = Pid::from_u32(10);
        let new_game_pid = Pid::from_u32(11);
        let steamvr_pid = Pid::from_u32(20);
        let mut cache = ProcessHandleCache {
            game: Some(old_game_pid.as_u32()),
            steamvr: Some(steamvr_pid.as_u32()),
        };

        let cached_status = cache.retain_running(|pid| *pid != old_game_pid.as_u32());
        assert!(!cached_status.is_game_running);
        assert!(cached_status.is_steamvr_running);

        let status =
            cache.update_from_processes([(new_game_pid, "VRChat.exe")], |pid| Some(pid.as_u32()));

        assert!(status.is_game_running);
        assert!(status.is_steamvr_running);
        assert_eq!(cache.game, Some(new_game_pid.as_u32()));
        assert_eq!(cache.steamvr, Some(steamvr_pid.as_u32()));
    }

    #[test]
    fn failed_handle_open_preserves_snapshot_status_without_caching() {
        let game_pid = Pid::from_u32(10);
        let steamvr_pid = Pid::from_u32(20);
        let mut cache = ProcessHandleCache::<u32>::default();

        let status = cache.update_from_processes(
            [
                (game_pid, "VRChat.exe"),
                (steamvr_pid, STEAMVR_PROCESS_FIXTURE),
            ],
            |_| None,
        );

        assert!(status.is_game_running);
        assert!(status.is_steamvr_running);
        assert!(cache.game.is_none());
        assert!(cache.steamvr.is_none());

        let cached_status = cache.retain_running(|_| true);
        assert!(!cached_status.is_game_running);
        assert!(!cached_status.is_steamvr_running);
    }

    #[test]
    #[cfg(windows)]
    fn windows_process_handle_detects_current_process() {
        let handle = super::WindowsProcessHandle::open(Pid::from_u32(std::process::id())).unwrap();
        assert!(handle.is_running());
    }

    #[test]
    #[cfg(windows)]
    fn windows_process_handle_detects_process_exit() {
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "ping.exe -n 2 127.0.0.1 >NUL"])
            .spawn()
            .unwrap();
        let handle = super::WindowsProcessHandle::open(Pid::from_u32(child.id())).unwrap();

        assert!(handle.is_running());
        assert!(child.wait().unwrap().success());
        assert!(!handle.is_running());
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_detector_does_not_keep_proc_stat_files_open() {
        let mut detector = super::ProcessStatusDetector::new();
        detector.detect();
        let stat_fds = std::fs::read_dir("/proc/self/fd")
            .unwrap()
            .filter_map(|entry| std::fs::read_link(entry.ok()?.path()).ok())
            .filter(|target| {
                target.starts_with("/proc") && target.file_name().is_some_and(|name| name == "stat")
            })
            .count();
        assert_eq!(stat_fds, 0);
    }

    #[test]
    fn legacy_vrcx_process_name_does_not_match_vrcx_zero() {
        assert!(is_legacy_vrcx_process_name("VRCX.exe"));
        assert!(is_legacy_vrcx_process_name("vrcx"));
        assert!(!is_legacy_vrcx_process_name("VRCX-0.exe"));
    }

    #[test]
    fn linux_launch_prefers_the_vrchat_proton_process() {
        let selected =
            select_linux_vrchat_process_id(vec![10, 20], |process_id| match process_id {
                10 => Some(b"WINEPREFIX=/games/compatdata/123/pfx\0".to_vec()),
                20 => Some(b"WINEPREFIX=/games/compatdata/438100/pfx\0".to_vec()),
                _ => None,
            });

        assert_eq!(selected, Some(20));
    }

    #[test]
    fn linux_launch_falls_back_to_the_first_vrchat_process() {
        let selected = select_linux_vrchat_process_id(vec![10, 20], |_| None);

        assert_eq!(selected, Some(10));
    }
}
