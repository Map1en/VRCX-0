use sysinfo::{Pid, ProcessesToUpdate, System};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VrcProcessStatus {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
}

pub struct ProcessStatusDetector {
    sys: System,
}

impl ProcessStatusDetector {
    pub fn new() -> Self {
        Self { sys: System::new() }
    }

    pub fn detect(&mut self) -> VrcProcessStatus {
        self.sys.refresh_processes(ProcessesToUpdate::All, true);
        detect_process_status_from_names(
            self.sys
                .processes()
                .values()
                .map(|process| process.name().to_string_lossy()),
        )
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

pub fn is_process_running(pid: u32) -> bool {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.process(Pid::from_u32(pid)).is_some()
}

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
    name.to_ascii_lowercase().starts_with("vrserver")
}

#[cfg(test)]
mod tests {
    use super::{
        detect_process_status_from_names, is_steamvr_process_name, is_vrchat_process_name,
    };

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
}
