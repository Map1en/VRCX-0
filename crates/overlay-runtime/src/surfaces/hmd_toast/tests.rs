use super::*;
use crate::avatar_cache::tests::{test_avatar_bitmap, test_avatar_bitmap_with_red};
use crate::runtime::tests::{
    friends_panel_snapshot, hmd_enabled_runtime_with_services, test_services,
};
use std::sync::atomic::{AtomicBool, Ordering};
use vrcx_0_core::friends::FriendRecord;

#[test]
fn hmd_toast_queue_caps_at_three_and_drops_oldest() {
    let runtime = VrOverlayRuntime::new_for_test();
    let now = Instant::now();
    for index in 0..4 {
        runtime.enqueue_hmd_toast(
            hmd_entry(
                &format!("source-{index}"),
                "Status",
                OverlayActivityActorRelation::Favorite,
                "wrld_a:123",
            ),
            now + Duration::from_millis(index),
            Duration::from_secs(5),
        );
    }

    let toasts = runtime.hmd_toast_views(now + Duration::from_secs(1));

    assert_eq!(toasts.len(), 3);
    assert_eq!(toasts[0].entry.source_id, "source-1");
    assert_eq!(toasts[2].entry.source_id, "source-3");
}

#[test]
fn hmd_toast_queue_merges_non_friend_join_leave_by_instance_only() {
    let runtime = VrOverlayRuntime::new_for_test();
    let now = Instant::now();
    runtime.enqueue_hmd_toast(
        hmd_entry(
            "join-1",
            "OnPlayerJoined",
            OverlayActivityActorRelation::None,
            "wrld_a:123",
        ),
        now,
        Duration::from_secs(5),
    );
    runtime.enqueue_hmd_toast(
        hmd_entry(
            "join-2",
            "OnPlayerJoined",
            OverlayActivityActorRelation::None,
            "wrld_a:123",
        ),
        now + Duration::from_secs(2),
        Duration::from_secs(5),
    );
    runtime.enqueue_hmd_toast(
        hmd_entry(
            "friend-join",
            "OnPlayerJoined",
            OverlayActivityActorRelation::Friend,
            "wrld_a:123",
        ),
        now + Duration::from_secs(3),
        Duration::from_secs(5),
    );

    let toasts = runtime.hmd_toast_views(now + Duration::from_secs(3));

    assert_eq!(toasts.len(), 2);
    assert_eq!(toasts[0].merge_count, 2);
    assert_eq!(toasts[0].entry.source_id, "join-2");
    assert_eq!(toasts[1].merge_count, 1);
    assert_eq!(toasts[1].entry.source_id, "friend-join");
}

#[test]
fn hmd_toast_queue_does_not_merge_join_leave_without_instance_key() {
    let runtime = VrOverlayRuntime::new_for_test();
    let now = Instant::now();
    runtime.enqueue_hmd_toast(
        hmd_entry(
            "join-1",
            "OnPlayerJoined",
            OverlayActivityActorRelation::None,
            "",
        ),
        now,
        Duration::from_secs(5),
    );
    runtime.enqueue_hmd_toast(
        hmd_entry(
            "join-2",
            "OnPlayerJoined",
            OverlayActivityActorRelation::None,
            "",
        ),
        now + Duration::from_secs(2),
        Duration::from_secs(5),
    );

    let toasts = runtime.hmd_toast_views(now + Duration::from_secs(3));

    assert_eq!(toasts.len(), 2);
    assert_eq!(toasts[0].merge_count, 1);
    assert_eq!(toasts[0].entry.source_id, "join-1");
    assert_eq!(toasts[1].merge_count, 1);
    assert_eq!(toasts[1].entry.source_id, "join-2");
}

#[test]
fn hmd_toast_queue_does_not_merge_join_leave_across_instances() {
    let runtime = VrOverlayRuntime::new_for_test();
    let now = Instant::now();
    runtime.enqueue_hmd_toast(
        hmd_entry(
            "join-1",
            "OnPlayerJoined",
            OverlayActivityActorRelation::None,
            "wrld_a:123",
        ),
        now,
        Duration::from_secs(5),
    );
    runtime.enqueue_hmd_toast(
        hmd_entry(
            "join-2",
            "OnPlayerJoined",
            OverlayActivityActorRelation::None,
            "wrld_b:456",
        ),
        now + Duration::from_secs(2),
        Duration::from_secs(5),
    );

    let toasts = runtime.hmd_toast_views(now + Duration::from_secs(3));

    assert_eq!(toasts.len(), 2);
    assert_eq!(toasts[0].entry.source_id, "join-1");
    assert_eq!(toasts[1].entry.source_id, "join-2");
}

#[test]
fn hmd_avatar_cache_hit_requires_friend_snapshot() {
    let (_dir, _db, services) = test_services("hmd-avatar-friend-gate");
    let runtime = hmd_enabled_runtime_with_services(services);
    let url = "https://images.example/avatar/128";
    let bitmap = test_avatar_bitmap();
    runtime
        .avatar_bitmap_cache
        .store_success(url, "usr_actor", bitmap.clone());
    let mut entry = hmd_entry(
        "friend-avatar",
        "OnPlayerJoined",
        OverlayActivityActorRelation::Friend,
        "wrld_home:123",
    );
    entry.content.image_url = url.to_string();
    runtime.enqueue_hmd_toast(entry.clone(), Instant::now(), Duration::from_secs(5));

    runtime.spawn_avatar_fetch(&entry);

    assert!(runtime
        .hmd_toast_views(Instant::now())
        .first()
        .and_then(|toast| toast.avatar.clone())
        .is_none());

    runtime.set_friends_panel_snapshot_provider(|| {
        Some(friends_panel_snapshot(FriendRecord {
            id: "usr_actor".to_string(),
            display_name: "Friend".to_string(),
            ..FriendRecord::default()
        }))
    });
    runtime.spawn_avatar_fetch(&entry);

    assert_eq!(
        runtime
            .hmd_toast_views(Instant::now())
            .first()
            .and_then(|toast| toast.avatar.clone()),
        Some(bitmap)
    );
    assert!(runtime
        .hmd_toast_views(Instant::now())
        .first()
        .is_some_and(|toast| toast.show_avatar));
}

#[test]
fn hmd_snapshot_gap_does_not_drop_loaded_toast_avatar() {
    let (_dir, _db, services) = test_services("hmd-avatar-snapshot-gap");
    let runtime = hmd_enabled_runtime_with_services(services);
    let snapshot_available = Arc::new(AtomicBool::new(true));
    let provider_available = Arc::clone(&snapshot_available);
    runtime.set_friends_panel_snapshot_provider(move || {
        if provider_available.load(Ordering::Acquire) {
            Some(friends_panel_snapshot(FriendRecord {
                id: "usr_actor".to_string(),
                display_name: "Friend".to_string(),
                ..FriendRecord::default()
            }))
        } else {
            None
        }
    });
    let url = "https://images.example/avatar/128";
    let bitmap = test_avatar_bitmap();
    runtime
        .avatar_bitmap_cache
        .store_success(url, "usr_actor", bitmap.clone());
    let mut entry = hmd_entry(
        "friend-avatar-snapshot-gap",
        "OnPlayerJoined",
        OverlayActivityActorRelation::Friend,
        "wrld_home:123",
    );
    entry.content.image_url = url.to_string();
    runtime.enqueue_hmd_toast(entry.clone(), Instant::now(), Duration::from_secs(5));
    runtime.spawn_avatar_fetch(&entry);

    assert_eq!(
        runtime
            .hmd_toast_views(Instant::now())
            .first()
            .and_then(|toast| toast.avatar.clone()),
        Some(bitmap.clone())
    );

    snapshot_available.store(false, Ordering::Release);
    let hidden = runtime.hmd_toast_views(Instant::now()).pop().unwrap();
    assert!(!hidden.show_avatar);
    assert!(hidden.avatar.is_none());

    snapshot_available.store(true, Ordering::Release);
    let restored = runtime.hmd_toast_views(Instant::now()).pop().unwrap();
    assert!(restored.show_avatar);
    assert_eq!(restored.avatar, Some(bitmap));
}

#[test]
fn hmd_non_friend_toast_hides_avatar_slot() {
    let (_dir, _db, services) = test_services("hmd-non-friend-avatar-hidden");
    let runtime = hmd_enabled_runtime_with_services(services);
    let entry = hmd_entry(
        "stranger-toast",
        "OnPlayerJoined",
        OverlayActivityActorRelation::None,
        "wrld_home:123",
    );

    runtime.enqueue_hmd_toast(entry, Instant::now(), Duration::from_secs(5));

    let toast = runtime.hmd_toast_views(Instant::now()).pop().unwrap();
    assert!(!toast.show_avatar);
    assert!(toast.avatar.is_none());
}

#[test]
fn hmd_friend_toast_without_bitmap_keeps_avatar_slot() {
    let (_dir, _db, services) = test_services("hmd-friend-avatar-slot");
    let runtime = hmd_enabled_runtime_with_services(services);
    runtime.set_friends_panel_snapshot_provider(|| {
        Some(friends_panel_snapshot(FriendRecord {
            id: "usr_actor".to_string(),
            display_name: "Friend".to_string(),
            ..FriendRecord::default()
        }))
    });
    let entry = hmd_entry(
        "friend-toast",
        "OnPlayerJoined",
        OverlayActivityActorRelation::Friend,
        "wrld_home:123",
    );

    runtime.enqueue_hmd_toast(entry, Instant::now(), Duration::from_secs(5));

    let toast = runtime.hmd_toast_views(Instant::now()).pop().unwrap();
    assert!(toast.show_avatar);
    assert!(toast.avatar.is_none());
}

#[test]
fn hmd_avatar_uses_friend_record_url_before_direct_notification_image() {
    let (_dir, _db, services) = test_services("hmd-avatar-record-url-first");
    let runtime = hmd_enabled_runtime_with_services(services);
    let selected_url = "https://images.example/profile/128";
    let direct_url = "https://images.example/direct/128";
    let selected_bitmap = test_avatar_bitmap_with_red(32);
    let direct_bitmap = test_avatar_bitmap_with_red(220);
    runtime
        .avatar_bitmap_cache
        .store_success(selected_url, "usr_actor", selected_bitmap.clone());
    runtime
        .avatar_bitmap_cache
        .store_success(direct_url, "usr_actor", direct_bitmap);
    runtime.set_friends_panel_snapshot_provider(|| {
        Some(friends_panel_snapshot(FriendRecord {
            id: "usr_actor".to_string(),
            display_name: "Friend".to_string(),
            extra: serde_json::json!({
                "profilePicOverrideThumbnail": "https://images.example/profile/256",
            })
            .as_object()
            .unwrap()
            .clone(),
            ..FriendRecord::default()
        }))
    });
    let mut entry = hmd_entry(
        "friend-avatar-direct-image",
        "OnPlayerJoined",
        OverlayActivityActorRelation::Friend,
        "wrld_home:123",
    );
    entry.content.image_url = direct_url.to_string();
    runtime.enqueue_hmd_toast(entry.clone(), Instant::now(), Duration::from_secs(5));

    runtime.spawn_avatar_fetch(&entry);

    assert_eq!(
        runtime
            .hmd_toast_views(Instant::now())
            .first()
            .and_then(|toast| toast.avatar.clone()),
        Some(selected_bitmap)
    );
}

#[test]
fn hmd_idle_renderer_release_keeps_avatar_bitmap_cache() {
    let runtime = VrOverlayRuntime::new_for_test();
    runtime.avatar_bitmap_cache.store_success(
        "https://images.example/idle",
        "usr_friend",
        test_avatar_bitmap(),
    );

    {
        let mut manager = runtime.manager.lock().unwrap();
        runtime.push_hmd_frame(
            &mut manager,
            VrOverlayRuntimeConfig::default(),
            Instant::now(),
        );
    }

    assert!(runtime
        .avatar_bitmap_cache
        .cached("https://images.example/idle", "usr_friend")
        .is_some());
}

fn hmd_entry(
    source_id: &str,
    activity_type: &str,
    relation: OverlayActivityActorRelation,
    location: &str,
) -> OverlayActivityEntry {
    OverlayActivityEntry {
        sequence: 1,
        source_id: source_id.to_string(),
        activity_type: activity_type.to_string(),
        category: vrcx_0_application_activity::OverlayActivityCategory::CurrentInstance,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        actor_user_id: "usr_actor".to_string(),
        actor_display_name: source_id.to_string(),
        content: vrcx_0_application_activity::OverlayActivityContent {
            title: vrcx_0_application_activity::OverlayActivityText::literal(source_id),
            body: vrcx_0_application_activity::OverlayActivityText::literal(activity_type),
            location: location.to_string(),
            ..vrcx_0_application_activity::OverlayActivityContent::default()
        },
        actor_relation: relation,
        payload: serde_json::json!({}),
    }
}
