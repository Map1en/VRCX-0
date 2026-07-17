use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde_json::json;
use vrcx_0_application::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityDelivery, OverlayActivityEntry, OverlayActivityText,
};
use vrcx_0_i18n::OverlayMessage;
use vrcx_0_persistence::{config::ConfigRepository, memos::memo_save_user, DatabaseService};

use crate::notification::user_image::UserImageCache;
use crate::vr_overlay::OverlayLocale;

use super::{
    config_tts_name_mode, delivery_actor_image_user_id, generic_webhook_payload,
    notification_tts_text, overlay_notification_render, parse_webhook_fields, render_delivery,
    resolve_delivery_actor_image, NotificationDeliveryPreferences, RealtimeUserImageResolverSlot,
};
use crate::notification::rendered::RenderedNotification;

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
fn overlay_notification_render_uses_app_title_and_combined_text() {
    let render = rendered();

    let overlay = overlay_notification_render(&render);

    assert_eq!(overlay.title, "VRCX-0");
    assert_eq!(overlay.text, "Traveler joined Named World");
    assert_eq!(render.title, "Traveler");
}

#[test]
fn notification_tts_note_mode_replaces_only_first_title() {
    let (_dir, db) = test_db("tts-note-mode");
    memo_save_user(&db, "usr_traveler".into(), "Pilot\nsecond line".into()).unwrap();
    let preferences = NotificationDeliveryPreferences {
        notification_tts_name_mode: "note".into(),
        ..NotificationDeliveryPreferences::default()
    };
    let mut render = rendered();
    render.text = "Traveler waved at Traveler".into();

    assert_eq!(
        notification_tts_text(&db, &delivery(), &render, &preferences, OverlayLocale::En),
        "Pilot waved at Traveler"
    );
}

#[test]
fn notification_tts_username_and_note_mode_reads_both() {
    let (_dir, db) = test_db("tts-username-and-note-mode");
    memo_save_user(&db, "usr_traveler".into(), "Pilot".into()).unwrap();
    let preferences = NotificationDeliveryPreferences {
        notification_tts_name_mode: "usernameAndNote".into(),
        ..NotificationDeliveryPreferences::default()
    };

    assert_eq!(
        notification_tts_text(
            &db,
            &delivery(),
            &rendered(),
            &preferences,
            OverlayLocale::En
        ),
        "Traveler, Pilot joined Named World"
    );
}

#[test]
fn notification_tts_text_omits_instance_id_even_when_display_shows_it() {
    let (_dir, db) = test_db("tts-omits-instance-id");
    let mut delivery = delivery();
    delivery.entry.content.location = "wrld_named:12345~region(use)".into();
    delivery.entry.content.title = OverlayActivityText::literal("Traveler");
    delivery.entry.content.body =
        OverlayActivityText::message(OverlayMessage::notifications_gps("Named World Public"));
    let preferences = NotificationDeliveryPreferences {
        show_instance_id_in_location: true,
        ..NotificationDeliveryPreferences::default()
    };
    let render = render_delivery(&delivery, OverlayLocale::En, true);

    assert!(render.text.contains("#12345"));
    assert_eq!(
        notification_tts_text(&db, &delivery, &render, &preferences, OverlayLocale::En),
        "Traveler is in Named World Public"
    );
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

#[test]
fn render_delivery_localizes_location_access_labels() {
    let mut delivery = delivery();
    delivery.entry.actor_display_name = "Traveler".into();
    delivery.entry.content.location = "wrld_named:123~group(grp_a)~groupAccessType(plus)".into();
    delivery.entry.content.world_name = "Group World".into();
    delivery.entry.content.group_name = "Group Name".into();
    delivery.entry.content.title = OverlayActivityText::literal("Traveler");
    delivery.entry.content.body = OverlayActivityText::message(OverlayMessage::notifications_gps(
        "Group World groupPlus(Group Name)",
    ));

    let render = render_delivery(&delivery, OverlayLocale::ZhCn, false);

    assert_eq!(
        render.text,
        "Traveler 现在位于 Group World 群组+(Group Name)"
    );
    assert_eq!(render.display_location, "Group World 群组+(Group Name)");
}

#[test]
fn render_delivery_appends_instance_id_when_enabled() {
    let mut delivery = delivery();
    delivery.entry.actor_display_name = "Traveler".into();
    delivery.entry.content.location = "wrld_named:123~group(grp_a)~groupAccessType(plus)".into();
    delivery.entry.content.world_name = "Group World".into();
    delivery.entry.content.group_name = "Group Name".into();
    delivery.entry.content.title = OverlayActivityText::literal("Traveler");
    delivery.entry.content.body = OverlayActivityText::message(OverlayMessage::notifications_gps(
        "Group World groupPlus(Group Name)",
    ));

    let render = render_delivery(&delivery, OverlayLocale::ZhCn, true);

    assert_eq!(
        render.text,
        "Traveler 现在位于 Group World 群组+(Group Name) #123"
    );
    assert_eq!(
        render.display_location,
        "Group World 群组+(Group Name) #123"
    );
}

#[test]
fn render_delivery_localizes_generic_desktop_activity_keys() {
    let cases = [
        (
            "Bio",
            OverlayActivityText::literal("Traveler"),
            OverlayActivityText::message(OverlayMessage::notifications_bio()),
            "Traveler",
            "updated bio",
        ),
        (
            "Event",
            OverlayActivityText::message(OverlayMessage::notifications_event_title()),
            OverlayActivityText::literal("General event message"),
            "Event",
            "General event message",
        ),
        (
            "External",
            OverlayActivityText::message(OverlayMessage::notifications_external_title()),
            OverlayActivityText::literal("External app message"),
            "External App",
            "External app message",
        ),
        (
            "VideoPlay",
            OverlayActivityText::message(OverlayMessage::notifications_video_play_title()),
            OverlayActivityText::literal("Desktop Video"),
            "Video Play",
            "Desktop Video",
        ),
    ];

    for (activity_type, title, body, expected_title, expected_body) in cases {
        let mut delivery = delivery();
        delivery.entry.activity_type = activity_type.into();
        delivery.entry.content.title = title;
        delivery.entry.content.body = body;

        let render = render_delivery(&delivery, OverlayLocale::En, false);

        assert_eq!(render.title, expected_title, "{activity_type}");
        assert_eq!(render.body, expected_body, "{activity_type}");
        assert_eq!(
            render.text,
            format!("{expected_title} {expected_body}"),
            "{activity_type}"
        );
    }
}

#[test]
fn generic_webhook_location_uses_localized_access_label() {
    let mut delivery = delivery();
    delivery.entry.content.location = "wrld_named:123~group(grp_a)~groupAccessType(plus)".into();
    delivery.entry.content.world_name = "Group World".into();
    delivery.entry.content.group_name = "Group Name".into();
    delivery.entry.content.display_location = "Group World groupPlus(Group Name)".into();

    let render = render_delivery(&delivery, OverlayLocale::ZhCn, false);
    let payload = generic_webhook_payload(&delivery, &render, &["location".into()]);

    assert_eq!(
        payload.get("location").and_then(|value| value.as_str()),
        Some("Group World 群组+(Group Name)")
    );
}

#[test]
fn generic_webhook_location_appends_instance_id_when_enabled() {
    let mut delivery = delivery();
    delivery.entry.content.location = "wrld_named:123~group(grp_a)~groupAccessType(plus)".into();
    delivery.entry.content.world_name = "Group World".into();
    delivery.entry.content.group_name = "Group Name".into();
    delivery.entry.content.display_location = "Group World groupPlus(Group Name)".into();

    let render = render_delivery(&delivery, OverlayLocale::ZhCn, true);
    let payload = generic_webhook_payload(&delivery, &render, &["location".into()]);

    assert_eq!(
        payload.get("location").and_then(|value| value.as_str()),
        Some("Group World 群组+(Group Name) #123")
    );
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
            "vrcx-0-dispatcher-{name}-{}-{nonce}",
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
    Arc<vrcx_0_application::RealtimeHostRuntime>,
    Arc<DatabaseService>,
    Arc<vrcx_0_application::WebClient>,
) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let storage =
        vrcx_0_persistence::storage::StorageService::new(&dir.path.join("storage.json")).unwrap();
    let web = Arc::new(
        vrcx_0_application::WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    );
    let world_cache = Arc::new(vrcx_0_application::WorldCache::new(
        Arc::clone(&db),
        512,
        std::time::Duration::from_secs(30 * 60),
    ));
    let runtime = Arc::new(vrcx_0_application::RealtimeHostRuntime::new(
        vrcx_0_application::RealtimeHostRuntimeDeps {
            db: Arc::clone(&db),
            web: Arc::clone(&web),
            event_bus: vrcx_0_application::RuntimeEventBus::new(),
            sync: vrcx_0_application::RuntimeSyncEngine::new(),
            tasks: vrcx_0_application::TaskSupervisor::new(),
            session: vrcx_0_application::HostSessionRuntime::new(),
            auth_scope: vrcx_0_application::RuntimeAuthScope::new(),
            game_log_snapshot: Arc::new(Mutex::new(vrcx_0_application::RuntimeSnapshot::default())),
            overlay_activity: vrcx_0_application::OverlayActivityRuntime::default(),
            world_cache,
            print_cleanup: vrcx_0_application::PrintCleanupQueue::new(),
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
