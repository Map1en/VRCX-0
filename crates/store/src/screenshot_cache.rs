use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use vrcx_0_core::screenshots::{
    ScreenshotFolderInfo, ScreenshotFolderTree, ScreenshotLibraryImage,
    ScreenshotLibraryScanStatus, ScreenshotMetadata,
};

use crate::{Error, Result};

pub const SCREENSHOT_LIBRARY_INDEX_VERSION: i64 = 1;

#[derive(Clone, Debug)]
pub struct ScreenshotLibraryEntry {
    pub scan_root: String,
    pub path: String,
    pub folder_path: String,
    pub file_name: String,
    pub size_bytes: i64,
    pub modified_at: i64,
    pub created_at: Option<i64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub world_id: Option<String>,
    pub world_name: Option<String>,
    pub captured_at: Option<String>,
    pub metadata_json: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub struct ScreenshotLibraryCachedState {
    pub size_bytes: i64,
    pub modified_at: i64,
    pub index_version: i64,
}

pub struct ScreenshotThumbnailCacheEntry {
    pub thumb_path: String,
    pub source_path: String,
    pub cache_key: String,
    pub size_bytes: i64,
    pub modified_at: i64,
    pub last_used_at: i64,
}

#[derive(Clone)]
pub struct MetadataCacheDb {
    conn: Arc<Mutex<Connection>>,
    scan_status: Arc<Mutex<ScreenshotLibraryScanStatus>>,
    scan_running: Arc<AtomicBool>,
}

impl MetadataCacheDb {
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path)
            .map_err(|e| Error::Database(format!("open cache db: {e}")))?;
        conn.execute_batch(
            "PRAGMA locking_mode=NORMAL;
             PRAGMA busy_timeout=5000;
             PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS cache (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 file_path TEXT NOT NULL UNIQUE,
                 metadata TEXT,
                 cached_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS screenshot_files (
                 path TEXT PRIMARY KEY,
                 scan_root TEXT NOT NULL DEFAULT '',
                 folder_path TEXT NOT NULL,
                 file_name TEXT NOT NULL,
                 size_bytes INTEGER NOT NULL,
                 modified_at INTEGER NOT NULL,
                 created_at INTEGER,
                 width INTEGER,
                 height INTEGER,
                 world_id TEXT,
                 world_name TEXT,
                 captured_at TEXT,
                 metadata_json TEXT,
                 index_version INTEGER NOT NULL DEFAULT 0,
                 indexed_at INTEGER NOT NULL,
                 error TEXT
             );
             CREATE TABLE IF NOT EXISTS screenshot_thumbnail_cache (
                 thumb_path TEXT PRIMARY KEY,
                 source_path TEXT NOT NULL,
                 cache_key TEXT NOT NULL,
                 size_bytes INTEGER NOT NULL,
                 modified_at INTEGER NOT NULL,
                 created_at INTEGER NOT NULL,
                 last_used_at INTEGER NOT NULL
             );",
        )
        .map_err(|e| Error::Database(format!("init cache db: {e}")))?;
        let _ = conn.execute(
            "ALTER TABLE screenshot_files ADD COLUMN scan_root TEXT NOT NULL DEFAULT ''",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE screenshot_thumbnail_cache ADD COLUMN cache_key TEXT NOT NULL DEFAULT ''",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE screenshot_files ADD COLUMN index_version INTEGER NOT NULL DEFAULT 0",
            [],
        );
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_screenshot_files_folder_path
                 ON screenshot_files(scan_root, folder_path);
             CREATE INDEX IF NOT EXISTS idx_screenshot_files_world_id
                 ON screenshot_files(scan_root, world_id);
             CREATE INDEX IF NOT EXISTS idx_screenshot_files_modified_at
                 ON screenshot_files(scan_root, modified_at);
             CREATE INDEX IF NOT EXISTS idx_screenshot_thumbnail_cache_source
                 ON screenshot_thumbnail_cache(source_path);",
        )
        .map_err(|e| Error::Database(format!("init screenshot db indexes: {e}")))?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            scan_status: Arc::new(Mutex::new(ScreenshotLibraryScanStatus::default())),
            scan_running: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn is_cached(&self, file_path: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT 1 FROM cache WHERE file_path = ?1 LIMIT 1",
            [file_path],
            |_| Ok(()),
        )
        .is_ok()
    }

    pub fn get_metadata(&self, file_path: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT metadata FROM cache WHERE file_path = ?1 LIMIT 1",
            [file_path],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    }

    pub fn bulk_add(&self, entries: &[(String, Option<String>)]) {
        let conn = self.conn.lock().unwrap();
        let tx = match conn.unchecked_transaction() {
            Ok(t) => t,
            Err(_) => return,
        };
        {
            let mut stmt = match tx.prepare(
                "INSERT OR IGNORE INTO cache (file_path, metadata, cached_at) VALUES (?1, ?2, ?3)",
            ) {
                Ok(s) => s,
                Err(_) => return,
            };
            let now = now_unix_seconds();
            for (path, meta) in entries {
                let _ = stmt.execute(rusqlite::params![path, meta.as_deref(), now]);
            }
        }
        let _ = tx.commit();
    }

    pub fn scan_status(&self) -> ScreenshotLibraryScanStatus {
        self.scan_status.lock().unwrap().clone()
    }

    pub fn set_scan_status(&self, status: ScreenshotLibraryScanStatus) {
        *self.scan_status.lock().unwrap() = status;
    }

    pub fn try_begin_scan(&self) -> bool {
        self.scan_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn finish_scan(&self, status: ScreenshotLibraryScanStatus) {
        self.set_scan_status(status);
        self.scan_running.store(false, Ordering::SeqCst);
    }

    pub fn library_file_states(&self, root: &str) -> HashMap<String, ScreenshotLibraryCachedState> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT path, size_bytes, modified_at, index_version
             FROM screenshot_files
             WHERE scan_root = ?1",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return HashMap::new(),
        };
        let rows = match stmt.query_map([root], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        }) {
            Ok(rows) => rows,
            Err(_) => return HashMap::new(),
        };
        rows.filter_map(|row| row.ok())
            .map(|(path, size_bytes, modified_at, index_version)| {
                (
                    path,
                    ScreenshotLibraryCachedState {
                        size_bytes,
                        modified_at,
                        index_version,
                    },
                )
            })
            .collect()
    }

    pub fn replace_library_entries(
        &self,
        root: &str,
        seen: &HashSet<String>,
        entries: &[ScreenshotLibraryEntry],
        prune_missing: bool,
    ) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction().map_err(|error| {
            Error::Database(format!("start screenshot index transaction: {error}"))
        })?;
        let now = now_unix_seconds();

        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO screenshot_files (
                    path, scan_root, folder_path, file_name, size_bytes, modified_at, created_at,
                    width, height, world_id, world_name, captured_at, metadata_json,
                    index_version, indexed_at, error
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                 ON CONFLICT(path) DO UPDATE SET
                    scan_root = excluded.scan_root,
                    folder_path = excluded.folder_path,
                    file_name = excluded.file_name,
                    size_bytes = excluded.size_bytes,
                    modified_at = excluded.modified_at,
                    created_at = excluded.created_at,
                    width = excluded.width,
                    height = excluded.height,
                    world_id = excluded.world_id,
                    world_name = excluded.world_name,
                    captured_at = excluded.captured_at,
                    metadata_json = excluded.metadata_json,
                    index_version = excluded.index_version,
                    indexed_at = excluded.indexed_at,
                    error = excluded.error",
                )
                .map_err(|error| {
                    Error::Database(format!("prepare screenshot index upsert: {error}"))
                })?;

            for entry in entries {
                stmt.execute(rusqlite::params![
                    entry.path.as_str(),
                    entry.scan_root.as_str(),
                    entry.folder_path.as_str(),
                    entry.file_name.as_str(),
                    entry.size_bytes,
                    entry.modified_at,
                    entry.created_at,
                    entry.width,
                    entry.height,
                    entry.world_id.as_deref(),
                    entry.world_name.as_deref(),
                    entry.captured_at.as_deref(),
                    entry.metadata_json.as_deref(),
                    SCREENSHOT_LIBRARY_INDEX_VERSION,
                    now,
                    entry.error.as_deref(),
                ])
                .map_err(|error| Error::Database(format!("write screenshot index row: {error}")))?;
            }
        }

        let mut deleted = 0;
        if prune_missing {
            let existing_paths = {
                let mut stmt = tx
                    .prepare("SELECT path FROM screenshot_files WHERE scan_root = ?1")
                    .map_err(|error| {
                        Error::Database(format!("prepare screenshot index prune: {error}"))
                    })?;
                let rows = stmt
                    .query_map([root], |row| row.get::<_, String>(0))
                    .map_err(|error| {
                        Error::Database(format!("read screenshot index prune set: {error}"))
                    })?;
                rows.filter_map(|row| row.ok()).collect::<Vec<_>>()
            };

            for path in existing_paths {
                if !seen.contains(&path) {
                    tx.execute("DELETE FROM screenshot_files WHERE path = ?1", [&path])
                        .map_err(|error| {
                            Error::Database(format!("delete stale screenshot index row: {error}"))
                        })?;
                    deleted += 1;
                }
            }
        }

        tx.commit().map_err(|error| {
            Error::Database(format!("commit screenshot index transaction: {error}"))
        })?;
        Ok(deleted)
    }

    #[doc(hidden)]
    pub fn mark_library_entry_stale_for_test(&self, path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE screenshot_files SET index_version = 0, metadata_json = NULL WHERE path = ?1",
            [path],
        )
        .map_err(|error| Error::Database(format!("mark screenshot row stale: {error}")))?;
        Ok(())
    }

    pub fn screenshot_folder_tree_for_root(&self, root_path: &str) -> Result<ScreenshotFolderTree> {
        let conn = self.conn.lock().unwrap();
        let mut direct_counts: HashMap<String, usize> = HashMap::new();
        let mut latest_modified_by_folder: HashMap<String, i64> = HashMap::new();
        let mut stmt = conn
            .prepare(
                "SELECT folder_path, COUNT(*), MAX(modified_at)
             FROM screenshot_files
             WHERE scan_root = ?1
             GROUP BY folder_path",
            )
            .map_err(|error| Error::Database(format!("prepare screenshot folder tree: {error}")))?;
        let rows = stmt
            .query_map([root_path], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            })
            .map_err(|error| Error::Database(format!("read screenshot folder tree: {error}")))?;
        for row in rows {
            let (folder_path, count, latest_modified_at) = row
                .map_err(|error| Error::Database(format!("read screenshot folder row: {error}")))?;
            if let Some(latest_modified_at) = latest_modified_at {
                latest_modified_by_folder.insert(folder_path.clone(), latest_modified_at);
            }
            direct_counts.insert(folder_path, count.max(0) as usize);
        }

        if root_path.is_empty() {
            return Ok(ScreenshotFolderTree {
                root_path: root_path.to_string(),
                folders: Vec::new(),
            });
        }

        let root = PathBuf::from(root_path);
        let mut folder_paths = HashSet::new();
        folder_paths.insert(root_path.to_string());
        for folder in direct_counts.keys() {
            let mut current = PathBuf::from(folder);
            loop {
                folder_paths.insert(path_string(&current));
                if current == root {
                    break;
                }
                let Some(parent) = current.parent() else {
                    break;
                };
                current = parent.to_path_buf();
            }
        }

        let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();
        for folder in &folder_paths {
            let path = PathBuf::from(folder);
            let parent_path = path.parent().map(path_string);
            if let Some(parent_path) = parent_path {
                if folder_paths.contains(&parent_path) {
                    children_by_parent
                        .entry(parent_path)
                        .or_default()
                        .push(folder.clone());
                }
            }
        }

        fn total_count(
            path: &str,
            direct_counts: &HashMap<String, usize>,
            children_by_parent: &HashMap<String, Vec<String>>,
        ) -> usize {
            let own = direct_counts.get(path).copied().unwrap_or(0);
            own + children_by_parent
                .get(path)
                .into_iter()
                .flatten()
                .map(|child| total_count(child, direct_counts, children_by_parent))
                .sum::<usize>()
        }

        let mut folders: Vec<ScreenshotFolderInfo> = folder_paths
            .into_iter()
            .map(|folder| {
                let path = PathBuf::from(&folder);
                let parent_path = path.parent().map(path_string).filter(|parent| {
                    parent == root_path || children_by_parent.contains_key(parent)
                });
                let name = if folder == root_path {
                    path.file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| folder.clone())
                } else {
                    path.file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| folder.clone())
                };
                ScreenshotFolderInfo {
                    latest_modified_at: latest_modified_by_folder.get(&folder).copied(),
                    image_count: direct_counts.get(&folder).copied().unwrap_or(0),
                    total_image_count: total_count(&folder, &direct_counts, &children_by_parent),
                    path: folder,
                    parent_path,
                    name,
                }
            })
            .collect();
        folders.sort_by(|left, right| {
            left.path
                .to_lowercase()
                .cmp(&right.path.to_lowercase())
                .then_with(|| left.path.cmp(&right.path))
        });

        Ok(ScreenshotFolderTree {
            root_path: root_path.to_string(),
            folders,
        })
    }

    pub fn list_screenshot_folder_images_for_root(
        &self,
        root_path: &str,
        folder_path: &str,
    ) -> Result<Vec<ScreenshotLibraryImage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT path, folder_path, file_name, size_bytes, modified_at, created_at,
                    width, height, world_id, world_name, captured_at, error, metadata_json
             FROM screenshot_files
             WHERE scan_root = ?1 AND folder_path = ?2
              ORDER BY file_name ASC, modified_at ASC",
            )
            .map_err(|error| {
                Error::Database(format!("prepare screenshot folder images: {error}"))
            })?;
        let rows = stmt
            .query_map([root_path, folder_path], Self::map_library_image_row)
            .map_err(|error| Error::Database(format!("read screenshot folder images: {error}")))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| Error::Database(format!("read screenshot folder image row: {error}")))
    }

    pub fn list_world_screenshots_for_root(
        &self,
        root_path: &str,
        world_id: &str,
    ) -> Result<Vec<ScreenshotLibraryImage>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT path, folder_path, file_name, size_bytes, modified_at, created_at,
                    width, height, world_id, world_name, captured_at, error, metadata_json
             FROM screenshot_files
             WHERE scan_root = ?1 AND world_id = ?2
              ORDER BY file_name ASC, modified_at ASC",
            )
            .map_err(|error| Error::Database(format!("prepare world screenshots: {error}")))?;
        let rows = stmt
            .query_map([root_path, world_id], Self::map_library_image_row)
            .map_err(|error| Error::Database(format!("read world screenshots: {error}")))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| Error::Database(format!("read world screenshot row: {error}")))
    }

    pub fn record_thumbnail_cache(
        &self,
        source_path: &str,
        thumb_path: &str,
        cache_key: &str,
        size_bytes: i64,
        modified_at: i64,
    ) {
        let conn = self.conn.lock().unwrap();
        let now = now_unix_seconds();
        let _ = conn.execute(
            "INSERT INTO screenshot_thumbnail_cache (
                thumb_path, source_path, cache_key, size_bytes, modified_at, created_at, last_used_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(thumb_path) DO UPDATE SET
                source_path = excluded.source_path,
                cache_key = excluded.cache_key,
                size_bytes = excluded.size_bytes,
                modified_at = excluded.modified_at,
                last_used_at = excluded.last_used_at",
            rusqlite::params![thumb_path, source_path, cache_key, size_bytes, modified_at, now],
        );
    }

    pub fn thumbnail_cache_entries(&self) -> Vec<ScreenshotThumbnailCacheEntry> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT thumb_path, source_path, cache_key, size_bytes, modified_at, last_used_at
             FROM screenshot_thumbnail_cache",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
        let entries = match stmt.query_map([], |row| {
            Ok(ScreenshotThumbnailCacheEntry {
                thumb_path: row.get(0)?,
                source_path: row.get(1)?,
                cache_key: row.get(2)?,
                size_bytes: row.get(3)?,
                modified_at: row.get(4)?,
                last_used_at: row.get(5)?,
            })
        }) {
            Ok(rows) => rows.filter_map(|row| row.ok()).collect(),
            Err(_) => Vec::new(),
        };
        entries
    }

    pub fn thumbnail_cache_entries_for_source(
        &self,
        source_path: &str,
    ) -> Vec<ScreenshotThumbnailCacheEntry> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT thumb_path, source_path, cache_key, size_bytes, modified_at, last_used_at
             FROM screenshot_thumbnail_cache
             WHERE source_path = ?1",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
        let entries = match stmt.query_map([source_path], |row| {
            Ok(ScreenshotThumbnailCacheEntry {
                thumb_path: row.get(0)?,
                source_path: row.get(1)?,
                cache_key: row.get(2)?,
                size_bytes: row.get(3)?,
                modified_at: row.get(4)?,
                last_used_at: row.get(5)?,
            })
        }) {
            Ok(rows) => rows.filter_map(|row| row.ok()).collect(),
            Err(_) => Vec::new(),
        };
        entries
    }

    pub fn thumbnail_last_used_map(&self) -> HashMap<String, i64> {
        self.thumbnail_cache_entries()
            .into_iter()
            .map(|entry| (entry.thumb_path, entry.last_used_at))
            .collect()
    }

    pub fn delete_thumbnail_cache_record(&self, thumb_path: &str) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM screenshot_thumbnail_cache WHERE thumb_path = ?1",
            [thumb_path],
        );
    }

    pub fn clear_all(&self) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("DELETE FROM cache", []);
        let _ = conn.execute("DELETE FROM screenshot_files", []);
        let _ = conn.execute("DELETE FROM screenshot_thumbnail_cache", []);
    }

    fn map_library_image_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScreenshotLibraryImage> {
        let metadata_json = row.get::<_, Option<String>>(12)?;
        let metadata = metadata_json
            .as_deref()
            .and_then(|value| serde_json::from_str::<ScreenshotMetadata>(value).ok());
        Ok(ScreenshotLibraryImage {
            path: row.get(0)?,
            folder_path: row.get(1)?,
            file_name: row.get(2)?,
            size_bytes: row.get(3)?,
            modified_at: row.get(4)?,
            created_at: row.get(5)?,
            width: row.get(6)?,
            height: row.get(7)?,
            world_id: row.get(8)?,
            world_name: row.get(9)?,
            captured_at: row.get(10)?,
            error: row.get(11)?,
            metadata,
        })
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn now_unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
