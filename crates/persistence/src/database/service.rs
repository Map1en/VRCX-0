use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard, TryLockError,
};
use std::time::Duration;

use rusqlite::{
    types::{ToSql, Value as SqlValue},
    Connection, OpenFlags, OptionalExtension, Statement,
};
pub use vrcx_0_contracts::DatabaseUpgradeStatus;

use crate::Error;

use super::value::{json_to_sql, sqlite_value_to_json};

#[cfg(test)]
mod tests;
mod upgrade;

const READ_CONNECTION_COUNT: usize = 2;
const CONNECTION_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

struct UpgradeSession {
    conn: Mutex<Connection>,
    status: DatabaseUpgradeStatus,
    ensured: EnsuredSchemas,
}

struct MainDatabase {
    writer: Mutex<Connection>,
    readers: Vec<Mutex<Connection>>,
    next_reader: AtomicUsize,
    ensured: EnsuredSchemas,
}

enum DatabaseMode {
    Main(MainDatabase),
    Upgrade(UpgradeSession),
    Closed,
}

type EnsuredSchemas = Arc<Mutex<HashSet<String>>>;

pub struct DatabaseService {
    db_path: PathBuf,
    upgrade_dir: PathBuf,
    inner: RwLock<DatabaseMode>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FrozenDatabase {
    pub db_path: PathBuf,
    pub db_bytes: u64,
    pub wal_path: Option<PathBuf>,
    pub wal_bytes: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WalCheckpointResult {
    pub busy: bool,
    pub log_frames: i64,
    pub checkpointed_frames: i64,
}

impl WalCheckpointResult {
    pub fn is_complete(self) -> bool {
        !self.busy && self.log_frames == self.checkpointed_frames
    }
}

#[derive(Clone, Copy)]
enum WalCheckpointMode {
    Passive,
    Full,
    Truncate,
}

impl WalCheckpointMode {
    fn sql(self) -> &'static str {
        match self {
            Self::Passive => "PRAGMA wal_checkpoint(PASSIVE);",
            Self::Full => "PRAGMA wal_checkpoint(FULL);",
            Self::Truncate => "PRAGMA wal_checkpoint(TRUNCATE);",
        }
    }
}

pub(crate) struct DatabaseWriteTransaction<'conn> {
    tx: rusqlite::Transaction<'conn>,
}

impl DatabaseService {
    pub fn new(db_path: &Path) -> Result<Self, Error> {
        let main = open_main_database(db_path)?;
        let upgrade_dir = db_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("db-upgrade");

        Ok(Self {
            db_path: db_path.to_path_buf(),
            upgrade_dir,
            inner: RwLock::new(DatabaseMode::Main(main)),
        })
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn is_main_mode(&self) -> bool {
        self.inner
            .read()
            .map(|inner| matches!(&*inner, DatabaseMode::Main(_)))
            .unwrap_or(false)
    }

    pub fn freeze_for_migration(&self) -> Result<FrozenDatabase, Error> {
        let mut inner = self
            .inner
            .write()
            .map_err(|error| Error::Database(error.to_string()))?;
        let main = match &*inner {
            DatabaseMode::Main(main) => main,
            DatabaseMode::Upgrade(_) => {
                return Err(Error::Database(
                    "Database migration is unavailable while an upgrade is running.".into(),
                ));
            }
            DatabaseMode::Closed => {
                return Err(Error::Database(
                    "Database connection is temporarily unavailable.".into(),
                ));
            }
        };
        {
            let writer = main
                .writer
                .lock()
                .map_err(|error| Error::Database(error.to_string()))?;
            let status = checkpoint_status(&writer, WalCheckpointMode::Full)?;
            ensure_checkpoint_completed(status)?;
        }
        let db_bytes = fs::metadata(&self.db_path)?.len();

        let main = match std::mem::replace(&mut *inner, DatabaseMode::Closed) {
            DatabaseMode::Main(main) => main,
            _ => unreachable!(),
        };
        drop(main);
        Ok(FrozenDatabase {
            db_path: self.db_path.clone(),
            db_bytes,
            wal_path: None,
            wal_bytes: None,
        })
    }

    pub fn reopen_after_migration_abort(&self) -> Result<(), Error> {
        let mut inner = self
            .inner
            .write()
            .map_err(|error| Error::Database(error.to_string()))?;
        if !matches!(&*inner, DatabaseMode::Closed) {
            return Err(Error::Database(
                "Database can only reopen after an aborted migration.".into(),
            ));
        }
        *inner = DatabaseMode::Main(open_main_database(&self.db_path)?);
        Ok(())
    }

    pub fn vacuum_into(&self, dest: &Path) -> Result<(), Error> {
        let inner = self
            .inner
            .read()
            .map_err(|error| Error::Database(error.to_string()))?;
        if !matches!(&*inner, DatabaseMode::Main(_)) {
            return Err(Error::Database(
                "Database snapshot is unavailable in the current mode.".into(),
            ));
        }

        if dest.exists() {
            fs::remove_file(dest)?;
        }

        let conn = Connection::open_with_flags(&self.db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(Error::sqlite)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(Error::sqlite)?;
        let dest = dest
            .to_str()
            .ok_or_else(|| {
                Error::Database("Database snapshot destination path is not valid UTF-8.".into())
            })?
            .to_owned();
        conn.execute("VACUUM INTO ?1", [&dest])
            .map_err(map_profile_backup_sqlite_error)?;
        Ok(())
    }

    pub(crate) fn ensure_schema_once<F>(&self, key: &str, ensure: F) -> Result<(), Error>
    where
        F: FnOnce() -> Result<(), Error>,
    {
        self.ensure_schema_until_stable(key, || {
            ensure()?;
            Ok(true)
        })
    }

    pub(crate) fn ensure_schema_until_stable<F>(&self, key: &str, ensure: F) -> Result<(), Error>
    where
        F: FnOnce() -> Result<bool, Error>,
    {
        let ensured = {
            let inner = self
                .inner
                .read()
                .map_err(|error| Error::Database(error.to_string()))?;
            match &*inner {
                DatabaseMode::Main(main) => Arc::clone(&main.ensured),
                DatabaseMode::Upgrade(upgrade) => Arc::clone(&upgrade.ensured),
                DatabaseMode::Closed => {
                    return Err(Error::Database(
                        "Database connection is temporarily unavailable.".into(),
                    ));
                }
            }
        };
        if ensured
            .lock()
            .map_err(|error| Error::Database(error.to_string()))?
            .contains(key)
        {
            return Ok(());
        }
        if ensure()? {
            ensured
                .lock()
                .map_err(|error| Error::Database(error.to_string()))?
                .insert(key.to_owned());
        }
        Ok(())
    }

    pub(crate) fn execute(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error> {
        let inner = self
            .inner
            .read()
            .map_err(|e| Error::Database(e.to_string()))?;
        match &*inner {
            DatabaseMode::Main(main) => main.execute_read(sql, args),
            DatabaseMode::Upgrade(upgrade) => {
                let conn = upgrade
                    .conn
                    .lock()
                    .map_err(|e| Error::Database(e.to_string()))?;
                execute_on_connection(&conn, sql, args)
            }
            DatabaseMode::Closed => Err(Error::Database(
                "Database connection is temporarily unavailable.".into(),
            )),
        }
    }

    pub(crate) fn execute_interruptible<F>(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
        should_interrupt: F,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error>
    where
        F: Fn() -> bool + Send + Sync + 'static,
    {
        let inner = read_lock_interruptibly(&self.inner, &should_interrupt)?;
        match &*inner {
            DatabaseMode::Main(main) => {
                main.execute_read_interruptible(sql, args, should_interrupt)
            }
            DatabaseMode::Upgrade(upgrade) => {
                let conn = lock_interruptibly(&upgrade.conn, &should_interrupt)?;
                execute_on_connection_interruptible(&conn, sql, args, should_interrupt)
            }
            DatabaseMode::Closed => Err(Error::Database(
                "Database connection is temporarily unavailable.".into(),
            )),
        }
    }

    pub(crate) fn execute_non_query_exclusive(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, Error> {
        let inner = self
            .inner
            .write()
            .map_err(|e| Error::Database(e.to_string()))?;
        match &*inner {
            DatabaseMode::Main(main) => main.execute_non_query(sql, args),
            DatabaseMode::Upgrade(upgrade) => {
                let conn = upgrade
                    .conn
                    .lock()
                    .map_err(|e| Error::Database(e.to_string()))?;
                execute_non_query_on_connection(&conn, sql, args)
            }
            DatabaseMode::Closed => Err(Error::Database(
                "Database connection is temporarily unavailable.".into(),
            )),
        }
    }

    pub(crate) fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, Error> {
        let inner = self
            .inner
            .read()
            .map_err(|e| Error::Database(e.to_string()))?;
        match &*inner {
            DatabaseMode::Main(main) => main.execute_non_query(sql, args),
            DatabaseMode::Upgrade(upgrade) => {
                let conn = upgrade
                    .conn
                    .lock()
                    .map_err(|e| Error::Database(e.to_string()))?;
                execute_non_query_on_connection(&conn, sql, args)
            }
            DatabaseMode::Closed => Err(Error::Database(
                "Database connection is temporarily unavailable.".into(),
            )),
        }
    }

    pub(crate) fn write_transaction<T, F>(&self, f: F) -> Result<T, Error>
    where
        F: FnOnce(&mut DatabaseWriteTransaction<'_>) -> Result<T, Error>,
    {
        let inner = self
            .inner
            .read()
            .map_err(|e| Error::Database(e.to_string()))?;
        match &*inner {
            DatabaseMode::Main(main) => main.write_transaction(f),
            DatabaseMode::Upgrade(upgrade) => {
                let mut conn = upgrade
                    .conn
                    .lock()
                    .map_err(|e| Error::Database(e.to_string()))?;
                execute_write_transaction(&mut conn, f)
            }
            DatabaseMode::Closed => Err(Error::Database(
                "Database connection is temporarily unavailable.".into(),
            )),
        }
    }

    pub(crate) fn checkpoint_and_vacuum(&self) -> Result<(), Error> {
        let inner = self
            .inner
            .read()
            .map_err(|e| Error::Database(e.to_string()))?;
        let conn = match &*inner {
            DatabaseMode::Main(main) => main
                .writer
                .lock()
                .map_err(|e| Error::Database(e.to_string()))?,
            DatabaseMode::Upgrade(upgrade) => upgrade
                .conn
                .lock()
                .map_err(|e| Error::Database(e.to_string()))?,
            DatabaseMode::Closed => {
                return Err(Error::Database(
                    "Database connection is temporarily unavailable.".into(),
                ));
            }
        };
        checkpoint(&conn)?;
        conn.execute_batch("VACUUM;").map_err(Error::sqlite)?;
        checkpoint(&conn)?;
        Ok(())
    }

    pub fn checkpoint_wal(&self) -> Result<(), Error> {
        self.with_checkpoint_connection(checkpoint)
    }

    pub fn checkpoint_wal_passive(&self) -> Result<WalCheckpointResult, Error> {
        self.with_checkpoint_connection(|conn| checkpoint_status(conn, WalCheckpointMode::Passive))
    }

    pub fn truncate_wal(&self) -> Result<WalCheckpointResult, Error> {
        self.with_checkpoint_connection(truncate_status_without_wait)
    }

    fn with_checkpoint_connection<T>(
        &self,
        run: impl FnOnce(&Connection) -> Result<T, Error>,
    ) -> Result<T, Error> {
        let inner = self
            .inner
            .read()
            .map_err(|e| Error::Database(e.to_string()))?;
        let conn = match &*inner {
            DatabaseMode::Main(main) => main
                .writer
                .lock()
                .map_err(|e| Error::Database(e.to_string()))?,
            DatabaseMode::Upgrade(upgrade) => upgrade
                .conn
                .lock()
                .map_err(|e| Error::Database(e.to_string()))?,
            DatabaseMode::Closed => {
                return Err(Error::Database(
                    "Database connection is temporarily unavailable.".into(),
                ));
            }
        };
        run(&conn)
    }
}

fn map_profile_backup_sqlite_error(error: rusqlite::Error) -> Error {
    if matches!(
        &error,
        rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::DiskFull
    ) {
        return Error::Io(io::Error::new(
            io::ErrorKind::StorageFull,
            error.to_string(),
        ));
    }
    Error::sqlite(error)
}

pub fn optimize_database(db: &DatabaseService) -> Result<(), Error> {
    db.execute_non_query("PRAGMA optimize", &Default::default())?;
    Ok(())
}

impl DatabaseWriteTransaction<'_> {
    pub(crate) fn execute(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error> {
        execute_on_connection(&self.tx, sql, args)
    }

    pub(crate) fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, Error> {
        execute_non_query_on_connection(&self.tx, sql, args)
    }
}

impl MainDatabase {
    fn execute_read(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error> {
        if self.readers.is_empty() {
            return self.execute_on_writer(sql, args);
        }

        let index = self.next_reader.fetch_add(1, Ordering::Relaxed) % self.readers.len();
        let conn = self.readers[index]
            .lock()
            .map_err(|e| Error::Database(e.to_string()))?;
        execute_on_connection(&conn, sql, args)
    }

    fn execute_read_interruptible<F>(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
        should_interrupt: F,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error>
    where
        F: Fn() -> bool + Send + Sync + 'static,
    {
        if self.readers.is_empty() {
            let conn = lock_interruptibly(&self.writer, &should_interrupt)?;
            return execute_on_connection_interruptible(&conn, sql, args, should_interrupt);
        }

        let start = self.next_reader.fetch_add(1, Ordering::Relaxed) % self.readers.len();
        loop {
            for offset in 0..self.readers.len() {
                let index = (start + offset) % self.readers.len();
                match self.readers[index].try_lock() {
                    Ok(conn) => {
                        return execute_on_connection_interruptible(
                            &conn,
                            sql,
                            args,
                            should_interrupt,
                        );
                    }
                    Err(TryLockError::WouldBlock) => {}
                    Err(TryLockError::Poisoned(error)) => {
                        return Err(Error::Database(error.to_string()));
                    }
                }
            }
            if should_interrupt() {
                return Err(interrupted_error());
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    fn execute_on_writer(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>, Error> {
        let conn = self
            .writer
            .lock()
            .map_err(|e| Error::Database(e.to_string()))?;
        execute_on_connection(&conn, sql, args)
    }

    fn execute_non_query(
        &self,
        sql: &str,
        args: &HashMap<String, serde_json::Value>,
    ) -> Result<i64, Error> {
        let conn = self
            .writer
            .lock()
            .map_err(|e| Error::Database(e.to_string()))?;
        execute_non_query_on_connection(&conn, sql, args)
    }

    fn write_transaction<T, F>(&self, f: F) -> Result<T, Error>
    where
        F: FnOnce(&mut DatabaseWriteTransaction<'_>) -> Result<T, Error>,
    {
        let mut conn = self
            .writer
            .lock()
            .map_err(|e| Error::Database(e.to_string()))?;
        execute_write_transaction(&mut conn, f)
    }
}

fn open_main_database(db_path: &Path) -> Result<MainDatabase, Error> {
    let writer = open_configured_connection(db_path)?;
    let mut readers = Vec::with_capacity(READ_CONNECTION_COUNT);
    for _ in 0..READ_CONNECTION_COUNT {
        readers.push(Mutex::new(open_read_connection(db_path)?));
    }
    Ok(MainDatabase {
        writer: Mutex::new(writer),
        readers,
        next_reader: AtomicUsize::new(0),
        ensured: EnsuredSchemas::default(),
    })
}

fn open_configured_connection(db_path: &Path) -> Result<Connection, Error> {
    let conn = Connection::open(db_path).map_err(Error::sqlite)?;
    configure_connection(&conn)?;
    Ok(conn)
}

fn open_read_connection(db_path: &Path) -> Result<Connection, Error> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(Error::sqlite)?;
    configure_read_connection(&conn)?;
    Ok(conn)
}

fn configure_connection(conn: &Connection) -> Result<(), Error> {
    conn.busy_timeout(CONNECTION_BUSY_TIMEOUT)
        .map_err(Error::sqlite)?;
    conn.execute_batch(
        "PRAGMA locking_mode=NORMAL;
         PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA secure_delete=OFF;
         PRAGMA optimize=0x10002;",
    )
    .map_err(Error::sqlite)?;
    conn.set_prepared_statement_cache_capacity(64);
    Ok(())
}

fn configure_read_connection(conn: &Connection) -> Result<(), Error> {
    conn.busy_timeout(CONNECTION_BUSY_TIMEOUT)
        .map_err(Error::sqlite)?;
    conn.execute_batch(
        "PRAGMA query_only=ON;
         PRAGMA temp_store=MEMORY;",
    )
    .map_err(Error::sqlite)?;
    conn.set_prepared_statement_cache_capacity(64);
    Ok(())
}

fn checkpoint_status(
    conn: &Connection,
    mode: WalCheckpointMode,
) -> Result<WalCheckpointResult, Error> {
    conn.query_row(mode.sql(), [], |row| {
        Ok(WalCheckpointResult {
            busy: row.get::<_, i64>(0)? != 0,
            log_frames: row.get(1)?,
            checkpointed_frames: row.get(2)?,
        })
    })
    .map_err(Error::sqlite)
}

fn checkpoint(conn: &Connection) -> Result<(), Error> {
    let status = checkpoint_status(conn, WalCheckpointMode::Truncate)?;
    ensure_checkpoint_completed(status)
}

fn truncate_status_without_wait(conn: &Connection) -> Result<WalCheckpointResult, Error> {
    conn.busy_timeout(Duration::ZERO).map_err(Error::sqlite)?;
    let result = checkpoint_status(conn, WalCheckpointMode::Truncate);
    conn.busy_timeout(CONNECTION_BUSY_TIMEOUT)
        .map_err(Error::sqlite)?;
    result
}

fn ensure_checkpoint_completed(status: WalCheckpointResult) -> Result<(), Error> {
    if status.busy {
        return Err(Error::Database("WAL checkpoint remained busy.".into()));
    }
    Ok(())
}

fn execute_write_transaction<T, F>(conn: &mut Connection, f: F) -> Result<T, Error>
where
    F: FnOnce(&mut DatabaseWriteTransaction<'_>) -> Result<T, Error>,
{
    let tx = conn.transaction().map_err(Error::sqlite)?;
    let mut wrapped = DatabaseWriteTransaction { tx };
    let value = f(&mut wrapped)?;
    wrapped.tx.commit().map_err(Error::sqlite)?;
    Ok(value)
}

fn ensure_upgrade_version_written(conn: &Connection, to_version: i64) -> Result<(), Error> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM configs WHERE key = 'config:vrcx_0_databaseversion' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(Error::sqlite)?;

    let expected = to_version.to_string();
    if value.as_deref() != Some(expected.as_str()) {
        return Err(Error::Database(format!(
            "Database upgrade copy does not contain VRCX-0 schema version {to_version}."
        )));
    }

    Ok(())
}

fn execute_on_connection(
    conn: &Connection,
    sql: &str,
    args: &HashMap<String, serde_json::Value>,
) -> Result<Vec<Vec<serde_json::Value>>, Error> {
    let mut stmt = conn.prepare_cached(sql).map_err(Error::sqlite)?;

    let param_names = statement_param_names(&stmt);
    let params = statement_param_values(&param_names, args)?;

    let param_refs: Vec<(&str, &dyn ToSql)> = param_names
        .iter()
        .zip(params.iter())
        .map(|(name, val)| (name.as_str(), val as &dyn ToSql))
        .collect();

    let col_count = stmt.column_count();

    let rows = stmt
        .query_map(&*param_refs, |row| {
            let mut vals = Vec::with_capacity(col_count);
            for i in 0..col_count {
                let val: SqlValue = row.get(i)?;
                vals.push(sqlite_value_to_json(val));
            }
            Ok(vals)
        })
        .map_err(Error::sqlite)?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(Error::sqlite)?);
    }
    Ok(result)
}

fn execute_on_connection_interruptible<F>(
    conn: &Connection,
    sql: &str,
    args: &HashMap<String, serde_json::Value>,
    should_interrupt: F,
) -> Result<Vec<Vec<serde_json::Value>>, Error>
where
    F: Fn() -> bool + Send + Sync + 'static,
{
    conn.progress_handler(1_000, Some(should_interrupt))
        .map_err(Error::sqlite)?;
    let result = execute_on_connection(conn, sql, args);
    conn.progress_handler(0, None::<fn() -> bool>)
        .map_err(Error::sqlite)?;
    result
}

fn read_lock_interruptibly<'a, T, F>(
    lock: &'a RwLock<T>,
    should_interrupt: &F,
) -> Result<RwLockReadGuard<'a, T>, Error>
where
    F: Fn() -> bool,
{
    loop {
        match lock.try_read() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::WouldBlock) => {}
            Err(TryLockError::Poisoned(error)) => {
                return Err(Error::Database(error.to_string()));
            }
        }
        if should_interrupt() {
            return Err(interrupted_error());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn lock_interruptibly<'a, T, F>(
    lock: &'a Mutex<T>,
    should_interrupt: &F,
) -> Result<MutexGuard<'a, T>, Error>
where
    F: Fn() -> bool,
{
    loop {
        match lock.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::WouldBlock) => {}
            Err(TryLockError::Poisoned(error)) => {
                return Err(Error::Database(error.to_string()));
            }
        }
        if should_interrupt() {
            return Err(interrupted_error());
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn interrupted_error() -> Error {
    Error::Database("SQLite query interrupted".into())
}

fn execute_non_query_on_connection(
    conn: &Connection,
    sql: &str,
    args: &HashMap<String, serde_json::Value>,
) -> Result<i64, Error> {
    let mut stmt = conn.prepare_cached(sql).map_err(Error::sqlite)?;

    let param_names = statement_param_names(&stmt);
    let params = statement_param_values(&param_names, args)?;

    let param_refs: Vec<(&str, &dyn ToSql)> = param_names
        .iter()
        .zip(params.iter())
        .map(|(name, val)| (name.as_str(), val as &dyn ToSql))
        .collect();

    let affected = stmt.execute(&*param_refs).map_err(Error::sqlite)?;

    Ok(affected as i64)
}

fn statement_param_names(stmt: &Statement<'_>) -> Vec<String> {
    (1..=stmt.parameter_count())
        .filter_map(|i| stmt.parameter_name(i).map(|s| s.to_owned()))
        .collect()
}

fn statement_param_values(
    param_names: &[String],
    args: &HashMap<String, serde_json::Value>,
) -> Result<Vec<SqlValue>, Error> {
    param_names
        .iter()
        .map(|name| {
            args.get(name.as_str())
                .map(json_to_sql)
                .ok_or_else(|| Error::Database(format!("Missing SQL parameter: {name}")))
        })
        .collect()
}
