use serde::Serialize;

pub use vrcx_0_platform::host_capabilities::{
    current_arch, current_host_architecture, current_host_platform, current_platform,
    HostArchitecture, HostPlatform,
};
use vrcx_0_platform::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    pub supported: bool,
    pub enabled: bool,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LinuxPackageKind {
    #[default]
    Unknown,
    Appimage,
    Deb,
    Rpm,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HostCapabilities {
    pub platform: HostPlatform,
    pub arch: HostArchitecture,
    pub linux_package_kind: LinuxPackageKind,
    pub local_database: CapabilityStatus,
    pub websocket_runtime: CapabilityStatus,
    pub game_log_watcher: CapabilityStatus,
    pub runtime_game_log_ingest: CapabilityStatus,
    pub runtime_game_log_side_effects: CapabilityStatus,
    pub runtime_game_client_lifecycle: CapabilityStatus,
    pub runtime_realtime_transport: CapabilityStatus,
    pub game_process_monitor: CapabilityStatus,
    pub vrchat_path_discovery: CapabilityStatus,
    pub steam_library_discovery: CapabilityStatus,
    pub steam_runtime_integration: CapabilityStatus,
    pub registry_prefs: CapabilityStatus,
    pub game_launch: CapabilityStatus,
    pub vrchat_launch_pipe: CapabilityStatus,
    pub screenshot_cache: CapabilityStatus,
}

#[derive(Clone, Copy, Debug)]
pub enum HostCapability {
    GameLogWatcher,
    GameProcessMonitor,
    VrchatPathDiscovery,
    RegistryPrefs,
    GameLaunch,
    VrchatLaunchPipe,
    ScreenshotCache,
}

impl CapabilityStatus {
    fn available() -> Self {
        Self {
            supported: true,
            enabled: true,
            available: true,
            reason: None,
        }
    }

    #[cfg(target_os = "linux")]
    fn unavailable(reason: &str) -> Self {
        Self {
            supported: true,
            enabled: true,
            available: false,
            reason: Some(reason.to_string()),
        }
    }

    fn unsupported(label: &str, platform: impl std::fmt::Display) -> Self {
        Self {
            supported: false,
            enabled: false,
            available: false,
            reason: Some(format!("{label} is not supported on {platform}")),
        }
    }
}

impl HostCapabilities {
    #[cfg(any(test, not(target_os = "linux")))]
    fn status(&self, capability: HostCapability) -> &CapabilityStatus {
        match capability {
            HostCapability::GameLogWatcher => &self.game_log_watcher,
            HostCapability::GameProcessMonitor => &self.game_process_monitor,
            HostCapability::VrchatPathDiscovery => &self.vrchat_path_discovery,
            HostCapability::RegistryPrefs => &self.registry_prefs,
            HostCapability::GameLaunch => &self.game_launch,
            HostCapability::VrchatLaunchPipe => &self.vrchat_launch_pipe,
            HostCapability::ScreenshotCache => &self.screenshot_cache,
        }
    }
}

impl HostCapability {
    fn label(self) -> &'static str {
        match self {
            HostCapability::GameLogWatcher => "GameLog watcher",
            HostCapability::GameProcessMonitor => "Game process monitor",
            HostCapability::VrchatPathDiscovery => "VRChat path discovery",
            HostCapability::RegistryPrefs => "VRChat registry preferences",
            HostCapability::GameLaunch => "Game launch",
            HostCapability::VrchatLaunchPipe => "VRChat launch pipe",
            HostCapability::ScreenshotCache => "Screenshot cache",
        }
    }
}

#[cfg(target_os = "linux")]
fn command_succeeds(program: &str, args: &[&str], stdout_match: Option<&str>) -> bool {
    let Ok(output) = std::process::Command::new(program).args(args).output() else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    if let Some(expected) = stdout_match {
        return String::from_utf8_lossy(&output.stdout).contains(expected);
    }
    true
}

#[cfg(target_os = "linux")]
fn current_linux_package_kind() -> LinuxPackageKind {
    static PACKAGE_KIND: std::sync::OnceLock<LinuxPackageKind> = std::sync::OnceLock::new();
    *PACKAGE_KIND.get_or_init(probe_linux_package_kind)
}

#[cfg(target_os = "linux")]
fn probe_linux_package_kind() -> LinuxPackageKind {
    if std::env::var_os("APPIMAGE").is_some() {
        return LinuxPackageKind::Appimage;
    }
    if command_succeeds(
        "dpkg-query",
        &["-W", "-f=${Status}", "vrcx-0"],
        Some("install ok installed"),
    ) {
        return LinuxPackageKind::Deb;
    }
    if command_succeeds("rpm", &["-q", "vrcx-0"], None) {
        return LinuxPackageKind::Rpm;
    }
    LinuxPackageKind::Unknown
}

pub fn current_host_capabilities() -> HostCapabilities {
    let platform = current_host_platform();
    let arch = current_host_architecture();
    let available = CapabilityStatus::available();

    match platform {
        HostPlatform::Windows => HostCapabilities {
            platform,
            arch,
            linux_package_kind: LinuxPackageKind::Unknown,
            local_database: available.clone(),
            websocket_runtime: available.clone(),
            game_log_watcher: available.clone(),
            runtime_game_log_ingest: available.clone(),
            runtime_game_log_side_effects: available.clone(),
            runtime_game_client_lifecycle: available.clone(),
            runtime_realtime_transport: available.clone(),
            game_process_monitor: available.clone(),
            vrchat_path_discovery: available.clone(),
            steam_library_discovery: available.clone(),
            steam_runtime_integration: available.clone(),
            registry_prefs: available.clone(),
            game_launch: available.clone(),
            vrchat_launch_pipe: available.clone(),
            screenshot_cache: available,
        },
        #[cfg(target_os = "linux")]
        HostPlatform::Linux => linux_host_capabilities(platform, arch, &available),
        HostPlatform::Macos => HostCapabilities {
            platform,
            arch,
            linux_package_kind: LinuxPackageKind::Unknown,
            local_database: available.clone(),
            websocket_runtime: available.clone(),
            game_log_watcher: CapabilityStatus::unsupported("GameLog watcher", "macOS"),
            runtime_game_log_ingest: CapabilityStatus::unsupported(
                "runtime GameLog ingest",
                "macOS",
            ),
            runtime_game_log_side_effects: CapabilityStatus::unsupported(
                "runtime GameLog side effects",
                "macOS",
            ),
            runtime_game_client_lifecycle: CapabilityStatus::unsupported(
                "runtime game client lifecycle",
                "macOS",
            ),
            runtime_realtime_transport: available.clone(),
            game_process_monitor: CapabilityStatus::unsupported("Game process monitor", "macOS"),
            vrchat_path_discovery: CapabilityStatus::unsupported("VRChat path discovery", "macOS"),
            steam_library_discovery: CapabilityStatus::unsupported(
                "Steam library discovery",
                "macOS",
            ),
            steam_runtime_integration: CapabilityStatus::unsupported(
                "Steam runtime integration",
                "macOS",
            ),
            registry_prefs: CapabilityStatus::unsupported("VRChat registry preferences", "macOS"),
            game_launch: CapabilityStatus::unsupported("Game launch", "macOS"),
            vrchat_launch_pipe: CapabilityStatus::unsupported("VRChat launch pipe", "macOS"),
            screenshot_cache: CapabilityStatus::unsupported("Screenshot cache", "macOS"),
        },
        _ => HostCapabilities {
            platform,
            arch,
            linux_package_kind: LinuxPackageKind::Unknown,
            local_database: available.clone(),
            websocket_runtime: available.clone(),
            game_log_watcher: CapabilityStatus::unsupported("GameLog watcher", platform),
            runtime_game_log_ingest: CapabilityStatus::unsupported(
                "runtime GameLog ingest",
                platform,
            ),
            runtime_game_log_side_effects: CapabilityStatus::unsupported(
                "runtime GameLog side effects",
                platform,
            ),
            runtime_game_client_lifecycle: CapabilityStatus::unsupported(
                "runtime game client lifecycle",
                platform,
            ),
            runtime_realtime_transport: available.clone(),
            game_process_monitor: CapabilityStatus::unsupported("Game process monitor", platform),
            vrchat_path_discovery: CapabilityStatus::unsupported("VRChat path discovery", platform),
            steam_library_discovery: CapabilityStatus::unsupported(
                "Steam library discovery",
                platform,
            ),
            steam_runtime_integration: CapabilityStatus::unsupported(
                "Steam runtime integration",
                platform,
            ),
            registry_prefs: CapabilityStatus::unsupported("VRChat registry preferences", platform),
            game_launch: CapabilityStatus::unsupported("Game launch", platform),
            vrchat_launch_pipe: CapabilityStatus::unsupported("VRChat launch pipe", platform),
            screenshot_cache: CapabilityStatus::unsupported("Screenshot cache", platform),
        },
    }
}

#[cfg(target_os = "linux")]
fn linux_host_capabilities(
    platform: HostPlatform,
    arch: HostArchitecture,
    available: &CapabilityStatus,
) -> HostCapabilities {
    let steam_library_discovery = match crate::vrchat_paths::discover_linux_steam_libraries() {
        Ok(_) => available.clone(),
        Err(reason) => CapabilityStatus::unavailable(&reason),
    };

    let vrchat_path_discovery = linux_capability_status(HostCapability::VrchatPathDiscovery);
    let game_log_watcher = linux_capability_status(HostCapability::GameLogWatcher);
    let game_launch = linux_capability_status(HostCapability::GameLaunch);
    let registry_prefs = linux_capability_status(HostCapability::RegistryPrefs);
    let vrchat_launch_pipe = linux_capability_status(HostCapability::VrchatLaunchPipe);
    let screenshot_cache = linux_capability_status(HostCapability::ScreenshotCache);

    let runtime_game_client_lifecycle = if game_launch.available && game_log_watcher.available {
        available.clone()
    } else if !game_launch.available {
        game_launch.clone()
    } else {
        game_log_watcher.clone()
    };

    HostCapabilities {
        platform,
        arch,
        linux_package_kind: current_linux_package_kind(),
        local_database: available.clone(),
        websocket_runtime: available.clone(),
        game_log_watcher: game_log_watcher.clone(),
        runtime_game_log_ingest: game_log_watcher.clone(),
        runtime_game_log_side_effects: game_log_watcher,
        runtime_game_client_lifecycle,
        runtime_realtime_transport: available.clone(),
        game_process_monitor: available.clone(),
        vrchat_path_discovery: vrchat_path_discovery.clone(),
        steam_library_discovery,
        steam_runtime_integration: CapabilityStatus::unsupported(
            "Steam runtime integration",
            "Linux",
        ),
        registry_prefs,
        game_launch,
        vrchat_launch_pipe,
        screenshot_cache,
    }
}

#[cfg(target_os = "linux")]
fn linux_capability_status(capability: HostCapability) -> CapabilityStatus {
    let probe = match capability {
        HostCapability::GameLogWatcher => {
            crate::vrchat_paths::discover_linux_vrchat_log_paths().map(drop)
        }
        HostCapability::GameProcessMonitor => Ok(()),
        HostCapability::VrchatPathDiscovery => {
            crate::vrchat_paths::discover_linux_vrchat_paths().map(drop)
        }
        HostCapability::RegistryPrefs => {
            crate::linux_registry::discover_linux_registry_context().map(drop)
        }
        HostCapability::GameLaunch => crate::vrchat_paths::discover_linux_game_launch(),
        HostCapability::VrchatLaunchPipe => crate::vrchat_paths::discover_linux_instance_launch()
            .map_err(|reason| format!("VRChat launch pipe bridge unavailable: {reason}")),
        HostCapability::ScreenshotCache => crate::vrchat_paths::discover_linux_screenshot_cache(),
    };
    match probe {
        Ok(()) => CapabilityStatus::available(),
        Err(reason) => CapabilityStatus::unavailable(&reason),
    }
}

fn host_capability_status(capability: HostCapability) -> CapabilityStatus {
    #[cfg(target_os = "linux")]
    {
        linux_capability_status(capability)
    }
    #[cfg(not(target_os = "linux"))]
    {
        current_host_capabilities().status(capability).clone()
    }
}

pub fn require_host_capability(capability: HostCapability) -> Result<(), Error> {
    let status = host_capability_status(capability);
    if status.available {
        return Ok(());
    }

    Err(Error::Custom(status.reason.unwrap_or_else(|| {
        format!(
            "{} is unavailable on {}",
            capability.label(),
            current_host_platform()
        )
    })))
}

pub fn require_host_capability_supported(capability: HostCapability) -> Result<(), Error> {
    let status = host_capability_status(capability);
    if status.supported && status.enabled {
        return Ok(());
    }

    Err(Error::Custom(status.reason.unwrap_or_else(|| {
        format!(
            "{} is unsupported on {}",
            capability.label(),
            current_host_platform()
        )
    })))
}

pub fn is_host_capability_available(capability: HostCapability) -> bool {
    host_capability_status(capability).available
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_capability_probe_matches_the_full_capability_table() {
        let capabilities = current_host_capabilities();
        for capability in [
            HostCapability::GameLogWatcher,
            HostCapability::GameProcessMonitor,
            HostCapability::VrchatPathDiscovery,
            HostCapability::RegistryPrefs,
            HostCapability::GameLaunch,
            HostCapability::VrchatLaunchPipe,
            HostCapability::ScreenshotCache,
        ] {
            assert_eq!(
                &host_capability_status(capability),
                capabilities.status(capability),
                "{}",
                capability.label()
            );
        }
    }
}
