use std::path::PathBuf;

use serde_json::json;

use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::game_log::{GameLogLocationEntry, GameLogLocationTimeUpdate};
use crate::realtime::ensure_realtime_tables;

use super::{
    normalize_user_table_prefix, write_realtime_batch, AvatarTimeSpentUpsert, FriendLogDelete,
    FriendLogUpsert, NotificationExpiration, NotificationV2Update, RealtimePersistenceBatch,
    SelfProfileField, SelfProfileObservation,
};
use crate::ownership::OwnerId;
use vrcx_0_contracts::feed_live::FeedLiveEntry;

fn online_entry(created_at: &str, location: &str, world_name: &str) -> FeedLiveEntry {
    FeedLiveEntry::Online {
        created_at: created_at.into(),
        user_id: "usr_friend".into(),
        display_name: "Friend".into(),
        location: location.into(),
        world_name: world_name.into(),
        group_name: String::new(),
        time: None,
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    }
}

fn relationship_entry(created_at: &str, unfriend: bool) -> FeedLiveEntry {
    let created_at = created_at.to_string();
    let user_id = "usr_friend".to_string();
    let display_name = "Friend".to_string();
    if unfriend {
        FeedLiveEntry::Unfriend {
            created_at,
            user_id,
            display_name,
            owner_user_id: String::new(),
        }
    } else {
        FeedLiveEntry::Friend {
            created_at,
            user_id,
            display_name,
            owner_user_id: String::new(),
        }
    }
}

fn trust_level_entry(created_at: &str, friend_number: i64) -> FeedLiveEntry {
    FeedLiveEntry::TrustLevel {
        created_at: created_at.into(),
        user_id: "usr_friend".into(),
        display_name: "Friend".into(),
        trust_level: "Trusted User".into(),
        previous_trust_level: "Known User".into(),
        friend_number,
        owner_user_id: String::new(),
    }
}

fn untabled_entry(created_at: &str) -> FeedLiveEntry {
    FeedLiveEntry::OnPlayerJoining {
        created_at: created_at.into(),
        user_id: "usr_friend".into(),
        display_name: "Friend".into(),
        location: "traveling".into(),
        traveling_to_location: "wrld_1:123".into(),
        world_name: None,
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
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
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn normalizes_user_table_prefix_like_frontend() {
    assert_eq!(
        normalize_user_table_prefix("usr_123-abc").unwrap(),
        "usr123abc"
    );
    assert_eq!(normalize_user_table_prefix("123").unwrap(), "_123");
}

#[test]
fn rejects_empty_or_injection_user_table_prefix() {
    for user_id in [
        "",
        "   ",
        "usr_self;DROP TABLE usrself_feed_gps",
        "usr_self feed_gps",
        "usr_self.feed_gps",
        "usr_self/feed_gps",
    ] {
        assert!(
            normalize_user_table_prefix(user_id).is_err(),
            "{user_id:?} must not become a table prefix"
        );
    }
}

#[test]
fn writes_friend_log_and_feed_rows() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-persistence");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let counts = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Known".into(),
                friend_number: 12,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            feed_entries: vec![online_entry("2026-05-15T00:00:00Z", "wrld_1:123", "wrld_1")],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    assert_eq!(counts.affected_count, 3);
    assert_eq!(counts.game_log_affected_count, 0);

    let current = db.execute(
        "SELECT user_id, display_name, trust_level, friend_number FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][1], json!("Friend"));
    assert_eq!(current[0][3], json!(12));
    let feed = db.execute(
        "SELECT user_id, type, location FROM usrself_feed_online_offline WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(feed[0][1], json!("Online"));
    assert_eq!(feed[0][2], json!("wrld_1:123"));

    let location_counts = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            game_log_locations: vec![GameLogLocationEntry {
                created_at: "2026-05-15T00:00:05Z".into(),
                location: "wrld_1:123".into(),
                world_id: "wrld_1".into(),
                world_name: "World".into(),
                time: 0,
                group_name: "".into(),
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    assert_eq!(location_counts.affected_count, 1);
    assert_eq!(location_counts.game_log_affected_count, 1);
    Ok(())
}

#[test]
fn writes_bio_feed_rows() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-feed-bio");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let counts = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![FeedLiveEntry::Bio {
                created_at: "2026-09-18T00:00:00Z".into(),
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                bio: "new bio".into(),
                previous_bio: "old bio".into(),
                owner_user_id: String::new(),
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    assert_eq!(counts.affected_count, 1);

    let feed = db.execute(
        "SELECT created_at, display_name, bio, previous_bio FROM usrself_feed_bio WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(
        feed[0],
        vec![
            json!("2026-09-18T00:00:00Z"),
            json!("Friend"),
            json!("new bio"),
            json!("old bio")
        ]
    );
    Ok(())
}

#[test]
fn writes_bio_feed_rows_into_upstream_v18_layout() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-feed-bio-upstream-v18");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    db.execute_non_query(
        "CREATE TABLE usrself_feed_bio (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, bio TEXT, previous_bio TEXT, bio_links TEXT DEFAULT '[]', previous_bio_links TEXT DEFAULT '[]')",
        &Default::default(),
    )?;
    let counts = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![FeedLiveEntry::Bio {
                created_at: "2026-10-05T00:00:00Z".into(),
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                bio: "new bio".into(),
                previous_bio: "old bio".into(),
                owner_user_id: String::new(),
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    assert_eq!(counts.affected_count, 1);

    let feed = db.execute(
        "SELECT bio, previous_bio, bio_links, previous_bio_links FROM usrself_feed_bio WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(
        feed[0],
        vec![json!("new bio"), json!("old bio"), json!("[]"), json!("[]")]
    );
    Ok(())
}

#[test]
fn writes_remote_location_intervals_and_allows_same_location_after_closed_interval(
) -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-remote-location-interval");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let first_location = GameLogLocationEntry {
        created_at: "2026-05-15T00:00:00Z".into(),
        location: "wrld_remote:456".into(),
        world_id: "wrld_remote".into(),
        world_name: "Remote World".into(),
        time: 0,
        group_name: "".into(),
    };

    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            game_log_locations: vec![first_location.clone()],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let close_counts = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            game_log_location_time_updates: vec![GameLogLocationTimeUpdate {
                created_at: first_location.created_at,
                time: 180_000,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let restart_counts = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            game_log_locations: vec![GameLogLocationEntry {
                created_at: "2026-05-15T00:03:20Z".into(),
                ..first_location
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    assert_eq!(close_counts.game_log_affected_count, 1);
    assert_eq!(restart_counts.game_log_affected_count, 1);
    let rows = db.execute(
        "SELECT created_at, location, time FROM gamelog_location ORDER BY created_at ASC",
        &Default::default(),
    )?;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0][0], json!("2026-05-15T00:00:00Z"));
    assert_eq!(rows[0][1], json!("wrld_remote:456"));
    assert_eq!(rows[0][2], json!(180_000));
    assert_eq!(rows[1][0], json!("2026-05-15T00:03:20Z"));
    assert_eq!(rows[1][1], json!("wrld_remote:456"));
    assert_eq!(rows[1][2], json!(0));
    Ok(())
}

#[test]
fn friend_and_unfriend_feed_markers_are_skipped_not_persisted_as_feed_rows(
) -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-friend-unfriend-feed-marker");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Known".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            feed_entries: vec![relationship_entry("2026-05-15T00:00:00Z", false)],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let friend_history = db.execute(
        "SELECT type FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'Friend'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(friend_history.len(), 1);

    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_deletes: vec![FriendLogDelete {
                target_user_id: "usr_friend".into(),
                created_at: "2026-05-15T00:00:01Z".into(),
            }],
            feed_entries: vec![relationship_entry("2026-05-15T00:00:01Z", true)],
            ..RealtimePersistenceBatch::default()
        },
    )?;
    let current = db.execute(
        "SELECT user_id FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert!(current.is_empty());
    let unfriend_history = db.execute(
        "SELECT type FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'Unfriend'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(unfriend_history.len(), 1);
    Ok(())
}

#[test]
fn force_history_false_skips_friend_history_on_update() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-force-history-false");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    let upsert = |name: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: "Known".into(),
            friend_number: 12,
            created_at: "2026-05-15T00:00:00Z".into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(&db, &OwnerId::new("usr_self"), &upsert("Friend"))?;
    write_realtime_batch(&db, &OwnerId::new("usr_self"), &upsert("Friend Renamed"))?;

    let history = db.execute(
        "SELECT user_id FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'Friend'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(history.len(), 1);
    Ok(())
}

#[test]
fn display_name_change_on_update_writes_display_name_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-display-name-change");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    let upsert = |name: &str, trust: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: trust.into(),
            friend_number: 12,
            created_at: "2026-05-15T00:00:00Z".into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(&db, &OwnerId::new("usr_self"), &upsert("Friend", "Known"))?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &upsert("Friend Renamed", ""),
    )?;

    let history = db.execute(
        "SELECT display_name, previous_display_name FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'DisplayName'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0][0], json!("Friend Renamed"));
    assert_eq!(history[0][1], json!("Friend"));

    let current = db.execute(
        "SELECT display_name, trust_level FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][0], json!("Friend Renamed"));
    assert_eq!(current[0][1], json!("Known"));
    Ok(())
}

#[test]
fn trust_change_on_update_writes_trust_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-trust-change");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let upsert = |name: &str, trust: &str, created_at: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: trust.into(),
            friend_number: 12,
            created_at: created_at.into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &upsert("Friend", "Known User", "2026-05-15T00:00:00Z"),
    )?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &upsert("Friend", "Trusted User", "2026-05-15T00:00:01Z"),
    )?;

    let history = db.execute(
        "SELECT display_name, trust_level, previous_trust_level, friend_number FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'TrustLevel'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(history.len(), 1);
    assert_eq!(history[0][0], json!("Friend"));
    assert_eq!(history[0][1], json!("Trusted User"));
    assert_eq!(history[0][2], json!("Known User"));
    assert_eq!(history[0][3], json!(12));
    Ok(())
}

#[test]
fn simultaneous_name_and_trust_change_writes_both_histories() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-name-trust-change");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let batch = |name: &str, trust: &str, created_at: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: trust.into(),
            friend_number: 12,
            created_at: created_at.into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &batch("Old Name", "Known User", "2026-05-15T00:00:00Z"),
    )?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &batch("New Name", "Trusted User", "2026-05-15T00:00:01Z"),
    )?;

    let history = db.execute(
        "SELECT type FROM usrself_friend_log_history WHERE user_id = @user_id AND type IN ('DisplayName', 'TrustLevel') ORDER BY type",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(
        history,
        vec![vec![json!("DisplayName")], vec![json!("TrustLevel")]]
    );
    Ok(())
}

#[test]
fn empty_same_and_legacy_equivalent_trust_values_skip_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-trust-skip");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let batch = |trust: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: "Friend".into(),
            trust_level: trust.into(),
            friend_number: 12,
            created_at: "2026-05-15T00:00:00Z".into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(&db, &OwnerId::new("usr_self"), &batch("Trusted User"))?;
    write_realtime_batch(&db, &OwnerId::new("usr_self"), &batch(""))?;
    write_realtime_batch(&db, &OwnerId::new("usr_self"), &batch("Trusted User"))?;
    write_realtime_batch(&db, &OwnerId::new("usr_self"), &batch("Veteran User"))?;

    let history = db.execute(
        "SELECT trust_level FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'TrustLevel'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    let current = db.execute(
        "SELECT trust_level FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert!(history.is_empty());
    assert_eq!(current[0][0], json!("Veteran User"));
    Ok(())
}

#[test]
fn failed_trust_batch_rolls_back_current_and_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-trust-rollback");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Known User".into(),
                friend_number: 12,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let result = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Trusted User".into(),
                friend_number: 12,
                created_at: "2026-05-15T00:00:01Z".into(),
                force_history: false,
            }],
            feed_entries: vec![untabled_entry("2026-05-15T00:00:01Z")],
            ..RealtimePersistenceBatch::default()
        },
    );
    assert!(result.is_err());

    let current = db.execute(
        "SELECT trust_level FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    let history = db.execute(
        "SELECT trust_level FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'TrustLevel'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][0], json!("Known User"));
    assert!(history.is_empty());
    Ok(())
}

#[test]
fn unchanged_or_unknown_display_name_skips_display_name_history() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-display-name-skip");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    let upsert = |name: &str| RealtimePersistenceBatch {
        friend_log_upserts: vec![FriendLogUpsert {
            target_user_id: "usr_friend".into(),
            display_name: name.into(),
            trust_level: "Known".into(),
            friend_number: 12,
            created_at: "2026-05-15T00:00:00Z".into(),
            force_history: false,
        }],
        ..RealtimePersistenceBatch::default()
    };

    write_realtime_batch(&db, &OwnerId::new("usr_self"), &upsert(""))?;
    write_realtime_batch(&db, &OwnerId::new("usr_self"), &upsert("First Known Name"))?;
    write_realtime_batch(&db, &OwnerId::new("usr_self"), &upsert("First Known Name"))?;
    write_realtime_batch(&db, &OwnerId::new("usr_self"), &upsert(""))?;
    write_realtime_batch(&db, &OwnerId::new("usr_self"), &upsert("Unknown"))?;

    let history = db.execute(
        "SELECT display_name FROM usrself_friend_log_history WHERE user_id = @user_id AND type = 'DisplayName'",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert!(history.is_empty());

    let current = db.execute(
        "SELECT display_name FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][0], json!("First Known Name"));
    Ok(())
}

#[test]
fn blank_display_name_persists_unknown_not_user_id() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-unknown-display-name");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: String::new(),
                trust_level: "Known".into(),
                friend_number: 12,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let current = db.execute(
        "SELECT display_name FROM usrself_friend_log_current WHERE user_id = @user_id",
        &ParamsBuilder::new().set("user_id", "usr_friend").build(),
    )?;
    assert_eq!(current[0][0], json!("Unknown"));
    Ok(())
}

#[test]
fn rejects_trust_feed_without_matching_friend_log_upsert() {
    let dir = TestDir::new("realtime-unpaired-trust-feed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();

    let error = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![trust_level_entry("2026-05-15T00:00:00Z", 7)],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();

    assert!(matches!(error, crate::Error::InvalidData(_)));
}

#[test]
fn rejects_display_name_feed_without_matching_friend_log_upsert() {
    let dir = TestDir::new("realtime-unpaired-display-name-feed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();

    let error = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![FeedLiveEntry::DisplayName {
                created_at: "2026-05-15T00:00:00Z".into(),
                user_id: "usr_friend".into(),
                display_name: "New Name".into(),
                previous_display_name: "Old Name".into(),
                friend_number: 7,
                owner_user_id: String::new(),
            }],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();

    assert!(matches!(error, crate::Error::InvalidData(_)));
}

#[test]
fn rolls_back_friend_log_rows_when_later_feed_entry_fails() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-rollback-feed");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    let error = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                trust_level: "Known".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            feed_entries: vec![untabled_entry("2026-05-15T00:00:01Z")],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();
    assert!(matches!(error, crate::Error::InvalidData(_)));

    let current = db.execute(
        "SELECT COUNT(*) FROM usrself_friend_log_current",
        &Default::default(),
    )?;
    let history = db.execute(
        "SELECT COUNT(*) FROM usrself_friend_log_history",
        &Default::default(),
    )?;
    assert_eq!(current[0][0], json!(0));
    assert_eq!(history[0][0], json!(0));
    Ok(())
}

#[test]
fn realtime_schema_adds_v1_seen_column_and_backfills_expired_rows() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-notification-v1-seen-upgrade");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    db.execute_non_query(
        "CREATE TABLE usrself_notifications (id TEXT PRIMARY KEY, created_at TEXT, type TEXT, sender_user_id TEXT, sender_username TEXT, receiver_user_id TEXT, message TEXT, world_id TEXT, world_name TEXT, image_url TEXT, invite_message TEXT, request_message TEXT, response_message TEXT, expired INTEGER)",
        &Default::default(),
    )?;
    db.execute_non_query(
        "INSERT INTO usrself_notifications (id, created_at, type, expired) VALUES ('active', '2026-08-20T11:00:00Z', 'friendRequest', 0), ('expired', '2026-08-20T10:00:00Z', 'friendRequest', 1)",
        &Default::default(),
    )?;

    ensure_realtime_tables(&db, "usrself")?;

    let columns = db.execute(
        "PRAGMA table_info(usrself_notifications)",
        &Default::default(),
    )?;
    let seen_column = columns
        .iter()
        .find(|column| column.get(1) == Some(&json!("seen")))
        .unwrap();
    assert_eq!(seen_column[3], json!(1));
    assert_eq!(seen_column[4], json!("0"));
    let rows = db.execute(
        "SELECT id, seen FROM usrself_notifications ORDER BY id",
        &Default::default(),
    )?;
    assert_eq!(
        rows,
        vec![
            vec![json!("active"), json!(0)],
            vec![json!("expired"), json!(1)]
        ]
    );
    Ok(())
}

#[test]
fn expiring_a_v1_notification_marks_it_seen() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-notification-v1-expire-seen");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let owner = OwnerId::new("usr_self");
    write_realtime_batch(
        &db,
        &owner,
        &RealtimePersistenceBatch {
            notification_v1_upserts: vec![json!({
                "id": "notif_v1",
                "createdAt": "2026-05-15T00:00:00Z",
                "type": "friendRequest",
                "senderUserId": "usr_sender",
            })],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    write_realtime_batch(
        &db,
        &owner,
        &RealtimePersistenceBatch {
            notification_expirations: vec![NotificationExpiration {
                id: "notif_v1".into(),
                expired_at: "2026-05-15T01:00:00Z".into(),
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let rows = db.execute(
        "SELECT expired, seen FROM usrself_notifications WHERE id = 'notif_v1'",
        &Default::default(),
    )?;
    assert_eq!(rows, vec![vec![json!(1), json!(1)]]);
    Ok(())
}

#[test]
fn writes_notification_v1_and_v2_schema_columns() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-notification-columns");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            notification_v1_upserts: vec![json!({
                "id": "notif_v1",
                "createdAt": "2026-05-15T00:00:00Z",
                "type": "invite",
                "senderUserId": "usr_sender",
                "senderUsername": "Sender",
                "receiverUserId": "usr_self",
                "message": "Join me",
                "imageUrl": "https://images.example/fallback.png",
                "$isExpired": true,
                "details": {
                    "worldId": "wrld_invite",
                    "worldName": "Invite World",
                    "imageUrl": "https://images.example/details.png",
                    "inviteMessage": "Invite text",
                    "requestMessage": "Request text",
                    "responseMessage": "Response text"
                }
            })],
            notification_v2_upserts: vec![json!({
                "id": "notif_v2",
                "createdAt": "2026-05-15T00:01:00Z",
                "updatedAt": "2026-05-15T00:01:01Z",
                "expiresAt": "2026-05-16T00:01:00Z",
                "type": "friendRequest",
                "link": "https://vrchat.com/home/user/usr_sender",
                "linkText": "Open user",
                "message": "Add me",
                "title": "Friend request",
                "imageUrl": "https://images.example/v2.png",
                "seen": true,
                "senderUserId": "usr_sender_v2",
                "senderUsername": "Sender Two",
                "data": { "groupName": "Group Alpha" },
                "responses": [{ "type": "accept" }],
                "details": { "worldId": "wrld_v2", "worldName": "V2 World" }
            })],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let v1 = db.execute(
        concat!(
            "SELECT created_at, type, sender_user_id, sender_username, receiver_user_id, ",
            "message, world_id, world_name, image_url, invite_message, request_message, ",
            "response_message, expired, seen FROM usrself_notifications WHERE id = @id"
        ),
        &ParamsBuilder::new().set("id", "notif_v1").build(),
    )?;
    assert_eq!(v1[0][0], json!("2026-05-15T00:00:00Z"));
    assert_eq!(v1[0][1], json!("invite"));
    assert_eq!(v1[0][2], json!("usr_sender"));
    assert_eq!(v1[0][3], json!("Sender"));
    assert_eq!(v1[0][4], json!("usr_self"));
    assert_eq!(v1[0][5], json!("Join me"));
    assert_eq!(v1[0][6], json!("wrld_invite"));
    assert_eq!(v1[0][7], json!("Invite World"));
    assert_eq!(v1[0][8], json!("https://images.example/details.png"));
    assert_eq!(v1[0][9], json!("Invite text"));
    assert_eq!(v1[0][10], json!("Request text"));
    assert_eq!(v1[0][11], json!("Response text"));
    assert_eq!(v1[0][12], json!(1));
    assert_eq!(v1[0][13], json!(1));

    let v2 = db.execute(
        concat!(
            "SELECT created_at, updated_at, expires_at, type, link, link_text, message, ",
            "title, image_url, seen, sender_user_id, sender_username, data, responses, ",
            "details FROM usrself_notifications_v2 WHERE id = @id"
        ),
        &ParamsBuilder::new().set("id", "notif_v2").build(),
    )?;
    assert_eq!(v2[0][0], json!("2026-05-15T00:01:00Z"));
    assert_eq!(v2[0][1], json!("2026-05-15T00:01:01Z"));
    assert_eq!(v2[0][2], json!("2026-05-16T00:01:00Z"));
    assert_eq!(v2[0][3], json!("friendRequest"));
    assert_eq!(v2[0][4], json!("https://vrchat.com/home/user/usr_sender"));
    assert_eq!(v2[0][5], json!("Open user"));
    assert_eq!(v2[0][6], json!("Add me"));
    assert_eq!(v2[0][7], json!("Friend request"));
    assert_eq!(v2[0][8], json!("https://images.example/v2.png"));
    assert_eq!(v2[0][9], json!(1));
    assert_eq!(v2[0][10], json!("usr_sender_v2"));
    assert_eq!(v2[0][11], json!("Sender Two"));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(v2[0][12].as_str().unwrap())?,
        json!({ "groupName": "Group Alpha" })
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(v2[0][13].as_str().unwrap())?,
        json!([{ "type": "accept" }])
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(v2[0][14].as_str().unwrap())?,
        json!({ "worldId": "wrld_v2", "worldName": "V2 World" })
    );
    Ok(())
}

#[test]
fn notification_v2_update_falls_back_to_upsert_with_received_timestamp() -> Result<(), crate::Error>
{
    let dir = TestDir::new("realtime-notification-update-fallback");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            notification_v2_updates: vec![NotificationV2Update {
                id: "notif_update".into(),
                received_at: "2026-05-15T00:02:00Z".into(),
                updates: json!({
                    "type": "invite",
                    "message": "Fallback insert",
                    "seen": true,
                    "data": { "groupName": "Inserted" },
                    "responses": [],
                    "details": { "worldId": "wrld_inserted" }
                }),
            }],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let inserted = db.execute(
        concat!(
            "SELECT created_at, type, message, seen, data, details ",
            "FROM usrself_notifications_v2 WHERE id = @id"
        ),
        &ParamsBuilder::new().set("id", "notif_update").build(),
    )?;
    assert_eq!(inserted[0][0], json!("2026-05-15T00:02:00Z"));
    assert_eq!(inserted[0][1], json!("invite"));
    assert_eq!(inserted[0][2], json!("Fallback insert"));
    assert_eq!(inserted[0][3], json!(1));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(inserted[0][4].as_str().unwrap())?,
        json!({ "groupName": "Inserted" })
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(inserted[0][5].as_str().unwrap())?,
        json!({ "worldId": "wrld_inserted" })
    );
    Ok(())
}

#[test]
fn notification_v2_realtime_upsert_does_not_make_seen_rows_unseen() -> Result<(), crate::Error> {
    let dir = TestDir::new("realtime-notification-seen-monotonic");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let notification = |seen| {
        json!({
            "id": "notif_seen",
            "createdAt": "2026-07-22T00:00:00Z",
            "type": "inviteResponse",
            "seen": seen
        })
    };

    for seen in [true, false] {
        write_realtime_batch(
            &db,
            &OwnerId::new("usr_self"),
            &RealtimePersistenceBatch {
                notification_v2_upserts: vec![notification(seen)],
                ..RealtimePersistenceBatch::default()
            },
        )?;
    }

    let rows = db.execute(
        "SELECT seen FROM usrself_notifications_v2 WHERE id = @id",
        &ParamsBuilder::new().set("id", "notif_seen").build(),
    )?;
    assert_eq!(rows[0][0], json!(1));
    Ok(())
}

#[test]
fn rejects_notifications_missing_required_fields() {
    let dir = TestDir::new("realtime-invalid-notification");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();

    let v1_error = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            notification_v1_upserts: vec![json!({
                "id": "not_1",
                "createdAt": "2026-05-15T00:00:00Z",
            })],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();
    assert!(matches!(v1_error, crate::Error::InvalidData(_)));

    let v2_error = write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            notification_v2_upserts: vec![json!({
                "id": "not_2",
                "type": "invite",
            })],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap_err();
    assert!(matches!(v2_error, crate::Error::InvalidData(_)));
}

fn self_profile_log_rows(db: &DatabaseService) -> Vec<Vec<serde_json::Value>> {
    db.execute(
        "SELECT created_at, field, value, previous_value FROM usrself_self_profile_log ORDER BY id",
        &Default::default(),
    )
    .unwrap()
}

fn self_profile_observation(
    observed_at: &str,
    field: SelfProfileField,
    value: &str,
) -> SelfProfileObservation {
    SelfProfileObservation {
        observed_at: observed_at.to_string(),
        field,
        value: value.to_string(),
    }
}

fn write_self_profile_observations(
    db: &DatabaseService,
    observations: Vec<SelfProfileObservation>,
) {
    write_realtime_batch(
        db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            self_profile_observations: observations,
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap();
}

#[test]
fn self_profile_observations_log_only_values_that_differ_from_the_latest_row() {
    let dir = TestDir::new("self-profile-changes");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();

    for (observed_at, bio) in [
        ("2026-05-15T00:00:00Z", "old bio"),
        ("2026-05-16T00:00:00Z", "old bio"),
        ("2026-05-17T00:00:00Z", "new bio"),
        ("2026-05-18T00:00:00Z", "new bio"),
    ] {
        write_self_profile_observations(
            &db,
            vec![
                self_profile_observation(observed_at, SelfProfileField::Status, "join me"),
                self_profile_observation(observed_at, SelfProfileField::Bio, bio),
            ],
        );
    }

    assert_eq!(
        self_profile_log_rows(&db),
        vec![
            vec![
                json!("2026-05-15T00:00:00Z"),
                json!("status"),
                json!("join me"),
                json!(""),
            ],
            vec![
                json!("2026-05-15T00:00:00Z"),
                json!("bio"),
                json!("old bio"),
                json!(""),
            ],
            vec![
                json!("2026-05-17T00:00:00Z"),
                json!("bio"),
                json!("new bio"),
                json!("old bio"),
            ],
        ]
    );
}

#[test]
fn checkpointed_avatar_wear_extends_one_log_row_and_adds_only_the_new_time(
) -> Result<(), crate::Error> {
    let dir = TestDir::new("avatar-wear-checkpoint");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let started_at_ms = 1_790_863_200_000;
    for (time_spent, ended_after_ms) in [(60_000, 60_000), (30_000, 90_000)] {
        write_realtime_batch(
            &db,
            &OwnerId::new("usr_self"),
            &RealtimePersistenceBatch {
                avatar_time_spent_upserts: vec![AvatarTimeSpentUpsert {
                    avatar_id: "avtr_worn".into(),
                    created_at: "2026-10-01T14:00:00.000Z".into(),
                    time_spent,
                    started_at_ms,
                    ended_at_ms: started_at_ms + ended_after_ms,
                }],
                ..RealtimePersistenceBatch::default()
            },
        )?;
    }

    let wear_rows = db.execute(
        "SELECT started_at, ended_at, time FROM usrself_avatar_wear_log",
        &Default::default(),
    )?;
    assert_eq!(wear_rows.len(), 1);
    assert_eq!(wear_rows[0][0], json!("2026-10-01T14:00:00.000Z"));
    assert_eq!(wear_rows[0][1], json!("2026-10-01T14:01:30.000Z"));
    assert_eq!(wear_rows[0][2], json!(90_000));
    let history = db.execute(
        "SELECT time FROM usrself_avatar_history WHERE avatar_id = 'avtr_worn'",
        &Default::default(),
    )?;
    assert_eq!(history[0][0], json!(90_000));
    Ok(())
}

#[test]
fn durable_realtime_replay_is_atomic_and_does_not_add_avatar_time_twice() -> Result<(), crate::Error>
{
    let dir = TestDir::new("realtime-durable-replay");
    let path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&path)?;
    let owner = OwnerId::new("usr_self");
    ensure_realtime_tables(&db, "usrself")?;
    let batch = RealtimePersistenceBatch {
        avatar_time_spent_upserts: vec![AvatarTimeSpentUpsert {
            avatar_id: "avtr_worn".into(),
            created_at: "2026-10-01T14:00:00.000Z".into(),
            time_spent: 60_000,
            started_at_ms: 1_790_863_200_000,
            ended_at_ms: 1_790_863_260_000,
        }],
        ..Default::default()
    };
    db.execute_non_query("CREATE TRIGGER fail_avatar BEFORE INSERT ON usrself_avatar_history BEGIN SELECT RAISE(ABORT, 'forced failure'); END", &Default::default())?;
    assert!(super::write_realtime_batch_once(&db, &owner, &batch, "durable-batch").is_err());
    assert!(db
        .execute(
            "SELECT 1 FROM collector_realtime_batches",
            &Default::default()
        )?
        .is_empty());
    db.execute_non_query("DROP TRIGGER fail_avatar", &Default::default())?;
    super::write_realtime_batch_once(&db, &owner, &batch, "durable-batch")?;
    drop(db);
    let reopened = DatabaseService::new(&path)?;
    assert_eq!(
        super::write_realtime_batch_once(&reopened, &owner, &batch, "durable-batch")?,
        Default::default()
    );
    assert_eq!(
        reopened.execute(
            "SELECT time FROM usrself_avatar_history WHERE avatar_id = 'avtr_worn'",
            &Default::default()
        )?[0][0],
        json!(60_000)
    );
    Ok(())
}
