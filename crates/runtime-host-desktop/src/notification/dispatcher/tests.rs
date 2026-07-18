use std::path::PathBuf;

use serde_json::json;
use vrcx_0_application_activity::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityDelivery, OverlayActivityEntry, OverlayActivityText,
};
use vrcx_0_i18n::OverlayMessage;
use vrcx_0_persistence::{memos::memo_save_user, DatabaseService};
use vrcx_0_runtime_host::notification::{
    render_delivery, NotificationDeliveryPreferences, OverlayLocale, RenderedNotification,
};

use crate::notification::tts::notification_tts_text;

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
    let spoken = notification_tts_text(&db, &delivery, &render, &preferences, OverlayLocale::En);
    assert!(!spoken.contains("#12345"));
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
            "vrcx-0-desktop-notification-{name}-{}-{nonce}",
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
