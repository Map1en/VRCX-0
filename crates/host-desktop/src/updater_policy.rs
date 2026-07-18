use crate::host_capabilities::{current_arch, current_host_capabilities, current_platform};
use vrcx_0_host::Error;

pub fn expected_updater_target() -> Result<String, Error> {
    let platform = current_platform();
    let arch = current_arch();
    let target = match platform {
        "windows" if arch == "x86_64" => "windows-x86_64-stable".to_string(),
        "macos" if arch == "aarch64" => "macos-aarch64-stable".to_string(),
        "macos" if arch == "x86_64" => "macos-x86_64-stable".to_string(),
        "linux" if arch == "x86_64" => {
            let kind = current_host_capabilities().linux_package_kind;
            let kind = match kind.as_str() {
                "deb" | "rpm" => kind,
                _ => "appimage".to_string(),
            };
            format!("linux-x86_64-{kind}-stable")
        }
        _ => {
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
            "Stable updater commands do not allow downgrades.".into(),
        ));
    }

    let expected_target = expected_updater_target()?;
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

    fn current_target() -> String {
        expected_updater_target().expect("current platform supports updater tests")
    }

    #[test]
    fn rejects_update_downgrades() {
        let result = validate_update_request(
            "https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            &current_target(),
            true,
        );

        assert!(result.is_err());
    }

    #[test]
    fn rejects_unexpected_target() {
        let result = validate_update_request(
            "https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            "other-target",
            false,
        );

        assert!(result.is_err());
    }

    #[test]
    fn accepts_github_release_manifest_assets() {
        let target = current_target();

        assert!(validate_update_request(
            "https://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            &target,
            false,
        )
        .is_ok());
        assert!(validate_update_request(
            "https://github.com/Map1en/VRCX-0/releases/download/v1.0.0/latest_linux_and_macos.json",
            &target,
            false,
        )
        .is_ok());
    }

    #[test]
    fn rejects_non_github_or_unexpected_manifest_urls() {
        let target = current_target();

        assert!(validate_update_request(
            "http://github.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            &target,
            false,
        )
        .is_err());
        assert!(validate_update_request(
            "https://example.com/Map1en/VRCX-0/releases/latest/download/latest_windows.json",
            &target,
            false,
        )
        .is_err());
        assert!(validate_update_request(
            "https://github.com/Map1en/VRCX-0/releases/latest/download/other.json",
            &target,
            false,
        )
        .is_err());
        assert!(validate_update_request(
            "https://github.com/Map1en/VRCX-0/archive/latest_windows.json",
            &target,
            false,
        )
        .is_err());
    }
}
