use std::path::PathBuf;
use std::sync::Arc;

use vrcx_0_application_core::{ImageCache, WebClient};
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
    let web = Arc::new(
        WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    );
    let image_cache = Arc::new(
        ImageCache::new(dir.path.join("ImageCache"), web.image_fetcher().unwrap()).unwrap(),
    );
    let data = Arc::new(RuntimeHostContext::new(db, web, image_cache));
    let services = DesktopRuntimeServices::new(data);
    (dir, services)
}

#[test]
fn prefetch_online_friend_avatars_is_a_no_op_without_active_session() {
    let (_dir, services) = test_services("prefetch-no-active-session");

    services.observe_runtime_event(
        "realtimeFriendProjection",
        &json!({
            "patches": [{
                "userId": "usr_friend",
                "stateBucket": "online",
                "patch": {}
            }]
        }),
    );
}

#[test]
fn prefetch_online_friend_avatars_ignores_non_online_buckets() {
    let (_dir, services) = test_services("prefetch-non-online-bucket");

    services.observe_runtime_event(
        "realtimeFriendProjection",
        &json!({
            "patches": [{
                "userId": "usr_friend",
                "stateBucket": "active",
                "patch": {}
            }]
        }),
    );
}

#[test]
fn prefetch_online_friend_avatars_skips_bulk_baseline_projections() {
    let (_dir, services) = test_services("prefetch-bulk-baseline");
    let patches = (0..64)
        .map(|index| {
            json!({
                "userId": format!("usr_friend_{index}"),
                "stateBucket": "online",
                "patch": {}
            })
        })
        .collect::<Vec<_>>();

    services.observe_runtime_event("realtimeFriendProjection", &json!({ "patches": patches }));
}
