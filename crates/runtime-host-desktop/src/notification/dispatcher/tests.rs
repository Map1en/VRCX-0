use std::sync::Mutex;

use crate::notification::{NotificationDeliveryPreferences, NotificationTtsNameMode};
use serde_json::json;
use vrcx_0_application_activity::notification::{
    render_delivery, OverlayLocale, RenderedNotification,
};
use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
    ActivityText,
};
use vrcx_0_application_core::RuntimeAuthScope;
use vrcx_0_i18n::OverlayMessage;
use vrcx_0_platform::Error;

use vrcx_0_host_desktop::tts::{TtsEngine, TtsVoice};

use crate::notification::tts::{
    notification_tts_memo_actor_user_id, notification_tts_text, send_tts_notification,
};

use super::{notification_session_identity, NotificationDeliveryPlan, OrderedDeliveryBuffer};

#[test]
fn ordered_delivery_buffer_releases_concurrent_results_in_source_order() {
    let mut buffer = OrderedDeliveryBuffer::new(0);

    assert!(buffer.push(1, Some("second")).is_empty());
    assert_eq!(buffer.push(0, Some("first")), ["first", "second"]);
    assert_eq!(buffer.push(2, Some("third")), ["third"]);
}

#[test]
fn ordered_delivery_buffer_advances_over_priority_delivery() {
    let mut buffer = OrderedDeliveryBuffer::new(0);

    assert!(buffer.push(1, None::<&str>).is_empty());
    assert_eq!(buffer.push(0, Some("first")), ["first"]);
    assert_eq!(buffer.push(2, Some("third")), ["third"]);
}

#[test]
fn notification_identity_uses_the_active_auth_scope() {
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set(
        "usr_12345678-1234-1234-1234-1234567890ab",
        "https://api.vrchat.cloud/api/1",
    );
    assert_eq!(
        notification_session_identity(&auth_scope),
        (
            "https://api.vrchat.cloud/api/1".into(),
            "usr_12345678-1234-1234-1234-1234567890ab".into(),
        )
    );
}

#[test]
fn notification_identity_is_empty_before_the_auth_scope_is_active() {
    assert_eq!(
        notification_session_identity(&RuntimeAuthScope::new()),
        (String::new(), String::new())
    );
}

#[test]
fn notification_tts_note_mode_replaces_only_first_title() {
    let preferences = NotificationDeliveryPreferences {
        notification_tts_name_mode: NotificationTtsNameMode::Note,
        ..NotificationDeliveryPreferences::default()
    };
    let mut render = rendered();
    render.text = "Traveler waved at Traveler".into();

    assert_eq!(
        notification_tts_text(
            &delivery(),
            &render,
            &preferences,
            OverlayLocale::En,
            Some("Pilot\nsecond line")
        ),
        "Pilot waved at Traveler"
    );
}

#[test]
fn notification_tts_username_and_note_mode_reads_both() {
    let preferences = NotificationDeliveryPreferences {
        notification_tts_name_mode: NotificationTtsNameMode::UsernameAndNote,
        ..NotificationDeliveryPreferences::default()
    };

    assert_eq!(
        notification_tts_text(
            &delivery(),
            &rendered(),
            &preferences,
            OverlayLocale::En,
            Some("Pilot")
        ),
        "Traveler, Pilot joined Named World"
    );
}

#[test]
fn notification_tts_text_omits_instance_id_even_when_display_shows_it() {
    let mut delivery = delivery();
    delivery.entry.content.location = "wrld_named:12345~region(use)".into();
    delivery.entry.content.title = ActivityText::literal("Traveler");
    delivery.entry.content.body =
        ActivityText::message(OverlayMessage::notifications_gps("Named World Public"));
    let preferences = NotificationDeliveryPreferences {
        show_instance_id_in_location: true,
        ..NotificationDeliveryPreferences::default()
    };
    let render = render_delivery(&delivery, OverlayLocale::En, true);

    assert!(render.text.contains("#12345"));
    let spoken = notification_tts_text(&delivery, &render, &preferences, OverlayLocale::En, None);
    assert!(!spoken.contains("#12345"));
}

#[test]
fn notification_tts_passes_configured_volume_to_engine() {
    let tts = RecordingTts::default();
    let preferences = NotificationDeliveryPreferences {
        notification_tts_volume: 42,
        ..NotificationDeliveryPreferences::default()
    };

    send_tts_notification(
        &tts,
        &delivery(),
        &rendered(),
        &preferences,
        OverlayLocale::En,
        None,
    );

    assert_eq!(tts.volumes.lock().unwrap().as_slice(), &[42]);
}

#[test]
fn notification_tts_username_mode_does_not_request_a_user_memo() {
    assert_eq!(
        notification_tts_memo_actor_user_id(
            &delivery(),
            &rendered(),
            &NotificationDeliveryPreferences::default(),
            OverlayLocale::En,
        ),
        None
    );
}

#[derive(Default)]
struct RecordingTts {
    volumes: Mutex<Vec<u8>>,
}

impl TtsEngine for RecordingTts {
    fn voices(&self) -> Vec<TtsVoice> {
        Vec::new()
    }

    fn speak(&self, _text: &str, _voice_id: Option<&str>, volume: u8) -> Result<(), Error> {
        self.volumes.lock().unwrap().push(volume);
        Ok(())
    }
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

fn delivery() -> ActivityDelivery {
    ActivityDelivery {
        entry: ActivityEntry {
            sequence: 1,
            source_id: "game-log:join".into(),
            kind: vrcx_0_contracts::activity::ActivityKind::OnPlayerJoined,
            category: ActivityCategory::CurrentInstance,
            created_at: "2026-06-18T08:30:00.000Z".into(),
            actor_user_id: "usr_traveler".into(),
            actor_display_name: "Traveler".into(),
            content: ActivityContent {
                location: "wrld_named:123".into(),
                world_id: "wrld_named".into(),
                display_location: "Named World public".into(),
                world_name: "Named World".into(),
                ..ActivityContent::default()
            },
            actor_relation: ActivityActorRelation::None,
        },
        desktop: false,
        vr: false,
        hmd: false,
        webhook: true,
        tts: false,
        widget: false,
    }
}

struct UserIconRemote;

impl vrcx_0_application_activity::notification::NotificationRemote for UserIconRemote {
    fn user<'a>(
        &'a self,
        _endpoint: &'a str,
        user_id: &'a str,
    ) -> vrcx_0_application_activity::notification::NotificationRemoteFuture<'a, serde_json::Value>
    {
        Box::pin(async move {
            (user_id == "usr_traveler").then(
                || json!({ "iconUrl": "https://api.example.test/api/1/file/file_0123abcd/4/file" }),
            )
        })
    }

    fn avatar_name<'a>(
        &'a self,
        _endpoint: &'a str,
        _file_id: &'a str,
    ) -> vrcx_0_application_activity::notification::NotificationRemoteFuture<'a, String> {
        Box::pin(async { None })
    }

    fn world_name<'a>(
        &'a self,
        _endpoint: &'a str,
        world_id: &'a str,
    ) -> vrcx_0_application_activity::notification::NotificationRemoteFuture<'a, String> {
        Box::pin(async move { (world_id == "wrld_lookup").then(|| "Lookup World".to_string()) })
    }

    fn world_image_url<'a>(
        &'a self,
        _endpoint: &'a str,
        _world_id: &'a str,
    ) -> vrcx_0_application_activity::notification::NotificationRemoteFuture<'a, String> {
        Box::pin(async { None })
    }

    fn group_name<'a>(
        &'a self,
        _endpoint: &'a str,
        group_id: &'a str,
    ) -> vrcx_0_application_activity::notification::NotificationRemoteFuture<'a, String> {
        Box::pin(async move { (group_id == "grp_lookup").then(|| "Lookup Group".to_string()) })
    }
}

fn image_job(actor_user_id: &str) -> super::NotificationJob {
    let mut delivery = delivery();
    delivery.entry.actor_user_id = actor_user_id.into();
    super::NotificationJob {
        delivery,
        preferences: NotificationDeliveryPreferences::default(),
        plan: NotificationDeliveryPlan {
            desktop: true,
            ..NotificationDeliveryPlan::default()
        },
        locale: OverlayLocale::default(),
        endpoint: "https://api.example.test/api/1".into(),
        current_user_id: "usr_self".into(),
    }
}

struct FriendIcons;

impl vrcx_0_application_activity::notification::CachedNotificationUserImageResolver
    for FriendIcons
{
    fn cached_url(&self, _endpoint: &str, user_id: &str) -> Option<String> {
        Some(format!(
            "https://api.example.test/api/1/file/file_{user_id}/1/file"
        ))
    }

    fn cached_friend_url(&self, _endpoint: &str, user_id: &str) -> Option<String> {
        (user_id == "usr_friend")
            .then(|| "https://api.example.test/api/1/file/file_0123abcd/4/file".to_string())
    }
}

#[test]
fn desktop_shows_only_friend_icons_while_external_overlays_fall_back_to_the_notification_image() {
    let plan = NotificationDeliveryPlan {
        desktop: true,
        xs: true,
        ..NotificationDeliveryPlan::default()
    };
    let preferences = NotificationDeliveryPreferences::default();
    let friend = "https://api.example.test/api/1/image/file_0123abcd/4/128".to_string();
    let thumbnail = "https://assets.example.test/video.png";

    assert_eq!(
        super::notification_image_urls(plan, &preferences, Some(friend.clone()), thumbnail),
        (Some(friend.clone()), Some(friend.clone()))
    );
    assert_eq!(
        super::notification_image_urls(plan, &preferences, None, thumbnail),
        (None, Some(thumbnail.to_string()))
    );
    assert_eq!(
        super::notification_image_urls(plan, &preferences, None, " "),
        (None, None)
    );
    let switched_off = NotificationDeliveryPreferences {
        desktop_notification_avatars: false,
        image_notifications: false,
        ..NotificationDeliveryPreferences::default()
    };
    assert_eq!(
        super::notification_image_urls(plan, &switched_off, Some(friend), thumbnail),
        (None, None)
    );
}

#[test]
fn local_notifications_only_show_cached_friend_icons() {
    let resolver = vrcx_0_application_activity::notification::NotificationResolver::new(
        std::sync::Arc::new(UserIconRemote),
    );
    let friends: std::sync::Arc<
        dyn vrcx_0_application_activity::notification::CachedNotificationUserImageResolver,
    > = std::sync::Arc::new(FriendIcons);
    resolver.attach_realtime(&friends);

    assert_eq!(
        super::friend_actor_image(&resolver, &image_job("usr_friend")).as_deref(),
        Some("https://api.example.test/api/1/image/file_0123abcd/4/128")
    );
    assert_eq!(
        super::friend_actor_image(&resolver, &image_job("usr_traveler")),
        None
    );
    assert_eq!(
        super::friend_actor_image(&resolver, &image_job("usr_self")),
        None
    );
}

#[tokio::test]
async fn local_notifications_look_up_a_missing_world_name() {
    let resolver = std::sync::Arc::new(
        vrcx_0_application_activity::notification::NotificationResolver::new(std::sync::Arc::new(
            UserIconRemote,
        )),
    );
    let tasks = vrcx_0_application_core::TaskSupervisor::new();

    let mut unnamed = image_job("usr_traveler");
    unnamed.delivery.entry.content.world_id = "wrld_lookup".into();
    unnamed.delivery.entry.content.location = "wrld_lookup:123".into();
    unnamed.delivery.entry.content.world_name = String::new();
    let resolved = super::resolve_world_name_with_budget(&tasks, resolver.clone(), &unnamed).await;
    assert_eq!(
        resolved.map(|(world_name, _)| world_name).as_deref(),
        Some("Lookup World")
    );

    assert_eq!(
        super::resolve_world_name_with_budget(&tasks, resolver, &image_job("usr_traveler")).await,
        None
    );
}

#[tokio::test]
async fn local_notifications_look_up_a_group_instance_name() {
    let resolver = std::sync::Arc::new(
        vrcx_0_application_activity::notification::NotificationResolver::new(std::sync::Arc::new(
            UserIconRemote,
        )),
    );
    let tasks = vrcx_0_application_core::TaskSupervisor::new();

    let mut group_instance = image_job("usr_traveler");
    group_instance.delivery.entry.content.location =
        "wrld_named:123~group(grp_lookup)~groupAccessType(public)".into();
    group_instance.delivery.entry.content.group_name = "grp_lookup".into();
    assert_eq!(
        super::resolve_group_name_with_budget(&tasks, resolver.clone(), &group_instance)
            .await
            .as_deref(),
        Some("Lookup Group")
    );
    assert_eq!(
        resolver.cached_group_name("grp_lookup").as_deref(),
        Some("Lookup Group")
    );

    assert_eq!(
        super::resolve_group_name_with_budget(&tasks, resolver, &image_job("usr_traveler")).await,
        None
    );
}
