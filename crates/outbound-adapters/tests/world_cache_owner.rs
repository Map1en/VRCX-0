use std::{path::PathBuf, sync::Arc, time::Duration};

use vrcx_0_application::collections::SharedCollectionImportActionsFactory;
use vrcx_0_application::favorites::FavoriteRemote;
use vrcx_0_application_core::{
    NoopWebClientPort, RuntimeDiagnostics, RuntimeSyncEngine, WebClient, WorldCache,
};
use vrcx_0_persistence::DatabaseService;

const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

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
            "vrcx0-world-cache-owner-{name}-{}-{nonce}",
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

struct Services {
    _dir: TestDir,
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
}

fn services(name: &str) -> Services {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let web = Arc::new(WebClient::new(NoopWebClientPort));
    let world_cache = Arc::new(WorldCache::new(
        vrcx_0_outbound_adapters::LocalWorldCacheAdapter::new(
            Arc::clone(&db),
            Arc::clone(&web),
            8,
            Duration::from_secs(60),
        ),
    ));
    Services {
        _dir: dir,
        db,
        web,
        world_cache,
    }
}

async fn assert_world_lookup_failure_was_recorded(services: &Services, world_id: &str) {
    let error = services
        .world_cache
        .get(ENDPOINT, world_id, false, false)
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("recently failed"),
        "unexpected error: {error}"
    );
}

#[tokio::test]
async fn favorite_world_lookups_go_through_the_world_cache_owner() {
    let services = services("favorite-remote");
    let remote = vrcx_0_outbound_adapters::VrchatFavoriteRemote::new(
        Arc::clone(&services.web),
        RuntimeDiagnostics::new(),
        RuntimeSyncEngine::new(),
        Arc::clone(&services.world_cache),
    );

    assert!(remote
        .world(ENDPOINT.into(), "wrld_favorite".into())
        .await
        .is_err());

    assert_world_lookup_failure_was_recorded(&services, "wrld_favorite").await;
}

#[tokio::test]
async fn shared_collection_world_fetches_go_through_the_world_cache_owner() {
    let services = services("shared-collection");
    let actions = vrcx_0_outbound_adapters::LocalSharedCollectionImportActionsFactory::new(
        Arc::clone(&services.db),
        Arc::clone(&services.world_cache),
    )
    .create(ENDPOINT.into());

    assert!(actions.fetch_and_cache_world("wrld_shared").await.is_err());

    assert_world_lookup_failure_was_recorded(&services, "wrld_shared").await;
}
