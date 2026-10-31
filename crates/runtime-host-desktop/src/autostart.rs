use vrcx_0_persistence::config::ConfigRepository;

const START_AT_SYSTEM_STARTUP_CONFIG_KEY: &str = "StartAtWindowsStartup";

pub trait AutostartPlatform: Send + Sync {
    fn set_enabled(&self, enabled: bool) -> Result<(), String>;
}

pub fn set_autostart_preference(
    config: &ConfigRepository,
    platform: &dyn AutostartPlatform,
    enabled: bool,
) -> crate::Result<bool> {
    let previous_enabled = config.get_bool(START_AT_SYSTEM_STARTUP_CONFIG_KEY, false)?;
    platform
        .set_enabled(enabled)
        .map_err(vrcx_0_application_core::Error::Custom)?;
    if let Err(error) = config.set_bool(START_AT_SYSTEM_STARTUP_CONFIG_KEY, enabled) {
        if let Err(rollback_error) = platform.set_enabled(previous_enabled) {
            tracing::warn!(
                error = %rollback_error,
                "failed to roll back system startup setting"
            );
        }
        return Err(error.into());
    }
    Ok(enabled)
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };

    use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

    use super::{set_autostart_preference, AutostartPlatform};

    #[derive(Default)]
    struct FakePlatform {
        calls: Mutex<Vec<bool>>,
    }

    impl AutostartPlatform for FakePlatform {
        fn set_enabled(&self, enabled: bool) -> Result<(), String> {
            self.calls.lock().unwrap().push(enabled);
            Ok(())
        }
    }

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-autostart-preference-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn platform_and_persisted_preference_are_updated_together() {
        let dir = TestDir::new();
        let db = Arc::new(DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap());
        let config = ConfigRepository::new(db);
        let platform = FakePlatform::default();

        assert!(set_autostart_preference(&config, &platform, true).unwrap());
        assert!(config.get_bool("StartAtWindowsStartup", false).unwrap());
        assert_eq!(*platform.calls.lock().unwrap(), vec![true]);
    }
}
