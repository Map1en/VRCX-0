use std::path::PathBuf;

use serde_json::Value;
use vrcx_0_core::json::RawJson;

use super::*;

pub(super) struct TestDir {
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

pub(super) struct TestDatabase {
    _dir: TestDir,
    pub(super) db: DatabaseService,
}

pub(super) fn test_db(name: &str) -> Result<TestDatabase, crate::Error> {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    ensure_game_log_tables(&db)?;
    Ok(TestDatabase { _dir: dir, db })
}

pub(super) fn query(
    db: &DatabaseService,
    kind: &str,
    params: serde_json::Value,
) -> Result<Value, Error> {
    game_log_query(
        db,
        "usr_test",
        GameLogQueryInput {
            kind: kind.into(),
            params: RawJson::from(params),
        },
    )
}

pub(super) fn rows(value: Value) -> Vec<Value> {
    value.as_array().cloned().unwrap_or_default()
}

pub(super) fn row_texts(rows: &[Value], key: &str) -> Vec<String> {
    rows.iter()
        .filter_map(|row| {
            row.get(key)
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .collect()
}

pub(super) fn seed_fixture(db: &DatabaseService) -> Result<(), Error> {
    write_game_log_batch(
        db,
        "usr_test",
        &GameLogWriteBatch {
            locations: vec![
                GameLogLocationEntry {
                    created_at: "2026-05-14T08:00:00Z".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                    world_id: "wrld_alpha".into(),
                    world_name: "Alpha World".into(),
                    time: 60_000,
                    group_name: "Group Alpha".into(),
                },
                GameLogLocationEntry {
                    created_at: "2026-05-14T09:00:00Z".into(),
                    location: "wrld_beta:inst-b".into(),
                    world_id: "wrld_beta".into(),
                    world_name: "Beta World".into(),
                    time: 120_000,
                    group_name: String::new(),
                },
                GameLogLocationEntry {
                    created_at: "2026-05-14T10:00:00Z".into(),
                    location: "wrld_alpha:inst-c~group(grp_alpha)".into(),
                    world_id: "wrld_alpha".into(),
                    world_name: "Alpha World".into(),
                    time: 90_000,
                    group_name: "Group Alpha".into(),
                },
            ],
            join_leave: vec![
                GameLogJoinLeaveEntry {
                    created_at: "2026-05-14T08:01:00Z".into(),
                    event_type: "OnPlayerJoined".into(),
                    display_name: "Vip Friend".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                    user_id: "usr_vip".into(),
                    world_name: "Alpha World".into(),
                    time: 0,
                },
                GameLogJoinLeaveEntry {
                    created_at: "2026-05-14T08:02:00Z".into(),
                    event_type: "OnPlayerJoined".into(),
                    display_name: "Self User".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                    user_id: "usr_self".into(),
                    world_name: "Alpha World".into(),
                    time: 0,
                },
                GameLogJoinLeaveEntry {
                    created_at: "2026-05-14T08:03:00Z".into(),
                    event_type: "OnPlayerJoined".into(),
                    display_name: "Other Friend".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                    user_id: "usr_other".into(),
                    world_name: "Alpha World".into(),
                    time: 0,
                },
                GameLogJoinLeaveEntry {
                    created_at: "2026-05-14T08:30:00Z".into(),
                    event_type: "OnPlayerLeft".into(),
                    display_name: "Vip Friend".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                    user_id: "usr_vip".into(),
                    world_name: "Alpha World".into(),
                    time: 1_800_000,
                },
                GameLogJoinLeaveEntry {
                    created_at: "2026-05-14T09:10:00Z".into(),
                    event_type: "OnPlayerJoined".into(),
                    display_name: "Old Target".into(),
                    location: "wrld_beta:inst-b".into(),
                    user_id: "usr_target".into(),
                    world_name: "Beta World".into(),
                    time: 0,
                },
                GameLogJoinLeaveEntry {
                    created_at: "2026-05-14T09:20:00Z".into(),
                    event_type: "OnPlayerLeft".into(),
                    display_name: "New Target".into(),
                    location: "wrld_beta:inst-b".into(),
                    user_id: "usr_target".into(),
                    world_name: "Beta World".into(),
                    time: 900_000,
                },
                GameLogJoinLeaveEntry {
                    created_at: "2026-05-14T10:05:00Z".into(),
                    event_type: "OnPlayerJoined".into(),
                    display_name: "Late Friend".into(),
                    location: "wrld_alpha:inst-c~group(grp_alpha)".into(),
                    user_id: "usr_late".into(),
                    world_name: "Alpha World".into(),
                    time: 0,
                },
            ],
            portal_spawns: vec![
                GameLogPortalSpawnEntry {
                    created_at: "2026-05-14T08:04:00Z".into(),
                    display_name: "Vip Friend".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                    user_id: "usr_vip".into(),
                    instance_id: "wrld_portal:123".into(),
                    world_name: "Portal World".into(),
                },
                GameLogPortalSpawnEntry {
                    created_at: "2026-05-14T08:05:00Z".into(),
                    display_name: "Other Friend".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                    user_id: "usr_other".into(),
                    instance_id: "wrld_other:123".into(),
                    world_name: "Other World".into(),
                },
            ],
            video_plays: vec![
                GameLogVideoPlayEntry {
                    created_at: "2026-05-14T08:06:00Z".into(),
                    video_url: "https://video.example/needle".into(),
                    video_name: "Needle Video".into(),
                    video_id: "vid_needle".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                    display_name: "Vip Friend".into(),
                    user_id: "usr_vip".into(),
                },
                GameLogVideoPlayEntry {
                    created_at: "2026-05-14T09:06:00Z".into(),
                    video_url: "https://video.example/other".into(),
                    video_name: "Other Video".into(),
                    video_id: "vid_other".into(),
                    location: "wrld_beta:inst-b".into(),
                    display_name: "Other Friend".into(),
                    user_id: "usr_other".into(),
                },
            ],
            resource_loads: vec![
                GameLogResourceLoadEntry {
                    created_at: "2026-05-14T08:07:00Z".into(),
                    resource_url: "https://assets.example/needle.png".into(),
                    resource_type: "ImageLoad".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                },
                GameLogResourceLoadEntry {
                    created_at: "2026-05-14T08:08:00Z".into(),
                    resource_url: "https://assets.example/string.json".into(),
                    resource_type: "StringLoad".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                },
                GameLogResourceLoadEntry {
                    created_at: "2026-05-14T09:08:00Z".into(),
                    resource_url: "https://assets.example/beta.png".into(),
                    resource_type: "ImageLoad".into(),
                    location: "wrld_beta:inst-b".into(),
                },
            ],
            events: vec![GameLogEventEntry {
                created_at: "2026-05-14T08:09:00Z".into(),
                data: "Needle Event".into(),
            }],
            externals: vec![
                GameLogExternalEntry {
                    created_at: "2026-05-14T08:10:00Z".into(),
                    message: "Needle External".into(),
                    display_name: "Vip Friend".into(),
                    user_id: "usr_vip".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                },
                GameLogExternalEntry {
                    created_at: "2026-05-14T08:11:00Z".into(),
                    message: "Other External".into(),
                    display_name: "Other Friend".into(),
                    user_id: "usr_other".into(),
                    location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
                },
            ],
            ..GameLogWriteBatch::default()
        },
    )?;
    Ok(())
}
