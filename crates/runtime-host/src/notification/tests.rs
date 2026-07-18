use std::{path::PathBuf, sync::Arc};

use serde_json::json;
use vrcx_0_application_activity::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityDelivery, OverlayActivityEntry,
};
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

use super::{
    config_tts_name_mode, delivery_actor_image_user_id, generic_webhook_payload,
    parse_webhook_fields, resolve_delivery_actor_image, RealtimeUserImageResolverSlot,
    RenderedNotification, UserImageCache,
};

#[test]
fn generic_webhook_payload_exposes_location_id_and_local_time() {
    let payload = generic_webhook_payload(
        &delivery(),
        &rendered(),
        &["location".into(), "locationId".into(), "localTime".into()],
    );

    assert_eq!(
        payload.get("location").and_then(|value| value.as_str()),
        Some("Named World public")
    );
    assert_eq!(
        payload.get("locationId").and_then(|value| value.as_str()),
        Some("wrld_named:123")
    );
    let local_time = payload
        .get("localTime")
        .and_then(|value| value.as_str())
        .expect("localTime");
    assert_eq!(local_time.len(), "2026-06-18 17:30:00".len());
    assert!(payload.get("timestamp").is_none());
    assert!(payload.get("worldName").is_none());
}

#[test]
fn generic_webhook_fields_ignore_localized_names() {
    let fields = parse_webhook_fields(r#"["locationId","位置","タイトル"]"#);
    let payload = generic_webhook_payload(&delivery(), &rendered(), &fields);

    assert_eq!(payload.as_object().unwrap().len(), 1);
    assert_eq!(
        payload.get("locationId").and_then(|value| value.as_str()),
        Some("wrld_named:123")
    );
    assert!(payload.get("位置").is_none());
    assert!(payload.get("タイトル").is_none());
}

#[test]
fn notification_tts_name_mode_preserves_legacy_nickname_setting() {
    let (_dir, db) = test_db("tts-name-mode-legacy");
    let config = ConfigRepository::new(Arc::new(db));

    config.set_bool("notificationTTSNickName", true).unwrap();
    assert_eq!(config_tts_name_mode(&config), "note");

    config
        .set_string("notificationTTSNameMode", "usernameAndNote")
        .unwrap();
    assert_eq!(config_tts_name_mode(&config), "usernameAndNote");
}

#[test]
fn delivery_actor_image_user_id_skips_current_user_actor() {
    let mut delivery = delivery();
    delivery.entry.actor_user_id = "usr_self".into();

    assert_eq!(delivery_actor_image_user_id(&delivery, "usr_self"), None);

    delivery.entry.actor_user_id = "usr_sender".into();
    assert_eq!(
        delivery_actor_image_user_id(&delivery, "usr_self"),
        Some("usr_sender")
    );

    delivery.entry.content.image_url = "https://images.example/existing.png".into();
    assert_eq!(delivery_actor_image_user_id(&delivery, "usr_self"), None);
}

fn rendered() -> RenderedNotification {
    RenderedNotification {
        title: "Traveler".into(),
        body: "joined Named World".into(),
        text: "Traveler joined Named World".into(),
        display_location: "Named World public".into(),
        image_url: String::new(),
    }
}

fn delivery() -> OverlayActivityDelivery {
    OverlayActivityDelivery {
        entry: OverlayActivityEntry {
            sequence: 1,
            source_id: "game-log:join".into(),
            activity_type: "OnPlayerJoined".into(),
            category: OverlayActivityCategory::CurrentInstance,
            created_at: "2026-06-18T08:30:00.000Z".into(),
            actor_user_id: "usr_traveler".into(),
            actor_display_name: "Traveler".into(),
            content: OverlayActivityContent {
                location: "wrld_named:123".into(),
                world_id: "wrld_named".into(),
                display_location: "Named World public".into(),
                world_name: "Named World".into(),
                ..OverlayActivityContent::default()
            },
            actor_relation: OverlayActivityActorRelation::None,
            payload: json!({}),
        },
        desktop: false,
        vr: false,
        hmd: false,
        webhook: true,
        tts: false,
    }
}

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
            "vrcx-0-notification-{name}-{}-{nonce}",
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

fn test_db(name: &str) -> (TestDir, DatabaseService) {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
    (dir, db)
}

fn test_realtime_runtime(
    name: &str,
) -> (
    TestDir,
    Arc<vrcx_0_application_realtime::RealtimeHostRuntime>,
    Arc<DatabaseService>,
    Arc<vrcx_0_application_core::WebClient>,
) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let storage =
        vrcx_0_persistence::storage::StorageService::new(&dir.path.join("storage.json")).unwrap();
    let web = Arc::new(
        vrcx_0_application_core::WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    );
    let world_cache = Arc::new(vrcx_0_application_core::WorldCache::new(
        Arc::clone(&db),
        512,
        std::time::Duration::from_secs(30 * 60),
    ));
    let runtime = Arc::new(vrcx_0_application_realtime::RealtimeHostRuntime::new(
        vrcx_0_application_realtime::RealtimeHostRuntimeDeps {
            db: Arc::clone(&db),
            web: Arc::clone(&web),
            event_bus: vrcx_0_application_core::RuntimeEventBus::new(),
            sync: vrcx_0_application_core::RuntimeSyncEngine::new(),
            tasks: vrcx_0_application_core::TaskSupervisor::new(),
            session: vrcx_0_application_core::HostSessionRuntime::new(),
            auth_scope: vrcx_0_application_core::RuntimeAuthScope::new(),
            local_game_context: Arc::new(
                vrcx_0_application_core::UnavailableLocalGameContextSource,
            ),
            activity_sink: None,
            world_cache,
            print_cleanup: Arc::new(vrcx_0_application_core::NoopPrintCleanupInputSink),
            friend_note_change_sink: None,
        },
    ));
    (dir, runtime, db, web)
}

#[tokio::test]
async fn resolve_delivery_actor_image_prefers_realtime_cache_over_api_fallback() {
    let (_dir, runtime, db, web) = test_realtime_runtime("actor-image-cache-hit");
    let endpoint = "https://api.vrchat.cloud/api/1";
    runtime.record_user_profile(
        endpoint,
        &json!({
            "id": "usr_traveler",
            "displayName": "Traveler",
            "userIcon": "https://api.vrchat.cloud/api/1/file/file_1234abcd-0000-1111-2222-abcdefabcdef/2/file",
        }),
    );
    let resolver = RealtimeUserImageResolverSlot::default();
    resolver.set(Arc::clone(&runtime));
    let user_image_cache = UserImageCache::new();
    let mut sample = delivery();
    sample.entry.actor_user_id = "usr_traveler".into();

    let image_url = resolve_delivery_actor_image(
        &user_image_cache,
        web.as_ref(),
        db.as_ref(),
        endpoint,
        true,
        "usr_self",
        &resolver,
        &sample,
    )
    .await;

    assert_eq!(
        image_url.as_deref(),
        Some(
            "https://api.vrchat.cloud/api/1/image/file_1234abcd-0000-1111-2222-abcdefabcdef/2/128"
        )
    );
}

#[tokio::test]
async fn resolve_delivery_actor_image_falls_back_to_none_when_uncached_and_endpoint_missing() {
    let (_dir, _runtime, db, web) = test_realtime_runtime("actor-image-cache-miss");
    let resolver = RealtimeUserImageResolverSlot::default();
    let user_image_cache = UserImageCache::new();

    let image_url = resolve_delivery_actor_image(
        &user_image_cache,
        web.as_ref(),
        db.as_ref(),
        "",
        true,
        "usr_self",
        &resolver,
        &delivery(),
    )
    .await;

    assert_eq!(image_url, None);
}
