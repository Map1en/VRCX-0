use std::path::PathBuf;
use std::sync::Arc;

use vrcx_0_application_core::{ImageCache, WebClient};
use vrcx_0_application_game::{EmptyEventPayload, NowPlayingPayload};
use vrcx_0_composition::RuntimeHostDesktopAssemblyDeps;
use vrcx_0_persistence::{storage::StorageService, DatabaseService};

use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-runtime-host-desktop-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_services(name: &str) -> (TestDir, DesktopRuntimeServices) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let storage = StorageService::new(&dir.path.join("storage.json")).unwrap();
    let web = Arc::new(WebClient::new(
        vrcx_0_outbound_adapters::LocalWebClientAdapter::new(
            &storage,
            Arc::clone(&db),
            "wss://pipeline.vrchat.cloud".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    ));
    let image_cache = Arc::new(ImageCache::new(Arc::new(
        vrcx_0_outbound_adapters::LocalImageCacheAdapter::new(
            dir.path.join("ImageCache"),
            Arc::clone(&web),
        )
        .unwrap(),
    )));
    let context = RuntimeHostDesktopAssemblyDeps::new(db, web, image_cache);
    let services =
        DesktopRuntimeServices::new(crate::state::build_desktop_runtime_services_deps(&context))
            .unwrap();
    (dir, services)
}

#[test]
fn game_log_side_effect_observer_merges_and_resets_now_playing() {
    let (_dir, services) = test_services("now-playing-observer");
    let event = GameLogSideEffectEvent::NowPlaying(Box::new(NowPlayingPayload {
        name: Some("Test Track".into()),
        position: Some(42),
        started_at: Some("start".into()),
        updated_at: "update".into(),
        ..Default::default()
    }));

    services.on_game_log_side_effect(&event);

    assert_eq!(services.now_playing().name, "Test Track");
    assert_eq!(services.now_playing().position, 42);
    assert_eq!(services.now_playing().url, "");

    services.on_game_log_side_effect(&GameLogSideEffectEvent::NowPlayingReset(
        EmptyEventPayload::default(),
    ));

    assert_eq!(
        services.now_playing().as_ref(),
        &NowPlayingSnapshot::default()
    );
}
