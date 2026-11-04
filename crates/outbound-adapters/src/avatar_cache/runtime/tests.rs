use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use vrcx_0_persistence::avatars::{avatar_cache_get, avatar_cache_remove, avatar_cache_upsert};
use vrcx_0_persistence::cache_entities::CacheEntityInput;
use vrcx_0_persistence::DatabaseService;

use super::AvatarCache;

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
            "vrcx-0-avatar-cache-{name}-{}-{nonce}",
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

fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    (dir, db)
}

fn test_cache(dir: &TestDir, db: &Arc<DatabaseService>, capacity: u64) -> AvatarCache {
    let storage =
        vrcx_0_persistence::storage::StorageService::new(&dir.path.join("storage.json")).unwrap();
    let web = vrcx_0_application_core::WebClient::new(
        crate::LocalWebClientAdapter::new(
            &storage,
            Arc::clone(db),
            "wss://pipeline.vrchat.cloud".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    );
    AvatarCache::new(
        Arc::clone(db),
        Arc::new(web),
        capacity,
        Duration::from_secs(60),
    )
}

fn avatar_entry(id: &str, name: &str) -> CacheEntityInput {
    CacheEntityInput {
        id: json!(id),
        author_id: json!("usr_author"),
        author_name: json!("Author"),
        created_at: json!("2026-01-01T00:00:00.000Z"),
        description: json!("Description"),
        image_url: json!(format!("https://example.test/file/file_{id}/1/file")),
        name: json!(name),
        release_status: json!("public"),
        thumbnail_image_url: json!("thumb.png"),
        updated_at: json!("2026-01-02T00:00:00.000Z"),
        version: json!(1),
    }
}

#[test]
fn summary_lookup_starts_empty_then_loads_one_db_row_into_memory() {
    let (dir, db) = test_db("summary-db-fallback");
    avatar_cache_upsert(db.as_ref(), avatar_entry("avtr_db", "DB Avatar")).unwrap();
    let cache = test_cache(&dir, &db, 8);

    assert!(cache
        .working_value(
            "usr_self",
            "https://api.example.test/api/1",
            "avtr_db",
            false
        )
        .is_none());

    let summary = cache
        .get_summary("usr_self", "https://api.example.test/api/1", "avtr_db")
        .unwrap()
        .expect("DB row should load on demand");

    assert_eq!(summary.name, "DB Avatar");
    avatar_cache_remove(db.as_ref(), "avtr_db".into()).unwrap();
    assert_eq!(
        cache
            .get_summary("usr_self", "https://api.example.test/api/1", "avtr_db")
            .unwrap()
            .expect("working cache should serve the removed DB row")
            .name,
        "DB Avatar"
    );
}

#[test]
fn full_reads_do_not_treat_db_summaries_as_complete_api_payloads() {
    let (dir, db) = test_db("summary-is-not-full");
    avatar_cache_upsert(db.as_ref(), avatar_entry("avtr_db", "DB Avatar")).unwrap();
    let cache = test_cache(&dir, &db, 8);

    cache
        .get_summary("usr_self", "https://api.example.test/api/1", "avtr_db")
        .unwrap();

    assert!(cache
        .working_value(
            "usr_self",
            "https://api.example.test/api/1",
            "avtr_db",
            true
        )
        .is_none());
}

#[tokio::test]
async fn ordinary_resolution_uses_db_before_remote_api() {
    let (dir, db) = test_db("db-before-api");
    avatar_cache_upsert(db.as_ref(), avatar_entry("avtr_db", "DB Avatar")).unwrap();
    let cache = test_cache(&dir, &db, 8);

    let avatar = cache
        .resolve(
            "usr_self",
            "http://127.0.0.1:9/api/1",
            "avtr_db",
            false,
            false,
        )
        .await
        .unwrap()
        .expect("DB summary should resolve without remote API");

    assert_eq!(
        avatar.get("name").and_then(Value::as_str),
        Some("DB Avatar")
    );
}

#[test]
fn full_api_payloads_are_scoped_to_the_authenticated_user() {
    let (dir, db) = test_db("auth-scoped-full-payload");
    let cache = test_cache(&dir, &db, 8);
    cache.hydrate_from_payload(
        "usr_first",
        "https://api.example.test/api/1",
        json!({
            "id": "avtr_private",
            "name": "Private Avatar",
            "releaseStatus": "private",
            "unityPackages": []
        }),
    );

    assert!(cache
        .working_value(
            "usr_first",
            "https://api.example.test/api/1",
            "avtr_private",
            true
        )
        .is_some());
    assert!(cache
        .working_value(
            "usr_second",
            "https://api.example.test/api/1",
            "avtr_private",
            true
        )
        .is_none());
}

#[test]
fn api_payload_is_bounded_in_moka_and_persists_only_the_summary() {
    let (dir, db) = test_db("bounded-api-payload");
    let cache = test_cache(&dir, &db, 1);

    for (id, name) in [("avtr_first", "First"), ("avtr_second", "Second")] {
        cache.hydrate_from_payload(
            "usr_self",
            "https://api.example.test/api/1",
            json!({
                "id": id,
                "name": name,
                "authorId": "usr_author",
                "authorName": "Author",
                "releaseStatus": "public",
                "imageUrl": "image.png",
                "unityPackages": [{ "assetUrl": "https://example.test/large.bundle" }]
            }),
        );
    }
    cache.run_pending_tasks();

    assert!(cache.entry_count() <= 1);
    let persisted = avatar_cache_get(db.as_ref(), "avtr_second".into())
        .unwrap()
        .expect("summary should be persisted");
    assert_eq!(persisted.name, "Second");
    let retained_full_payload = ["avtr_first", "avtr_second"]
        .into_iter()
        .find_map(|avatar_id| {
            cache.working_value(
                "usr_self",
                "https://api.example.test/api/1",
                avatar_id,
                true,
            )
        });
    assert!(retained_full_payload.is_some());
}
