use sysinfo::{ProcessesToUpdate, System};

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
    name.eq_ignore_ascii_case("VRChat.exe")
}

#[cfg(target_os = "linux")]
fn is_steamvr_process_name(name: &str) -> bool {
    name == "vrmonitor" || name == "monado-service" || name.ends_with("wivrn-server")
}

#[cfg(not(target_os = "linux"))]
fn is_steamvr_process_name(name: &str) -> bool {
    name.starts_with("vrserver")
}

#[cfg(test)]
mod tests {
    use super::{
        detect_process_status_from_names, is_steamvr_process_name, is_vrchat_process_name,
    };

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_vrchat_process_name_matches_vue_electron_backend() {
        assert!(is_vrchat_process_name("VRChat.exe"));
        assert!(!is_vrchat_process_name("VRChat"));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_steamvr_process_name_matches_vue_electron_backend() {
        assert!(is_steamvr_process_name("vrmonitor"));
        assert!(is_steamvr_process_name("monado-service"));
        assert!(is_steamvr_process_name("WiVRn-wivrn-server"));
        assert!(!is_steamvr_process_name("vrserver"));
    }

    #[test]
    #[cfg(not(target_os = "linux"))]
    fn non_linux_vrchat_process_name_matches_game_process_only() {
        assert!(is_vrchat_process_name("VRChat.exe"));
        assert!(is_vrchat_process_name("vrchat.exe"));
        assert!(!is_vrchat_process_name("VRChat"));
        assert!(!is_vrchat_process_name("VRChatHelper.exe"));
        assert!(is_steamvr_process_name("vrserver"));
        assert!(is_steamvr_process_name("vrserver.exe"));
    }

    #[test]
    fn detects_combined_status_from_process_names() {
        let status = detect_process_status_from_names(["VRChat.exe", "vrserver.exe"]);
        assert!(status.is_game_running);
        assert!(status.is_steamvr_running);
    }
}
