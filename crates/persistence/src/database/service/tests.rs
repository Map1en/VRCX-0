use super::upgrade::status_temporary_path;
use super::*;

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
fn executes_daily_named_parameter_reads_and_writes() -> Result<(), Error> {
    let dir = TestDir::new("sqlite-daily");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();

    db.execute_non_query(
        "CREATE TABLE daily_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, visits INTEGER NOT NULL)",
        &empty,
    )?;

    let mut args = HashMap::new();
    args.insert("@id".to_string(), serde_json::json!(1));
    args.insert("@name".to_string(), serde_json::json!("trusted"));
    args.insert("@visits".to_string(), serde_json::json!(3));
    assert_eq!(
        db.execute_non_query(
            "INSERT INTO daily_items (id, name, visits) VALUES (@id, @name, @visits)",
            &args,
        )?,
        1
    );

    let mut update_args = HashMap::new();
    update_args.insert("@id".to_string(), serde_json::json!(1));
    update_args.insert("@visits".to_string(), serde_json::json!(4));
    assert_eq!(
        db.execute_non_query(
            "UPDATE daily_items SET visits = @visits WHERE id = @id",
            &update_args,
        )?,
        1
    );

    let rows = db.execute(
        "SELECT name, visits FROM daily_items WHERE id = @id",
        &update_args,
    )?;

    assert_eq!(
        rows,
        vec![vec![serde_json::json!("trusted"), serde_json::json!(4)]]
    );
    Ok(())
}

#[test]
fn configured_writer_enables_secure_delete() -> Result<(), Error> {
    let conn = Connection::open_in_memory().map_err(|e| Error::Database(e.to_string()))?;
    configure_connection(&conn)?;
    let enabled = conn
        .query_row("PRAGMA secure_delete;", [], |row| row.get::<_, i64>(0))
        .map_err(|e| Error::Database(e.to_string()))?;
    assert_eq!(enabled, 1);
    Ok(())
}

#[test]
fn rolls_back_writer_transaction_when_any_statement_fails() -> Result<(), Error> {
    let dir = TestDir::new("sqlite-transaction-rollback");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();

    db.execute_non_query(
        "CREATE TABLE transaction_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        &empty,
    )?;

    let result = db.write_transaction(|tx| {
        let mut args = HashMap::new();
        args.insert("@id".to_string(), serde_json::json!(1));
        args.insert("@name".to_string(), serde_json::json!("pending"));
        tx.execute_non_query(
            "INSERT INTO transaction_items (id, name) VALUES (@id, @name)",
            &args,
        )?;
        tx.execute_non_query("INSERT INTO missing_table (value) VALUES (1)", &empty)?;
        Ok(())
    });

    assert!(result.is_err());
    let rows = db.execute("SELECT COUNT(*) FROM transaction_items", &empty)?;
    assert_eq!(rows[0][0], serde_json::json!(0));
    Ok(())
}

#[test]
fn profile_backup_vacuum_into_snapshots_content_and_replaces_existing_destination(
) -> Result<(), Error> {
    let dir = TestDir::new("profile-backup-vacuum");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let snapshot_path = dir.path.join("snapshot.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE snapshot_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO snapshot_items (value) VALUES ('complete')",
        &empty,
    )?;
    fs::write(&snapshot_path, b"replace me")?;

    db.vacuum_into(&snapshot_path)?;

    let snapshot = Connection::open_with_flags(snapshot_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| Error::Database(error.to_string()))?;
    let value: String = snapshot
        .query_row("SELECT value FROM snapshot_items", [], |row| row.get(0))
        .map_err(|error| Error::Database(error.to_string()))?;
    assert_eq!(value, "complete");
    Ok(())
}

#[test]
fn profile_backup_vacuum_into_rejects_upgrade_mode() -> Result<(), Error> {
    let dir = TestDir::new("profile-backup-upgrade-mode");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES ('config:vrcx_0_databaseversion', '18')",
        &empty,
    )?;
    db.begin_upgrade(18, 18)?;

    let result = db.vacuum_into(&dir.path.join("snapshot.sqlite3"));

    assert!(result.is_err());
    db.fail_upgrade("test complete".into())?;
    Ok(())
}

#[test]
fn failed_upgraded_database_reopen_restores_original_and_preserves_work_copy() -> Result<(), Error>
{
    let dir = TestDir::new("database-upgrade-reopen-rollback");
    let db_path = dir.path.join("VRCX-0.sqlite3");
    let db = DatabaseService::new(&db_path)?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query("CREATE TABLE recovery_items (value TEXT NOT NULL)", &empty)?;
    db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES ('config:vrcx_0_databaseversion', '17')",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO recovery_items (value) VALUES ('original')",
        &empty,
    )?;
    db.begin_upgrade(17, 18)?;
    db.execute_non_query(
        "UPDATE configs SET value = '18' WHERE key = 'config:vrcx_0_databaseversion'",
        &empty,
    )?;
    db.execute_non_query("UPDATE recovery_items SET value = 'upgraded'", &empty)?;

    let mut reopen_attempts = 0;
    let result = db.commit_upgrade_with_reopen(|path| {
        reopen_attempts += 1;
        if reopen_attempts == 1 {
            Err(Error::Database(
                "injected upgraded database reopen failure".into(),
            ))
        } else {
            open_main_database(path)
        }
    });

    assert!(result.is_err());
    assert_eq!(reopen_attempts, 2);
    assert!(db.is_main_mode());
    let rows = db.execute("SELECT value FROM recovery_items", &empty)?;
    assert_eq!(rows, vec![vec![serde_json::json!("original")]]);
    let failed = db.get_failed_upgrade()?.expect("failed upgrade status");
    let work_db_path = PathBuf::from(failed.work_db_path);
    assert!(work_db_path.exists());
    assert!(!dir
        .path
        .join("db-upgrade")
        .join(".upgrade-failed.json.tmp")
        .exists());
    let work = Connection::open_with_flags(work_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| Error::Database(error.to_string()))?;
    let value: String = work
        .query_row("SELECT value FROM recovery_items", [], |row| row.get(0))
        .map_err(|error| Error::Database(error.to_string()))?;
    assert_eq!(value, "upgraded");
    Ok(())
}

#[test]
fn failed_status_write_keeps_active_journal_for_recovery() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-failed-status-write");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let empty = HashMap::new();
    db.execute_non_query(
        "CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        &empty,
    )?;
    db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES ('config:vrcx_0_databaseversion', '17')",
        &empty,
    )?;
    db.begin_upgrade(17, 18)?;
    db.execute_non_query(
        "UPDATE configs SET value = '18' WHERE key = 'config:vrcx_0_databaseversion'",
        &empty,
    )?;
    fs::create_dir(db.failed_status_path())?;

    let mut reopen_attempts = 0;
    let result = db.commit_upgrade_with_reopen(|path| {
        reopen_attempts += 1;
        if reopen_attempts == 1 {
            Err(Error::Database(
                "injected upgraded database reopen failure".into(),
            ))
        } else {
            open_main_database(path)
        }
    });

    assert!(result.as_ref().is_err_and(|error| error
        .to_string()
        .contains("Writing the failure status failed")));
    assert!(db.active_status_path().exists());
    fs::remove_dir(db.failed_status_path())?;
    let failed = db.get_failed_upgrade()?.expect("active upgrade status");
    assert!(Path::new(&failed.work_db_path).exists());
    Ok(())
}

#[test]
fn status_reader_recovers_a_synced_temporary_journal() -> Result<(), Error> {
    let dir = TestDir::new("database-upgrade-temporary-status");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    db.begin_upgrade(17, 18)?;
    let active_path = db.active_status_path();
    let temporary_path = status_temporary_path(&active_path)?;
    fs::rename(&active_path, &temporary_path)?;

    let status = db.get_failed_upgrade()?.expect("temporary active status");

    assert_eq!(status.from_version, 17);
    assert_eq!(status.to_version, 18);
    assert!(Path::new(&status.work_db_path).exists());
    db.fail_upgrade("test complete".into())?;
    Ok(())
}

#[test]
fn profile_backup_maps_sqlite_disk_full_to_storage_full_io() {
    let sqlite_error =
        rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_FULL), None);

    assert!(matches!(
        map_profile_backup_sqlite_error(sqlite_error),
        Error::Io(error) if error.kind() == std::io::ErrorKind::StorageFull
    ));
}
