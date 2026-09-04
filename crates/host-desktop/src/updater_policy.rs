use crate::host_capabilities::{
    current_host_architecture, current_host_capabilities, current_host_platform, HostArchitecture,
    HostPlatform, LinuxPackageKind,
};
use vrcx_0_platform::Error;

pub fn expected_updater_target() -> Result<String, Error> {
    updater_target(
        current_host_platform(),
        current_host_architecture(),
        current_host_capabilities().linux_package_kind,
    )
}

fn updater_target(
    platform: HostPlatform,
    arch: HostArchitecture,
    linux_package_kind: LinuxPackageKind,
) -> Result<String, Error> {
    let target = match (platform, arch) {
        (HostPlatform::Windows, HostArchitecture::X86_64) => "windows-x86_64-stable".to_string(),
        (HostPlatform::Macos, HostArchitecture::Aarch64) => "macos-aarch64-stable".to_string(),
        (HostPlatform::Macos, HostArchitecture::X86_64) => "macos-x86_64-stable".to_string(),
        (HostPlatform::Linux, HostArchitecture::X86_64) => {
            let kind = match linux_package_kind {
                LinuxPackageKind::Deb => "deb",
                LinuxPackageKind::Rpm => "rpm",
                LinuxPackageKind::Appimage => "appimage",
                LinuxPackageKind::Unknown => {
                    return Err(Error::Custom(
                        "Updates are not installable for an unknown Linux package type.".into(),
                    ))
                }
            };
            format!("linux-x86_64-{kind}-stable")
        }
        (platform, arch) => {
            return Err(Error::Custom(format!(
                "Updates are not installable on {platform}/{arch}."
            )))
        }
    };
    Ok(target)
}

pub fn validate_update_request(
    manifest_url: &str,
    target: &str,
    allow_downgrades: bool,
) -> Result<url::Url, Error> {
    if allow_downgrades {
        return Err(Error::Custom(
            "Updater commands do not allow downgrades.".into(),
        ));
    }

    let expected_target = expected_updater_target()?;
    validate_update_request_with_expected_target(manifest_url, target, &expected_target)
}

fn validate_update_request_with_expected_target(
    manifest_url: &str,
    target: &str,
    expected_target: &str,
) -> Result<url::Url, Error> {
    if target != expected_target {
        return Err(Error::Custom(format!(
            "Updater target mismatch: expected {expected_target}, got {target}."
        )));
    }

    let endpoint = manifest_url
        .parse::<url::Url>()
        .map_err(|error| Error::Custom(format!("Invalid update manifest URL: {error}")))?;
    if endpoint.scheme() != "https"
        || endpoint.host_str() != Some("github.com")
        || !matches!(
            endpoint.path(),
            path if path.contains("/releases/download/")
                || path.contains("/releases/latest/download/")
        )
        || !matches!(
            endpoint.path().rsplit('/').next(),
            Some("latest_windows.json" | "latest_linux_and_macos.json")
        )
    {
        return Err(Error::Custom(
            "Update manifest must be a GitHub release asset URL.".into(),
        ));
    }
    Ok(endpoint)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_TARGET: &str = "windows-x86_64-stable";

    #[test]
    fn linux_unknown_packages_use_the_manual_update_path() {
        assert!(updater_target(
            HostPlatform::Linux,
            HostArchitecture::X86_64,
            LinuxPackageKind::Unknown,
        )
        .is_err());
    }

    #[test]
    fn supported_desktop_packages_keep_their_updater_targets() {
        assert_eq!(
            updater_target(
                HostPlatform::Linux,
                HostArchitecture::X86_64,
                LinuxPackageKind::Appimage,
            )
            .unwrap(),
            "linux-x86_64-appimage-stable"
        );
        assert_eq!(
            updater_target(
                HostPlatform::Macos,
                HostArchitecture::Aarch64,
                LinuxPackageKind::Unknown,
            )
            .unwrap(),
            "macos-aarch64-stable"
        );
    }

    #[test]
    fn rejects_update_downgrades() {
        let result = validate_update_request(
            "https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            TEST_TARGET,
            true,
        );

        assert!(result.is_err());
    }

    #[test]
    fn rejects_unexpected_target() {
        let result = validate_update_request_with_expected_target(
            "https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            "other-target",
            TEST_TARGET,
        );

        assert!(result.is_err());
    }

    #[test]
    fn accepts_github_release_manifest_assets() {
        assert!(validate_update_request_with_expected_target(
            "https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            TEST_TARGET,
            TEST_TARGET,
        )
        .is_ok());
        assert!(validate_update_request_with_expected_target(
            "https://github.com/Map1en/VRCX-0/releases/download/v1.0.0/latest_linux_and_macos.json",
            TEST_TARGET,
            TEST_TARGET,
        )
        .is_ok());
    }

    #[test]
    fn rejects_non_github_or_unexpected_manifest_urls() {
        assert!(validate_update_request_with_expected_target(
            "http://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            TEST_TARGET,
            TEST_TARGET,
        )
        .is_err());
        assert!(validate_update_request_with_expected_target(
            "https://example.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            TEST_TARGET,
            TEST_TARGET,
        )
        .is_err());
        assert!(validate_update_request_with_expected_target(
            "https://github.com/Map1en/VRCX-0/releases/latest/download/other.json",
            TEST_TARGET,
            TEST_TARGET,
        )
        .is_err());
        assert!(validate_update_request_with_expected_target(
            "https://github.com/Map1en/VRCX-0/archive/latest_windows.json",
            TEST_TARGET,
            TEST_TARGET,
        )
        .is_err());
    }
}
