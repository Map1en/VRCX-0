use std::sync::Arc;

use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityEntry, ActivityText,
};
use vrcx_0_contracts::activity::ActivityKind;
use vrcx_0_i18n::OverlayMessage;
use vrcx_0_vr_overlay::AvatarBitmap;

use super::{DesktopWidgetFeed, DesktopWidgetRow, DesktopWidgetRowPart, DesktopWidgetTarget};
use crate::localization::{OverlayLocale, OverlayLocalizer};

#[test]
fn new_activity_appears_below_older_activity() {
    let mut feed = DesktopWidgetFeed::default();
    feed.push(friend_online("usr_ada", "Ada"));
    feed.push(friend_online("usr_bob", "Bob"));

    let rows = rows(&feed);

    assert_eq!(actors(&rows), ["Ada", "Bob"]);
}

#[test]
fn the_actor_is_shown_apart_from_what_happened() {
    let mut feed = DesktopWidgetFeed::default();
    feed.push(friend_online("usr_ada", "Ada"));

    let row = &rows(&feed)[0];

    assert_eq!(row.actor, "Ada");
    assert_eq!(row.detail, "Online");
    assert!(row.show_avatar_slot);
}

#[test]
fn clicking_a_name_opens_that_user() {
    let mut feed = DesktopWidgetFeed::default();
    let id = feed.push(friend_gps("usr_ada", "Ada", "wrld_1:123", "Test World"));

    assert_eq!(
        feed.target(id, DesktopWidgetRowPart::Actor),
        Some(DesktopWidgetTarget::User {
            user_id: "usr_ada".to_string()
        })
    );
}

#[test]
fn clicking_what_happened_opens_the_instance_when_there_is_one() {
    let mut feed = DesktopWidgetFeed::default();
    let id = feed.push(friend_gps("usr_ada", "Ada", "wrld_1:123", "Test World"));

    assert_eq!(
        feed.target(id, DesktopWidgetRowPart::Detail),
        Some(DesktopWidgetTarget::Location {
            location: "wrld_1:123".to_string()
        })
    );
}

#[test]
fn clicking_what_happened_without_a_place_opens_the_user() {
    let mut feed = DesktopWidgetFeed::default();
    let id = feed.push(friend_online("usr_ada", "Ada"));

    assert_eq!(
        feed.target(id, DesktopWidgetRowPart::Detail),
        Some(DesktopWidgetTarget::User {
            user_id: "usr_ada".to_string()
        })
    );
}

#[test]
fn private_places_cannot_be_opened() {
    let mut feed = DesktopWidgetFeed::default();
    let id = feed.push(friend_gps("usr_ada", "Ada", "private", ""));

    assert_eq!(
        feed.target(id, DesktopWidgetRowPart::Detail),
        Some(DesktopWidgetTarget::User {
            user_id: "usr_ada".to_string()
        })
    );
}

#[test]
fn system_rows_without_a_person_open_nothing() {
    let mut feed = DesktopWidgetFeed::default();
    let id = feed.push(system_event("VRCX-0", "Test notification"));

    assert_eq!(feed.target(id, DesktopWidgetRowPart::Actor), None);
    assert_eq!(feed.target(id, DesktopWidgetRowPart::Detail), None);
    assert!(!rows(&feed)[0].show_avatar_slot);
}

#[test]
fn a_blocked_player_in_the_room_is_a_warning_and_favorites_are_starred() {
    let mut feed = DesktopWidgetFeed::default();
    feed.push(blocked_player_joined("usr_ghost", "Ghost"));
    let mut favorite = friend_online("usr_ada", "Ada");
    favorite.actor_relation = ActivityActorRelation::Favorite;
    feed.push(favorite);

    let rows = rows(&feed);

    assert!(rows[0].warning);
    assert!(!rows[0].favorite);
    assert!(!rows[1].warning);
    assert!(rows[1].favorite);
}

#[test]
fn a_friend_avatar_fills_in_after_the_row_is_already_shown() {
    let mut feed = DesktopWidgetFeed::default();
    let entry = friend_online("usr_ada", "Ada");
    let source_id = entry.source_id.clone();
    feed.push(entry);
    assert_eq!(rows(&feed)[0].avatar, None);

    assert!(feed.set_avatar(&source_id, avatar()));

    assert_eq!(rows(&feed)[0].avatar, Some(avatar()));
}

#[test]
fn a_world_name_resolved_later_replaces_the_generic_place() {
    let mut feed = DesktopWidgetFeed::default();
    let entry = friend_gps("usr_ada", "Ada", "wrld_1:123", "wrld_1");
    let source_id = entry.source_id.clone();
    feed.push(entry);
    assert_eq!(rows(&feed)[0].detail, "In an instance");

    assert!(feed.resolve_world_name(&source_id, "Test World"));

    assert_eq!(rows(&feed)[0].detail, "In Test World");
}

#[test]
fn switching_accounts_clears_what_the_previous_account_saw() {
    let mut feed = DesktopWidgetFeed::default();
    feed.push(friend_online("usr_ada", "Ada"));

    feed.clear();

    assert!(rows(&feed).is_empty());
}

#[test]
fn the_widget_keeps_the_fifty_newest_entries() {
    let mut feed = DesktopWidgetFeed::default();
    for index in 0..51 {
        feed.push(friend_online(
            &format!("usr_{index}"),
            &format!("User {index}"),
        ));
    }

    let rows = rows(&feed);

    assert_eq!(rows.len(), 50);
    assert_eq!(rows.first().map(|row| row.actor.as_str()), Some("User 1"));
    assert_eq!(rows.last().map(|row| row.actor.as_str()), Some("User 50"));
}

fn rows(feed: &DesktopWidgetFeed) -> Vec<DesktopWidgetRow> {
    feed.rows(&OverlayLocalizer::new(OverlayLocale::from_config("en")))
}

fn actors(rows: &[DesktopWidgetRow]) -> Vec<&str> {
    rows.iter().map(|row| row.actor.as_str()).collect()
}

fn friend_online(user_id: &str, name: &str) -> ActivityEntry {
    let mut entry = entry(
        ActivityKind::Online,
        ActivityCategory::FavoriteMovement,
        user_id,
        name,
    );
    entry.content.body = ActivityText::message(OverlayMessage::notifications_online());
    entry.actor_relation = ActivityActorRelation::Friend;
    entry
}

fn friend_gps(user_id: &str, name: &str, location: &str, world_name: &str) -> ActivityEntry {
    let mut entry = entry(
        ActivityKind::Gps,
        ActivityCategory::FavoriteMovement,
        user_id,
        name,
    );
    entry.content.location = location.to_string();
    entry.content.world_name = world_name.to_string();
    entry.content.body = ActivityText::message(OverlayMessage::notifications_gps(world_name));
    entry.actor_relation = ActivityActorRelation::Friend;
    entry
}

fn blocked_player_joined(user_id: &str, name: &str) -> ActivityEntry {
    let mut entry = entry(
        ActivityKind::BlockedOnPlayerJoined,
        ActivityCategory::SystemSafety,
        user_id,
        name,
    );
    entry.content.body = ActivityText::literal("Blocked user has joined");
    entry
}

fn system_event(title: &str, body: &str) -> ActivityEntry {
    let mut entry = entry(
        ActivityKind::Event,
        ActivityCategory::SystemSafety,
        "",
        title,
    );
    entry.content.body = ActivityText::literal(body);
    entry
}

fn entry(
    kind: ActivityKind,
    category: ActivityCategory,
    user_id: &str,
    name: &str,
) -> ActivityEntry {
    ActivityEntry {
        sequence: 1,
        source_id: format!("{}:{user_id}:{name}", kind.key()),
        kind,
        category,
        created_at: "2026-06-01T12:34:56.000Z".to_string(),
        actor_user_id: user_id.to_string(),
        actor_display_name: name.to_string(),
        content: ActivityContent {
            title: ActivityText::literal(name),
            ..ActivityContent::default()
        },
        actor_relation: ActivityActorRelation::None,
    }
}

fn avatar() -> AvatarBitmap {
    AvatarBitmap {
        width: 1,
        height: 1,
        rgba: Arc::from([1_u8, 2, 3, 4].as_slice()),
    }
}
