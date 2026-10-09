use super::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use rusqlite::Connection;
use serde_json::json;
use vrcx_0_persistence::cache_entities::CacheEntityInput;
use vrcx_0_persistence::worlds::{world_cache_get, world_cache_upsert};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("vrcx-0-world-cache-{name}-{nonce}"));
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

fn test_web(dir: &TestDir, db: &Arc<DatabaseService>) -> WebClient {
    let storage =
        vrcx_0_persistence::storage::StorageService::new(&dir.path.join("storage.json")).unwrap();
    WebClient::new(
        crate::LocalWebClientAdapter::new(
            &storage,
            Arc::clone(db),
            "wss://pipeline.vrchat.cloud".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    )
}

fn world_entry(id: &str, name: &str, updated_at: &str) -> CacheEntityInput {
    CacheEntityInput {
        id: json!(id),
        author_id: json!(null),
        author_name: json!(null),
        created_at: json!("2026-01-01T00:00:00.000Z"),
        description: json!(null),
        image_url: json!("image.png"),
        name: json!(name),
        release_status: json!("public"),
        thumbnail_image_url: json!("thumb.png"),
        updated_at: json!(updated_at),
        version: json!(1),
    }
}

#[test]
fn hydrate_from_payload_caches_bounded_card_fields_and_persists_summary() {
    let (_dir, db) = test_db("hydrate-name-only");
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    let name = cache.hydrate_from_payload(&json!({
        "id": "wrld_heavy",
        "name": "Heavy World",
        "authorId": "usr_author",
        "authorName": "Author",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "description": "Summary detail",
        "imageUrl": "image.png",
        "releaseStatus": "public",
        "thumbnailImageUrl": "thumb.png",
        "updatedAt": "2026-01-02T00:00:00.000Z",
        "version": 7,
        "unityPackages": [{ "assetUrl": "https://example.test/large.bundle" }],
        "instances": [["123", 4]],
        "tags": ["author_tag_large"]
    }));

    assert_eq!(name.as_deref(), Some("Heavy World"));
    assert_eq!(cache.get_name("wrld_heavy").as_deref(), Some("Heavy World"));
    assert_eq!(
        cache
            .working
            .get("wrld_heavy")
            .map(|world| world.summary.name.clone())
            .as_deref(),
        Some("Heavy World")
    );
    let card = cache.get_cached_card_payload("wrld_heavy").unwrap();
    assert_eq!(card["tags"], json!(["author_tag_large"]));
    assert!(card.get("unityPackages").is_none());
    assert!(card.get("instances").is_none());
    cache.search_summaries("Heavy", 10).unwrap();
    assert_eq!(
        cache.get_cached_card_payload("wrld_heavy").unwrap()["tags"],
        json!(["author_tag_large"])
    );

    let row = world_cache_get(db.as_ref(), "wrld_heavy".into())
        .unwrap()
        .unwrap();
    assert_eq!(row.name, "Heavy World");
    assert_eq!(row.description, "Summary detail");
    assert_eq!(row.version, 7);
}

#[test]
fn favorite_hydrate_overwrites_existing_cache_with_private_summary() {
    let (_dir, db) = test_db("favorite-private-summary");
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));
    let private_world = json!({
        "id": "wrld_private",
        "name": "Private World",
        "imageUrl": "private.png",
        "releaseStatus": "private"
    });

    cache.hydrate_favorite_payloads([&private_world]);
    assert_eq!(
        world_cache_get(db.as_ref(), "wrld_private".into())
            .unwrap()
            .unwrap()
            .name,
        "Private World"
    );

    world_cache_upsert(
        db.as_ref(),
        world_entry("wrld_private", "Existing World", "2026-01-02T00:00:00.000Z"),
    )
    .unwrap();
    cache.hydrate_favorite_payloads([&private_world]);

    assert_eq!(
        world_cache_get(db.as_ref(), "wrld_private".into())
            .unwrap()
            .unwrap()
            .name,
        "Private World"
    );
}

#[test]
fn unavailable_world_responses_never_overwrite_existing_cache() {
    let (_dir, db) = test_db("unavailable-preserves-cache");
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));
    world_cache_upsert(
        db.as_ref(),
        world_entry("wrld_gone", "Existing World", "2026-01-02T00:00:00.000Z"),
    )
    .unwrap();

    cache.hydrate_response(&execute_response(
        404,
        json!({ "error": { "message": "World not found", "status_code": 404 } }).to_string(),
    ));
    cache.hydrate_favorite_payloads([&json!({
        "id": "wrld_gone",
        "name": "",
        "imageUrl": "",
        "releaseStatus": "private"
    })]);
    cache.hydrate_from_payload(&json!({
        "id": "wrld_gone",
        "name": "wrld_gone",
        "releaseStatus": "private"
    }));

    let row = world_cache_get(db.as_ref(), "wrld_gone".into())
        .unwrap()
        .unwrap();
    assert_eq!(row.name, "Existing World");
    assert_eq!(row.image_url, "image.png");
    assert_eq!(
        cache.get_summary("wrld_gone").unwrap().unwrap().name,
        "Existing World"
    );
}

#[test]
fn hydrate_from_vrchat_payload_preserves_snake_case_timestamps() {
    let (_dir, db) = test_db("hydrate-vrchat-timestamps");
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    cache.hydrate_from_payload(&json!({
        "id": "wrld_timestamps",
        "name": "Timestamped World",
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-02T00:00:00.000Z",
        "releaseStatus": "public",
        "imageUrl": "image.png"
    }));

    let row = world_cache_get(db.as_ref(), "wrld_timestamps".into())
        .unwrap()
        .unwrap();
    assert_eq!(row.created_at, "2026-01-01T00:00:00.000Z");
    assert_eq!(row.updated_at, "2026-01-02T00:00:00.000Z");
}

#[test]
fn summary_lookup_starts_empty_then_loads_db_row_into_memory() {
    let (_dir, db) = test_db("summary-db-fallback");
    world_cache_upsert(
        db.as_ref(),
        world_entry("wrld_db_only", "DB Only World", "2026-01-02T00:00:00.000Z"),
    )
    .unwrap();
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    assert_eq!(cache.get_name("wrld_db_only"), None);

    let summary = cache
        .get_summary("wrld_db_only")
        .unwrap()
        .expect("DB row should be loaded on demand");

    assert_eq!(summary.name, "DB Only World");
    world_cache_upsert(
        db.as_ref(),
        world_entry(
            "wrld_db_only",
            "Rewritten World",
            "2026-01-03T00:00:00.000Z",
        ),
    )
    .unwrap();
    let memory_summary = cache
        .get_summary("wrld_db_only")
        .unwrap()
        .expect("memory hit should not query the rewritten DB row");
    assert_eq!(memory_summary.name, "DB Only World");
    assert_eq!(
        cache.get_name("wrld_db_only").as_deref(),
        Some("DB Only World")
    );
}

#[test]
fn summary_lookup_ignores_invalid_db_shells() {
    let (_dir, db) = test_db("summary-invalid-shell");
    world_cache_upsert(
        db.as_ref(),
        world_entry("wrld_shell", "", "2026-01-02T00:00:00.000Z"),
    )
    .unwrap();
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    assert!(cache.get_summary("wrld_shell").unwrap().is_none());
    assert_eq!(cache.get_name("wrld_shell"), None);
}

#[tokio::test]
async fn summary_resolution_uses_db_before_remote_api() {
    let (dir, db) = test_db("summary-db-before-api");
    world_cache_upsert(
        db.as_ref(),
        world_entry(
            "wrld_db_first",
            "DB First World",
            "2026-01-02T00:00:00.000Z",
        ),
    )
    .unwrap();
    let web = test_web(&dir, &db);
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    let summary = cache
        .resolve_summary(&web, "http://127.0.0.1:9/api/1", "wrld_db_first")
        .await
        .expect("DB row should resolve without remote API");

    assert_eq!(summary.name, "DB First World");
}

#[tokio::test]
async fn ordinary_get_returns_db_summary_without_remote_api() {
    let (dir, db) = test_db("get-db-before-api");
    world_cache_upsert(
        db.as_ref(),
        world_entry("wrld_db_get", "DB Get World", "2026-01-02T00:00:00.000Z"),
    )
    .unwrap();
    let web = test_web(&dir, &db);
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    let response = cache
        .get(
            &web,
            "http://127.0.0.1:9/api/1",
            "wrld_db_get",
            false,
            false,
        )
        .await
        .expect("ordinary get should use the DB summary");
    let payload = serde_json::from_str::<Value>(&response.data).unwrap();

    assert_eq!(response.status, 200);
    assert_eq!(payload["name"], "DB Get World");
}

#[tokio::test]
async fn image_resolution_prefers_memory_thumbnail() {
    let (dir, db) = test_db("image-memory");
    let web = test_web(&dir, &db);
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));
    cache.hydrate_from_payload(&json!({
        "id": "wrld_memory_image",
        "name": "Memory World",
        "releaseStatus": "public",
        "imageUrl": "image.png",
        "thumbnailImageUrl": "thumb.png"
    }));

    assert_eq!(
        cache
            .resolve_image_url(&web, "http://127.0.0.1:9/api/1", "wrld_memory_image")
            .await
            .as_deref(),
        Some("thumb.png")
    );
}

#[tokio::test]
async fn image_resolution_accepts_partial_db_row_without_world_name() {
    let (dir, db) = test_db("image-partial-db");
    world_cache_upsert(
        db.as_ref(),
        world_entry("wrld_partial_image", "", "2026-01-02T00:00:00.000Z"),
    )
    .unwrap();
    let web = test_web(&dir, &db);
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    assert_eq!(
        cache
            .resolve_image_url(&web, "http://127.0.0.1:9/api/1", "wrld_partial_image")
            .await
            .as_deref(),
        Some("thumb.png")
    );
    assert_eq!(cache.get_name("wrld_partial_image"), None);
}

#[tokio::test]
async fn concurrent_image_resolution_fetches_world_once() {
    let (_dir, db) = test_db("image-single-flight");
    let cache = WorldCache::new(db, 8, Duration::from_secs(60));
    let calls = Arc::new(AtomicUsize::new(0));
    let body = json!({
        "id": "wrld_single_flight",
        "name": "Single Flight World",
        "releaseStatus": "public",
        "imageUrl": "image.png",
        "thumbnailImageUrl": "thumb.png"
    })
    .to_string();

    let first_calls = Arc::clone(&calls);
    let first_body = body.clone();
    let first = cache.resolve_image_url_with(
        "https://api.vrchat.cloud/api/1",
        "wrld_single_flight",
        move |endpoint, world_id| async move {
            assert_eq!(endpoint, "https://api.vrchat.cloud/api/1");
            assert_eq!(world_id, "wrld_single_flight");
            first_calls.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(25)).await;
            Ok(execute_response(200, first_body))
        },
    );
    let second_calls = Arc::clone(&calls);
    let second = cache.resolve_image_url_with(
        "https://api.vrchat.cloud/api/1/",
        "wrld_single_flight",
        move |_, _| async move {
            second_calls.fetch_add(1, Ordering::SeqCst);
            Ok(execute_response(200, body))
        },
    );

    let (first_image, second_image) = tokio::join!(first, second);

    assert_eq!(first_image.as_deref(), Some("thumb.png"));
    assert_eq!(second_image.as_deref(), Some("thumb.png"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn image_resolution_respects_failure_cooldown() {
    let (_dir, db) = test_db("image-failure-cooldown");
    let cache = WorldCache::new(db, 8, Duration::from_secs(60));
    let calls = Arc::new(AtomicUsize::new(0));
    let first_calls = Arc::clone(&calls);

    let first = cache
        .resolve_image_url_with(
            "https://api.vrchat.cloud/api/1",
            "wrld_failure_cooldown",
            move |_, _| async move {
                first_calls.fetch_add(1, Ordering::SeqCst);
                Err(crate::Error::Custom("remote world lookup failed".into()))
            },
        )
        .await;
    let second_calls = Arc::clone(&calls);
    let second = cache
        .resolve_image_url_with(
            "https://api.vrchat.cloud/api/1",
            "wrld_failure_cooldown",
            move |_, _| async move {
                second_calls.fetch_add(1, Ordering::SeqCst);
                Ok(execute_response(
                    200,
                    json!({
                        "id": "wrld_failure_cooldown",
                        "name": "Unexpected Retry",
                        "releaseStatus": "public",
                        "imageUrl": "unexpected.png"
                    })
                    .to_string(),
                ))
            },
        )
        .await;

    assert!(first.is_none());
    assert!(second.is_none());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn force_get_bypasses_cached_summary_and_preserves_it_on_failure() {
    let (dir, db) = test_db("force-bypasses-cache");
    world_cache_upsert(
        db.as_ref(),
        world_entry("wrld_force", "Cached World", "2026-01-02T00:00:00.000Z"),
    )
    .unwrap();
    let web = test_web(&dir, &db);
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    assert!(cache
        .get(&web, "http://127.0.0.1:9/api/1", "wrld_force", true, false,)
        .await
        .is_err());
    assert_eq!(
        cache.get_summary("wrld_force").unwrap().unwrap().name,
        "Cached World"
    );
}

#[test]
fn successful_remote_response_refreshes_memory_and_database_summary() {
    let (_dir, db) = test_db("hydrate-response");
    world_cache_upsert(
        db.as_ref(),
        world_entry("wrld_refresh", "Old World", "2026-01-02T00:00:00.000Z"),
    )
    .unwrap();
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    cache.hydrate_response(&execute_response(
        200,
        json!({
            "id": "wrld_refresh",
            "name": "Fresh World",
            "releaseStatus": "public",
            "imageUrl": "fresh.png"
        })
        .to_string(),
    ));

    assert_eq!(
        cache.get_name("wrld_refresh").as_deref(),
        Some("Fresh World")
    );
    assert_eq!(
        cache
            .working
            .get("wrld_refresh")
            .and_then(|world| summary_image_url(&world.summary))
            .as_deref(),
        Some("fresh.png")
    );
    assert_eq!(
        world_cache_get(db.as_ref(), "wrld_refresh".into())
            .unwrap()
            .unwrap()
            .name,
        "Fresh World"
    );
}

#[test]
fn resolve_guards_are_scoped_by_normalized_endpoint() {
    let (_dir, db) = test_db("endpoint-scoped-guards");
    let cache = WorldCache::new(db, 8, Duration::from_secs(60));
    let world_id = "wrld_shared";

    let first = resolve_key(" https://one.example/api/1/ ", world_id);
    let same = resolve_key("https://one.example/api/1", world_id);
    let other = resolve_key("https://two.example/api/1", world_id);

    cache.record_failure(&first);
    assert!(cache.recently_failed(&same));
    assert!(!cache.recently_failed(&other));

    let first_lock = cache.inflight_lock(&first);
    let same_lock = cache.inflight_lock(&same);
    let other_lock = cache.inflight_lock(&other);
    assert!(Arc::ptr_eq(&first_lock, &same_lock));
    assert!(!Arc::ptr_eq(&first_lock, &other_lock));
}

#[test]
fn failure_cache_is_bounded() {
    let (_dir, db) = test_db("bounded-failures");
    let cache = WorldCache::new(db, 8, Duration::from_secs(60));

    for index in 0..WORLD_RESOLVE_FAILURE_CAPACITY * 2 {
        cache.record_failure(&resolve_key(
            "https://api.example/api/1",
            &format!("wrld_{index}"),
        ));
    }
    cache.failures.run_pending_tasks();

    assert!(cache.failures.entry_count() <= WORLD_RESOLVE_FAILURE_CAPACITY);
}

#[test]
fn hidden_worlds_are_cached_in_memory_but_never_persisted_to_disk() {
    let (_dir, db) = test_db("hidden-not-persisted");
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));
    let hidden_world = json!({
        "id": "wrld_hidden",
        "name": "Hidden World",
        "imageUrl": "hidden.png",
        "releaseStatus": "hidden"
    });

    let name = cache.hydrate_from_payload(&hidden_world);

    assert_eq!(name.as_deref(), Some("Hidden World"));
    assert_eq!(
        cache.get_name("wrld_hidden").as_deref(),
        Some("Hidden World")
    );
    assert!(world_cache_get(db.as_ref(), "wrld_hidden".into())
        .unwrap()
        .is_none());

    cache.hydrate_favorite_payloads([&hidden_world]);

    assert!(
        world_cache_get(db.as_ref(), "wrld_hidden".into())
            .unwrap()
            .is_none(),
        "hidden worlds are not favoritable and must stay out of the persistent cache"
    );
}

#[test]
fn unrecognized_release_status_worlds_are_never_persisted() {
    let (_dir, db) = test_db("unknown-status-not-persisted");
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    cache.hydrate_from_payload(&json!({
        "id": "wrld_future",
        "name": "Future World",
        "imageUrl": "future.png",
        "releaseStatus": "future"
    }));

    assert!(world_cache_get(db.as_ref(), "wrld_future".into())
        .unwrap()
        .is_none());
}

#[test]
fn capacity_bounds_every_hydrated_world() {
    let (_dir, db) = test_db("bounded-summaries");
    let cache = WorldCache::new(Arc::clone(&db), 1, Duration::from_secs(60));
    cache.hydrate_from_payload(&json!({
        "id": "wrld_first",
        "name": "First World",
        "releaseStatus": "public",
        "imageUrl": "image.png"
    }));
    cache.hydrate_from_payload(&json!({
        "id": "wrld_second",
        "name": "Second World",
        "releaseStatus": "public",
        "imageUrl": "image.png"
    }));
    cache.working.run_pending_tasks();

    assert!(cache.working.entry_count() <= 1);
}

#[test]
fn failed_database_upserts_retry_the_latest_payload_per_world() {
    let (_dir, db) = test_db("locked-write-retry");
    world_cache_upsert(db.as_ref(), world_entry("wrld_retry", "Seed", "old")).unwrap();
    let direct = Connection::open(db.db_path()).unwrap();
    direct
        .execute_batch(
            "CREATE TRIGGER fail_world_cache BEFORE INSERT ON cache_world BEGIN SELECT RAISE(ABORT, 'retry'); END",
        )
        .unwrap();
    let cache = WorldCache::new(Arc::clone(&db), 8, Duration::from_secs(60));

    cache.hydrate_from_payload(&json!({
        "id": "wrld_retry",
        "name": "First update",
        "updated_at": "2026-10-01T00:00:00.000Z",
        "imageUrl": "first.png",
        "releaseStatus": "public"
    }));
    cache.hydrate_from_payload(&json!({
        "id": "wrld_retry",
        "name": "Latest update",
        "updated_at": "2026-10-02T00:00:00.000Z",
        "imageUrl": "latest.png",
        "releaseStatus": "public"
    }));
    assert_eq!(
        cache.pending_writes.entries.lock().unwrap().len(),
        1,
        "failed writes keep only the latest payload for a world"
    );

    direct
        .execute_batch("DROP TRIGGER fail_world_cache")
        .unwrap();
    for _ in 0..100 {
        if world_cache_get(db.as_ref(), "wrld_retry".into())
            .unwrap()
            .is_some_and(|summary| summary.name == "Latest update")
        {
            drop(direct);
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("world cache retry worker did not persist the latest payload");
}
