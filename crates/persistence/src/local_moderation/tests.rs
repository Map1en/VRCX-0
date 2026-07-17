use std::path::PathBuf;

use super::*;

struct TestDatabase {
    _dir: TestDir,
    db: DatabaseService,
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
            "vrcx-0-local-moderation-{name}-{}-{nonce}",
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

fn test_db(name: &str) -> Result<TestDatabase, Error> {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    Ok(TestDatabase { _dir: dir, db })
}

fn local_entry(user_id: &str, block: bool, mute: bool) -> LocalModerationInput {
    LocalModerationInput {
        user_id: user_id.into(),
        updated_at: "2026-07-01T00:00:00Z".into(),
        display_name: format!("Name {user_id}"),
        block,
        mute,
    }
}

fn remote_entry(
    kind: &str,
    user_id: &str,
    display_name: &str,
    created: &str,
) -> RemoteModerationInput {
    RemoteModerationInput {
        r#type: kind.into(),
        target_user_id: user_id.into(),
        target_display_name: display_name.into(),
        created: created.into(),
    }
}

#[test]
fn snapshot_merges_block_and_mute_and_ignores_invalid_rows() -> Result<(), Error> {
    let test_db = test_db("merge")?;

    let rows = local_moderation_sync_snapshot(
        &test_db.db,
        "usr_owner".into(),
        vec![
            remote_entry(
                "block",
                " usr_target ",
                "First Name",
                "2026-07-01T00:00:00Z",
            ),
            remote_entry("unknown", "usr_unknown", "Unknown", "2026-07-01T00:01:00Z"),
            remote_entry("mute", "usr_target", "Final Name", "2026-07-01T00:02:00Z"),
            remote_entry("block", "   ", "Empty", "2026-07-01T00:03:00Z"),
        ],
    )?;

    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.user_id, "usr_target");
    assert_eq!(row.display_name, "Final Name");
    assert_eq!(row.updated_at, "2026-07-01T00:02:00Z");
    assert!(row.block);
    assert!(row.mute);
    assert!(local_moderation_get(&test_db.db, "usr_owner".into(), "usr_unknown".into())?.is_none());
    Ok(())
}

#[test]
fn snapshot_deletes_stale_rows_and_empty_snapshot_clears_owner() -> Result<(), Error> {
    let test_db = test_db("replacement")?;
    local_moderation_set(
        &test_db.db,
        "usr_owner".into(),
        local_entry("usr_stale", true, false),
    )?;
    local_moderation_set(
        &test_db.db,
        "usr_owner".into(),
        local_entry("usr_kept", false, true),
    )?;

    local_moderation_sync_snapshot(
        &test_db.db,
        "usr_owner".into(),
        vec![remote_entry(
            "block",
            "usr_kept",
            "Kept",
            "2026-07-02T00:00:00Z",
        )],
    )?;
    assert!(local_moderation_get(&test_db.db, "usr_owner".into(), "usr_stale".into())?.is_none());
    assert!(local_moderation_get(&test_db.db, "usr_owner".into(), "usr_kept".into())?.is_some());

    let rows = local_moderation_sync_snapshot(&test_db.db, "usr_owner".into(), Vec::new())?;
    assert!(rows.is_empty());
    assert!(local_moderation_list(&test_db.db, "usr_owner".into())?.is_empty());
    Ok(())
}

#[test]
fn set_get_delete_are_normalized_and_isolated_by_owner() -> Result<(), Error> {
    let test_db = test_db("owner-isolation")?;
    local_moderation_set(
        &test_db.db,
        " usr_owner_a ".into(),
        local_entry(" usr_target ", true, false),
    )?;
    local_moderation_set(
        &test_db.db,
        "usr_owner_b".into(),
        local_entry("usr_target", false, true),
    )?;

    let owner_a =
        local_moderation_get(&test_db.db, "usr_owner_a".into(), " usr_target ".into())?.unwrap();
    let owner_b =
        local_moderation_get(&test_db.db, "usr_owner_b".into(), "usr_target".into())?.unwrap();
    assert!(owner_a.block);
    assert!(!owner_a.mute);
    assert!(!owner_b.block);
    assert!(owner_b.mute);

    local_moderation_delete(&test_db.db, "usr_owner_a".into(), " usr_target ".into())?;
    assert!(
        local_moderation_get(&test_db.db, "usr_owner_a".into(), "usr_target".into())?.is_none()
    );
    assert!(
        local_moderation_get(&test_db.db, "usr_owner_b".into(), "usr_target".into())?.is_some()
    );
    assert!(local_moderation_list(&test_db.db, "   ".into())?.is_empty());
    Ok(())
}
