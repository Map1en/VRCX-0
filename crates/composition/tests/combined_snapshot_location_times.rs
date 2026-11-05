use std::collections::HashMap;
use std::path::PathBuf;

use vrcx_0_application_realtime::{FriendLocationTime, FriendLocationTimeSource, FriendPlace};
use vrcx_0_composition::{RuntimeHostOptions, RuntimeHostProfile, RuntimeHostState};
use vrcx_0_platform::app_paths::{AppDataDirResolution, AppDataDirSource};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new() -> std::io::Result<Self> {
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-combined-snapshot-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[tokio::test]
async fn a_window_opened_later_still_gets_how_long_friends_have_been_in_their_instance() {
    let dir = TestDir::new().unwrap();
    let app_data = dir.path.join("app-data");
    std::fs::create_dir_all(&app_data).unwrap();
    let state = RuntimeHostState::new(RuntimeHostOptions {
        realtime_origin: "http://localhost:9000".into(),
        launched_from_autostart: false,
        app_data_dir: AppDataDirResolution {
            current_dir: app_data.clone(),
            default_dir: app_data.clone(),
            persisted_dir: None,
            cli_dir: Some(app_data),
            source: AppDataDirSource::Cli,
        },
        app_version: "0.0.0-test".into(),
        profile: RuntimeHostProfile::HeadlessData,
        database_maintenance_cache_dir: None,
        task_executor: None,
    })
    .unwrap();
    state
        .desktop_assembly()
        .instance_dwell()
        .sync_friends(&HashMap::from([(
            "usr_friend".to_string(),
            FriendPlace::Present {
                location: "wrld_1:10129~hidden(usr_host)~region(jp)".into(),
                since_ms: 1_700_000_000_000,
            },
        )]));

    assert_eq!(
        state
            .backend_runtime_combined_snapshot()
            .friend_location_times,
        vec![FriendLocationTime {
            user_id: "usr_friend".into(),
            location: "wrld_1:10129~hidden(usr_host)~region(jp)".into(),
            since_ms: Some(1_700_000_000_000),
            source: FriendLocationTimeSource::Realtime,
        }]
    );
}
