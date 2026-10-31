use std::sync::Arc;

use super::resolver::RealtimeUserImageResolverSlot;
use super::{
    generic_webhook_payload, parse_webhook_fields, render_delivery, unresolved_group_id,
    CachedNotificationUserImageResolver, NotificationRemote, NotificationRemoteFuture,
    NotificationResolver, OverlayLocale, RenderedNotification,
};
use crate::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityDelivery, ActivityEntry,
    ActivityText,
};
use vrcx_0_contracts::activity::ActivityKind;

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
fn overlay_text_joins_title_and_body_the_way_each_type_reads() {
    let text = |activity_type: &str, title: &str, body: &str| {
        let mut delivery = delivery();
        delivery.entry.kind = ActivityKind::from_key(activity_type).expect("known activity type");
        delivery.entry.content.title = ActivityText::literal(title);
        delivery.entry.content.body = ActivityText::literal(body);
        render_delivery(&delivery, OverlayLocale::default(), false).text
    };

    assert_eq!(
        text("OnPlayerJoined", "Alice", "has joined"),
        "Alice has joined"
    );
    assert_eq!(text("group.announcement", "Group", "Hello"), "Hello");
    assert_eq!(
        text("VideoPlay", "Now playing", "Song (Bob)"),
        "Now playing: Song (Bob)"
    );
    assert_eq!(
        text("BlockedOnPlayerJoined", "Carol", "Blocked user has joined"),
        "Blocked user has joined: Carol"
    );
    assert_eq!(
        text("Event", "", "Something happened"),
        "Something happened"
    );
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
            kind: ActivityKind::OnPlayerJoined,
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

struct FakeCachedResolver {
    url: Option<String>,
    friend_url: Option<String>,
}

impl CachedNotificationUserImageResolver for FakeCachedResolver {
    fn cached_url(&self, _endpoint: &str, _user_id: &str) -> Option<String> {
        self.url.clone()
    }

    fn cached_friend_url(&self, _endpoint: &str, _user_id: &str) -> Option<String> {
        self.friend_url.clone()
    }
}

#[test]
fn realtime_image_resolver_returns_none_when_slot_is_unset() {
    let resolver = RealtimeUserImageResolverSlot::default();
    let image_url = resolver.cached_url("", "usr_traveler");

    assert_eq!(image_url, None);
}

#[test]
fn realtime_user_image_resolver_does_not_retain_owner() {
    let owner: Arc<dyn CachedNotificationUserImageResolver> = Arc::new(FakeCachedResolver {
        url: Some("https://img.example/usr_traveler.png".into()),
        friend_url: None,
    });
    let weak_owner = Arc::downgrade(&owner);
    let resolver = RealtimeUserImageResolverSlot::default();

    resolver.set(&owner);
    assert_eq!(
        resolver.cached_url("", "usr_traveler").as_deref(),
        Some("https://img.example/usr_traveler.png")
    );
    drop(owner);

    assert!(weak_owner.upgrade().is_none());
    assert_eq!(resolver.cached_url("", "usr_traveler"), None);
}

#[test]
fn friend_image_reads_only_the_friend_cache() {
    let resolver = NotificationResolver::new(Arc::new(NoRemote));
    let friend: Arc<dyn CachedNotificationUserImageResolver> = Arc::new(FakeCachedResolver {
        url: Some("https://api.example.test/api/1/file/file_4567cdef/1/file".into()),
        friend_url: Some("https://api.example.test/api/1/file/file_0123abcd/2/file".into()),
    });
    resolver.attach_realtime(&friend);
    assert_eq!(
        resolver
            .friend_image("https://api.example.test/api/1", "usr_friend")
            .as_deref(),
        Some("https://api.example.test/api/1/image/file_0123abcd/2/128")
    );

    let stranger: Arc<dyn CachedNotificationUserImageResolver> = Arc::new(FakeCachedResolver {
        url: Some("https://api.example.test/api/1/file/file_4567cdef/1/file".into()),
        friend_url: None,
    });
    resolver.attach_realtime(&stranger);
    assert_eq!(
        resolver.friend_image("https://api.example.test/api/1", "usr_stranger"),
        None
    );
}

#[test]
fn unresolved_group_id_reads_group_instance_until_name_is_readable() {
    let location = "wrld_named:123~group(grp_abc)~groupAccessType(public)";
    let mut content = ActivityContent {
        location: location.into(),
        group_name: "grp_abc".into(),
        ..ActivityContent::default()
    };
    assert_eq!(unresolved_group_id(&content).as_deref(), Some("grp_abc"));

    content.group_name = "Named Group".into();
    assert_eq!(unresolved_group_id(&content), None);

    let public = ActivityContent {
        location: "wrld_named:123".into(),
        ..ActivityContent::default()
    };
    assert_eq!(unresolved_group_id(&public), None);
}

#[test]
fn rendered_group_instance_location_uses_resolved_group_name() {
    let mut delivery = delivery();
    delivery.entry.content.location =
        "wrld_named:123~group(grp_abc)~groupAccessType(public)".into();
    delivery.entry.content.body = ActivityText::message(
        vrcx_0_i18n::OverlayMessage::notifications_gps("Named World Group Public"),
    );
    delivery.entry.content.group_name = "Named Group".into();

    let render = render_delivery(&delivery, OverlayLocale::En, false);

    assert!(render.display_location.contains("(Named Group)"));
    assert!(render.body.contains("(Named Group)"));
}

struct NoRemote;

impl NotificationRemote for NoRemote {
    fn user<'a>(
        &'a self,
        _endpoint: &'a str,
        _user_id: &'a str,
    ) -> NotificationRemoteFuture<'a, serde_json::Value> {
        Box::pin(async { None })
    }

    fn avatar_name<'a>(
        &'a self,
        _endpoint: &'a str,
        _file_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String> {
        Box::pin(async { None })
    }

    fn world_name<'a>(
        &'a self,
        _endpoint: &'a str,
        _world_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String> {
        Box::pin(async { None })
    }

    fn world_image_url<'a>(
        &'a self,
        _endpoint: &'a str,
        _world_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String> {
        Box::pin(async { None })
    }

    fn group_name<'a>(
        &'a self,
        _endpoint: &'a str,
        _group_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String> {
        Box::pin(async { None })
    }
}
