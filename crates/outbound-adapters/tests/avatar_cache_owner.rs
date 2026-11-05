use std::{path::PathBuf, sync::Arc, time::Duration};

use serde_json::{json, Value};
use vrcx_0_application::favorites::{
    persist_favorite_cache_snapshot, FavoriteCacheKind, FavoriteCacheSnapshotInput,
};
use vrcx_0_application_core::{
    AvatarCache, MemoryWorldCachePort, NoopWebClientPort, WebClient, WorldCache,
};
use vrcx_0_core::json::RawJson;
use vrcx_0_outbound_adapters::LocalAvatarCacheAdapter;
use vrcx_0_persistence::DatabaseService;

const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";
const AVATAR_ID: &str = "avtr_12345678-1234-1234-1234-1234567890ab";

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn public_avatar(name: &str) -> Value {
    json!({
        "id": AVATAR_ID,
        "name": name,
        "authorId": "usr_author",
        "releaseStatus": "public",
        "thumbnailImageUrl": "https://example.test/avatar.png"
    })
}

#[test]
fn favorite_avatar_snapshots_refresh_the_avatar_cache_owner() {
    let dir = TestDir::new("avatar-cache-owner-snapshot");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let avatar_cache = AvatarCache::new(LocalAvatarCacheAdapter::new(
        Arc::clone(&db),
        Arc::new(WebClient::new(NoopWebClientPort)),
        16,
        Duration::from_secs(600),
    ));
    let world_cache = WorldCache::new(MemoryWorldCachePort::default());
    let persist = |avatar: Value| {
        persist_favorite_cache_snapshot(
            &world_cache,
            &avatar_cache,
            "usr_self",
            ENDPOINT,
            FavoriteCacheSnapshotInput {
                kind: FavoriteCacheKind::Avatar,
                entity: RawJson::from(avatar),
                fallback_entity_id: String::new(),
            },
        )
        .unwrap()
    };
    let cached_name = || {
        avatar_cache
            .get_summary("usr_self", ENDPOINT, AVATAR_ID)
            .unwrap()
            .unwrap()
            .name
    };

    assert!(persist(public_avatar("Old name")));
    assert_eq!(cached_name(), "Old name");
    assert!(persist(public_avatar("New name")));

    assert_eq!(cached_name(), "New name");
}
