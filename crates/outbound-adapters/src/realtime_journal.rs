use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vrcx_0_contracts::realtime::{RealtimePersistenceBatch, RealtimeWriteCounts};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::DatabaseService;

use crate::{Error, Result};

#[cfg(unix)]
use std::fs::File;

const RETRY_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Serialize, Deserialize)]
struct JournalEntry {
    batch_id: String,
    owner: OwnerId,
    batch: RealtimePersistenceBatch,
}

pub(super) struct RealtimeJournal {
    db: Arc<DatabaseService>,
    directory: PathBuf,
    lock: Mutex<()>,
}

impl RealtimeJournal {
    pub(super) fn open(db: Arc<DatabaseService>) -> Result<Arc<Self>> {
        let directory = db
            .db_path()
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("pending-realtime");
        fs::create_dir_all(&directory)?;
        if let Some(parent) = directory.parent() {
            sync_directory(parent)?;
        }
        let journal = Arc::new(Self {
            db,
            directory,
            lock: Mutex::new(()),
        });
        journal.recover_temporary_entries()?;
        // Validate every staged row before starting collection. A malformed queue must
        // stop startup rather than silently skip data that may not have reached SQLite.
        {
            let _guard = journal
                .lock
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            journal.drain_locked()?;
        }
        Self::start_retry_worker(&journal)?;
        Ok(journal)
    }

    pub(super) fn stage(&self, owner: &OwnerId, batch: &RealtimePersistenceBatch) -> Result<()> {
        if batch.is_empty() {
            return Ok(());
        }
        let _guard = self.lock.lock().unwrap_or_else(|error| error.into_inner());
        self.stage_locked(owner, batch)
    }

    pub(super) fn write_and_drain(
        &self,
        owner: &OwnerId,
        batch: &RealtimePersistenceBatch,
    ) -> Result<RealtimeWriteCounts> {
        let _guard = self.lock.lock().unwrap_or_else(|error| error.into_inner());
        self.stage_locked(owner, batch)?;
        self.drain_locked()
    }

    fn stage_locked(&self, owner: &OwnerId, batch: &RealtimePersistenceBatch) -> Result<()> {
        if batch.is_empty() {
            return Ok(());
        }
        self.recover_temporary_entries()?;
        let mut entry = JournalEntry {
            batch_id: String::new(),
            owner: owner.clone(),
            batch: batch.clone(),
        };
        entry.batch_id = batch_id(&entry.owner, &entry.batch)?;
        let pending = self.pending_entries()?;
        if pending
            .iter()
            .any(|(_, pending)| pending.batch_id == entry.batch_id)
        {
            return Ok(());
        }

        let sequence = pending
            .iter()
            .filter_map(|(path, _)| sequence_from_path(path))
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        let final_path = self
            .directory
            .join(format!("{sequence:020}-{}.json", entry.batch_id));
        let temp_path = self
            .directory
            .join(format!(".{sequence:020}-{}.tmp", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(&entry)?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp_path, &final_path)?;
        sync_directory(&self.directory)?;
        Ok(())
    }

    fn drain_locked(&self) -> Result<RealtimeWriteCounts> {
        let mut total = RealtimeWriteCounts::default();
        for (path, entry) in self.pending_entries()? {
            let counts = vrcx_0_persistence::realtime::write_realtime_batch_once(
                &self.db,
                &entry.owner,
                &entry.batch,
                &entry.batch_id,
            )?;
            total.affected_count = total.affected_count.saturating_add(counts.affected_count);
            total.game_log_affected_count = total
                .game_log_affected_count
                .saturating_add(counts.game_log_affected_count);
            fs::remove_file(path)?;
            sync_directory(&self.directory)?;
        }
        Ok(total)
    }

    fn pending_entries(&self) -> Result<Vec<(PathBuf, JournalEntry)>> {
        let mut paths = fs::read_dir(&self.directory)?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<std::io::Result<Vec<_>>>()?;
        paths.retain(|path| path.extension().is_some_and(|ext| ext == "json"));
        paths.sort();
        paths
            .into_iter()
            .map(|path| {
                let entry: JournalEntry = serde_json::from_slice(&fs::read(&path)?)?;
                if entry.batch_id != batch_id(&entry.owner, &entry.batch)? {
                    return Err(Error::Custom(format!(
                        "Realtime journal entry {} failed its integrity check.",
                        path.display()
                    )));
                }
                Ok((path, entry))
            })
            .collect()
    }

    fn recover_temporary_entries(&self) -> Result<()> {
        let mut temporary_paths = fs::read_dir(&self.directory)?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<std::io::Result<Vec<_>>>()?;
        temporary_paths.retain(|path| path.extension().is_some_and(|ext| ext == "tmp"));
        temporary_paths.sort();
        for temp_path in temporary_paths {
            let entry: JournalEntry = serde_json::from_slice(&fs::read(&temp_path)?)?;
            if entry.batch_id != batch_id(&entry.owner, &entry.batch)? {
                return Err(Error::Custom(format!(
                    "Realtime journal entry {} failed its integrity check.",
                    temp_path.display()
                )));
            }
            let Some(sequence) = sequence_from_path(&temp_path) else {
                return Err(Error::Custom(format!(
                    "Realtime journal entry {} has an invalid sequence.",
                    temp_path.display()
                )));
            };
            let final_path = self
                .directory
                .join(format!("{sequence:020}-{}.json", entry.batch_id));
            if final_path.exists() {
                let existing: JournalEntry = serde_json::from_slice(&fs::read(&final_path)?)?;
                if existing.batch_id != entry.batch_id {
                    return Err(Error::Custom(format!(
                        "Realtime journal sequence collision at {}.",
                        final_path.display()
                    )));
                }
                fs::remove_file(temp_path)?;
            } else {
                fs::rename(temp_path, final_path)?;
            }
        }
        sync_directory(&self.directory)?;
        Ok(())
    }

    fn start_retry_worker(journal: &Arc<Self>) -> Result<()> {
        let weak: Weak<Self> = Arc::downgrade(journal);
        thread::Builder::new()
            .name("realtime-journal-retry".into())
            .spawn(move || loop {
                thread::sleep(RETRY_INTERVAL);
                let Some(journal) = weak.upgrade() else {
                    break;
                };
                let result = {
                    let _guard = journal
                        .lock
                        .lock()
                        .unwrap_or_else(|error| error.into_inner());
                    journal.drain_locked()
                };
                if let Err(error) = result {
                    tracing::warn!(error = %error, "Realtime journal retry failed; staged data remains queued");
                }
            })?;
        Ok(())
    }
}

pub(super) fn batch_id(owner: &OwnerId, batch: &RealtimePersistenceBatch) -> Result<String> {
    let bytes = serde_json::to_vec(&(owner, batch))?;
    let digest = Sha256::digest(bytes);
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn sequence_from_path(path: &Path) -> Option<u64> {
    path.file_name()?
        .to_str()?
        .trim_start_matches('.')
        .split_once('-')?
        .0
        .parse()
        .ok()
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use vrcx_0_contracts::realtime::{AvatarTimeSpentUpsert, RealtimePersistenceBatch};

    fn test_paths(name: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("vrcx-0-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        (root.clone(), root.join("VRCX-0.sqlite3"))
    }

    fn avatar_batch() -> RealtimePersistenceBatch {
        RealtimePersistenceBatch {
            avatar_time_spent_upserts: vec![AvatarTimeSpentUpsert {
                avatar_id: "avtr_journal_test".into(),
                created_at: "2026-10-01T14:00:00.000Z".into(),
                time_spent: 60_000,
                started_at_ms: 1_790_863_200_000,
                ended_at_ms: 1_790_863_260_000,
            }],
            ..Default::default()
        }
    }

    fn pending_file_count(directory: &Path) -> usize {
        fs::read_dir(directory)
            .unwrap()
            .filter_map(std::result::Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .count()
    }

    #[test]
    fn failed_write_survives_restart_and_commit_before_ack_is_not_replayed_twice() {
        let (root, db_path) = test_paths("journal-restart");
        let db = Arc::new(DatabaseService::new(&db_path).unwrap());
        let owner = OwnerId::new("usr_journal_test");
        let batch = avatar_batch();
        let journal = RealtimeJournal::open(Arc::clone(&db)).unwrap();
        vrcx_0_persistence::realtime::ensure_realtime_tables(&db, "usrjournaltest").unwrap();
        let direct = Connection::open(&db_path).unwrap();
        direct
            .execute_batch("CREATE TRIGGER fail_journal_test BEFORE INSERT ON usrjournaltest_avatar_history BEGIN SELECT RAISE(ABORT, 'retry'); END")
            .unwrap();
        journal.stage(&owner, &batch).unwrap();
        assert!(journal.write_and_drain(&owner, &batch).is_err());
        assert_eq!(pending_file_count(&root.join("pending-realtime")), 1);
        drop(journal);

        direct
            .execute_batch("DROP TRIGGER fail_journal_test")
            .unwrap();
        let journal = RealtimeJournal::open(Arc::clone(&db)).unwrap();
        assert_eq!(pending_file_count(&root.join("pending-realtime")), 0);

        // Simulate a crash after SQLite committed but before the journal file was removed.
        journal.stage(&owner, &batch).unwrap();
        let id = batch_id(&owner, &batch).unwrap();
        vrcx_0_persistence::realtime::write_realtime_batch_once(&db, &owner, &batch, &id).unwrap();
        assert_eq!(pending_file_count(&root.join("pending-realtime")), 1);
        drop(journal);
        let journal = RealtimeJournal::open(Arc::clone(&db)).unwrap();
        assert_eq!(pending_file_count(&root.join("pending-realtime")), 0);
        let rows: i64 = direct
            .query_row(
                "SELECT time FROM usrjournaltest_avatar_history WHERE avatar_id = 'avtr_journal_test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 60_000);

        drop(journal);
        drop(direct);
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn complete_temporary_file_is_recovered_and_committed() {
        let (root, db_path) = test_paths("journal-tmp-recovery");
        let db = Arc::new(DatabaseService::new(&db_path).unwrap());
        let owner = OwnerId::new("usr_journal_test");
        let batch = avatar_batch();
        let id = batch_id(&owner, &batch).unwrap();
        let pending = root.join("pending-realtime");
        fs::create_dir_all(&pending).unwrap();
        let tmp_path = pending.join(format!(
            ".00000000000000000007-{}.tmp",
            uuid::Uuid::new_v4()
        ));
        let entry = JournalEntry {
            batch_id: id,
            owner,
            batch,
        };
        fs::write(&tmp_path, serde_json::to_vec(&entry).unwrap()).unwrap();

        let journal = RealtimeJournal::open(Arc::clone(&db)).unwrap();
        assert_eq!(pending_file_count(&pending), 0);
        let direct = Connection::open(&db_path).unwrap();
        let rows: i64 = direct
            .query_row(
                "SELECT COUNT(*) FROM usrjournaltest_avatar_history WHERE avatar_id = 'avtr_journal_test'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1);

        drop(journal);
        drop(direct);
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn busy_database_keeps_the_staged_file_for_the_next_start() {
        let (root, db_path) = test_paths("journal-busy-db");
        let db = Arc::new(DatabaseService::new(&db_path).unwrap());
        let owner = OwnerId::new("usr_journal_test");
        let batch = avatar_batch();
        let journal = RealtimeJournal::open(Arc::clone(&db)).unwrap();
        journal.stage(&owner, &batch).unwrap();
        drop(journal);

        let lock = Connection::open(&db_path).unwrap();
        lock.execute_batch("BEGIN EXCLUSIVE").unwrap();
        assert!(RealtimeJournal::open(Arc::clone(&db)).is_err());
        assert_eq!(pending_file_count(&root.join("pending-realtime")), 1);
        lock.execute_batch("ROLLBACK").unwrap();

        let journal = RealtimeJournal::open(Arc::clone(&db)).unwrap();
        assert_eq!(pending_file_count(&root.join("pending-realtime")), 0);
        drop(journal);
        drop(lock);
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }
}
