use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use vrcx_0_application_core::Error;

use super::*;

fn fingerprint(size_bytes: i64, sha256: &str) -> ScreenshotFingerprint {
    ScreenshotFingerprint {
        size_bytes,
        sha256: sha256.into(),
    }
}

fn favorite(id: i64, path: &str, size_bytes: i64, sha256: &str) -> ScreenshotFavorite {
    ScreenshotFavorite {
        id,
        path: path.into(),
        fingerprint: fingerprint(size_bytes, sha256),
    }
}

fn stripped(fingerprint: &ScreenshotFingerprint) -> ScreenshotFingerprint {
    ScreenshotFingerprint {
        size_bytes: fingerprint.size_bytes - 1,
        sha256: format!("{}-stripped", fingerprint.sha256),
    }
}

#[derive(Default)]
struct MemoryFavoriteStore {
    favorites: Mutex<Vec<ScreenshotFavorite>>,
}

impl MemoryFavoriteStore {
    fn with(favorites: Vec<ScreenshotFavorite>) -> Arc<Self> {
        Arc::new(Self {
            favorites: Mutex::new(favorites),
        })
    }

    fn favorites(&self) -> Vec<ScreenshotFavorite> {
        self.favorites.lock().unwrap().clone()
    }

    fn paths(&self) -> Vec<String> {
        self.favorites()
            .into_iter()
            .map(|favorite| favorite.path)
            .collect()
    }
}

impl ScreenshotFavoriteStore for MemoryFavoriteStore {
    fn list(&self) -> Result<Vec<ScreenshotFavorite>> {
        Ok(self.favorites())
    }

    fn get(&self, path: &str) -> Result<Option<ScreenshotFavorite>> {
        Ok(self
            .favorites()
            .into_iter()
            .find(|favorite| favorite.path == path))
    }

    fn add(&self, path: &str, fingerprint: &ScreenshotFingerprint) -> Result<()> {
        let mut favorites = self.favorites.lock().unwrap();
        if let Some(existing) = favorites.iter_mut().find(|favorite| favorite.path == path) {
            existing.fingerprint = fingerprint.clone();
            return Ok(());
        }
        let id = favorites
            .iter()
            .map(|favorite| favorite.id)
            .max()
            .unwrap_or(0)
            + 1;
        favorites.insert(
            0,
            ScreenshotFavorite {
                id,
                path: path.into(),
                fingerprint: fingerprint.clone(),
            },
        );
        Ok(())
    }

    fn update_file(&self, id: i64, path: &str, fingerprint: &ScreenshotFingerprint) -> Result<()> {
        let mut favorites = self.favorites.lock().unwrap();
        if let Some(favorite) = favorites.iter_mut().find(|favorite| favorite.id == id) {
            favorite.path = path.into();
            favorite.fingerprint = fingerprint.clone();
        }
        Ok(())
    }

    fn remove(&self, path: &str) -> Result<()> {
        self.favorites
            .lock()
            .unwrap()
            .retain(|favorite| favorite.path != path);
        Ok(())
    }
}

#[derive(Default)]
struct MemoryLibrary {
    files: Mutex<HashMap<String, ScreenshotFingerprint>>,
    unreadable: Mutex<HashSet<String>>,
    with_metadata: Mutex<HashSet<String>>,
    index: Mutex<Vec<(String, i64)>>,
    hashed: Mutex<Vec<String>>,
    cleared_roots: Mutex<Vec<String>>,
}

impl MemoryLibrary {
    fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    fn file(&self, path: &str, size_bytes: i64, sha256: &str) {
        self.files
            .lock()
            .unwrap()
            .insert(path.into(), fingerprint(size_bytes, sha256));
    }

    fn indexed_file(&self, path: &str, size_bytes: i64, sha256: &str) {
        self.file(path, size_bytes, sha256);
        self.index.lock().unwrap().push((path.into(), size_bytes));
    }

    fn unreadable_indexed_file(&self, path: &str, size_bytes: i64) {
        self.unreadable.lock().unwrap().insert(path.into());
        self.index.lock().unwrap().push((path.into(), size_bytes));
    }

    fn file_with_metadata(&self, path: &str, size_bytes: i64, sha256: &str) {
        self.file(path, size_bytes, sha256);
        self.with_metadata.lock().unwrap().insert(path.into());
    }

    fn strip_metadata(&self, path: &str) -> bool {
        if !self.with_metadata.lock().unwrap().remove(path) {
            return false;
        }
        let mut files = self.files.lock().unwrap();
        if let Some(current) = files.get(path).cloned() {
            files.insert(path.into(), stripped(&current));
        }
        true
    }

    fn hashed(&self) -> Vec<String> {
        self.hashed.lock().unwrap().clone()
    }
}

impl ScreenshotLibraryPort for MemoryLibrary {
    fn is_file(&self, path: &str) -> bool {
        self.files.lock().unwrap().contains_key(path)
            || self.unreadable.lock().unwrap().contains(path)
    }

    fn fingerprint(&self, path: &str) -> Result<ScreenshotFingerprint> {
        self.hashed.lock().unwrap().push(path.into());
        self.files
            .lock()
            .unwrap()
            .get(path)
            .cloned()
            .ok_or_else(|| Error::Custom(format!("cannot read {path}")))
    }

    fn indexed_paths_with_size(&self, _root_path: &str, size_bytes: i64) -> Result<Vec<String>> {
        Ok(self
            .index
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, indexed_size)| *indexed_size == size_bytes)
            .map(|(path, _)| path.clone())
            .collect())
    }

    fn indexed_images(
        &self,
        _root_path: &str,
        paths: &[String],
    ) -> Result<Vec<ScreenshotLibraryImage>> {
        let index = self.index.lock().unwrap();
        Ok(paths
            .iter()
            .filter(|path| index.iter().any(|(indexed, _)| indexed == *path))
            .map(|path| ScreenshotLibraryImage {
                path: path.clone(),
                ..Default::default()
            })
            .collect())
    }

    fn delete_text_metadata(&self, path: &str) -> bool {
        self.strip_metadata(path)
    }

    fn delete_all_metadata(&self, root_path: &str) {
        self.cleared_roots.lock().unwrap().push(root_path.into());
        let paths = self
            .with_metadata
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        for path in paths {
            self.strip_metadata(&path);
        }
    }
}

fn favorites(
    store: &Arc<MemoryFavoriteStore>,
    library: &Arc<MemoryLibrary>,
) -> ScreenshotFavorites {
    ScreenshotFavorites::new(store.clone(), library.clone())
}

#[test]
fn missing_favorite_follows_the_indexed_file_with_the_same_size_and_hash() {
    let store = MemoryFavoriteStore::with(vec![favorite(1, "2026-05/sea.png", 10, "sea")]);
    let library = MemoryLibrary::new();
    library.indexed_file("sorted/other.png", 10, "other");
    library.indexed_file("sorted/sea.png", 10, "sea");

    let relinked = favorites(&store, &library)
        .relink_missing("photos")
        .unwrap();

    assert_eq!(relinked, 1);
    assert_eq!(
        store.favorites(),
        vec![favorite(1, "sorted/sea.png", 10, "sea")]
    );
}

#[test]
fn only_indexed_files_of_the_exact_byte_size_are_hashed() {
    let store = MemoryFavoriteStore::with(vec![favorite(1, "2026-05/sea.png", 10, "sea")]);
    let library = MemoryLibrary::new();
    library.indexed_file("bigger.png", 11, "sea");
    library.indexed_file("smaller.png", 9, "sea");
    library.file("grown-since-scan.png", 12, "sea");
    library
        .index
        .lock()
        .unwrap()
        .push(("grown-since-scan.png".into(), 10));

    let relinked = favorites(&store, &library)
        .relink_missing("photos")
        .unwrap();

    assert_eq!(relinked, 0);
    assert_eq!(library.hashed(), vec!["grown-since-scan.png".to_string()]);
    assert_eq!(store.paths(), vec!["2026-05/sea.png".to_string()]);
}

#[test]
fn favorite_still_on_disk_is_not_relinked() {
    let store = MemoryFavoriteStore::with(vec![favorite(1, "sea.png", 10, "sea")]);
    let library = MemoryLibrary::new();
    library.file("sea.png", 10, "sea");
    library.indexed_file("sea-copy.png", 10, "sea");

    let relinked = favorites(&store, &library)
        .relink_missing("photos")
        .unwrap();

    assert_eq!(relinked, 0);
    assert!(library.hashed().is_empty());
    assert_eq!(store.paths(), vec!["sea.png".to_string()]);
}

#[test]
fn file_that_is_already_a_favorite_is_not_claimed() {
    let store = MemoryFavoriteStore::with(vec![
        favorite(2, "sea-copy.png", 10, "sea"),
        favorite(1, "sea.png", 10, "sea"),
    ]);
    let library = MemoryLibrary::new();
    library.indexed_file("sea-copy.png", 10, "sea");

    let relinked = favorites(&store, &library)
        .relink_missing("photos")
        .unwrap();

    assert_eq!(relinked, 0);
    assert_eq!(
        store.paths(),
        vec!["sea-copy.png".to_string(), "sea.png".to_string()]
    );
}

#[test]
fn one_file_is_claimed_by_at_most_one_missing_favorite() {
    let store = MemoryFavoriteStore::with(vec![
        favorite(2, "newer.png", 10, "sea"),
        favorite(1, "older.png", 10, "sea"),
    ]);
    let library = MemoryLibrary::new();
    library.indexed_file("sorted/sea.png", 10, "sea");

    let relinked = favorites(&store, &library)
        .relink_missing("photos")
        .unwrap();

    assert_eq!(relinked, 1);
    assert_eq!(
        store.paths(),
        vec!["sorted/sea.png".to_string(), "older.png".to_string()]
    );
}

#[test]
fn unreadable_candidate_is_skipped_for_the_next_match() {
    let store = MemoryFavoriteStore::with(vec![favorite(1, "sea.png", 10, "sea")]);
    let library = MemoryLibrary::new();
    library.unreadable_indexed_file("locked.png", 10);
    library.indexed_file("sorted/sea.png", 10, "sea");

    let relinked = favorites(&store, &library)
        .relink_missing("photos")
        .unwrap();

    assert_eq!(relinked, 1);
    assert_eq!(store.paths(), vec!["sorted/sea.png".to_string()]);
}

#[test]
fn forgetting_missing_favorites_keeps_the_ones_still_on_disk() {
    let store = MemoryFavoriteStore::with(vec![
        favorite(2, "kept.png", 20, "kept"),
        favorite(1, "gone.png", 10, "gone"),
    ]);
    let library = MemoryLibrary::new();
    library.file("kept.png", 20, "kept");

    let removed = favorites(&store, &library).forget_missing().unwrap();

    assert_eq!(removed, 1);
    assert_eq!(store.paths(), vec!["kept.png".to_string()]);
}

#[test]
fn favoriting_records_the_current_fingerprint_and_unfavoriting_does_not_read_the_file() {
    let store = MemoryFavoriteStore::with(Vec::new());
    let library = MemoryLibrary::new();
    library.file("sea.png", 10, "sea");
    let favorites = favorites(&store, &library);

    favorites.set_favorite("sea.png", true).unwrap();
    assert_eq!(store.favorites(), vec![favorite(1, "sea.png", 10, "sea")]);

    favorites.set_favorite("sea.png", false).unwrap();
    assert!(store.favorites().is_empty());
    assert_eq!(library.hashed(), vec!["sea.png".to_string()]);
}

#[test]
fn favorite_list_counts_missing_files_and_returns_indexed_images() {
    let store = MemoryFavoriteStore::with(vec![
        favorite(2, "kept.png", 20, "kept"),
        favorite(1, "gone.png", 10, "gone"),
    ]);
    let library = MemoryLibrary::new();
    library.indexed_file("kept.png", 20, "kept");

    let listed = favorites(&store, &library).list("photos").unwrap();

    assert_eq!(
        listed.paths,
        vec!["kept.png".to_string(), "gone.png".to_string()]
    );
    assert_eq!(listed.missing_count, 1);
    assert_eq!(
        listed
            .images
            .iter()
            .map(|image| image.path.clone())
            .collect::<Vec<_>>(),
        vec!["kept.png".to_string()]
    );
}

#[test]
fn deleting_metadata_refreshes_the_favorite_fingerprint() {
    let store = MemoryFavoriteStore::with(vec![favorite(1, "sea.png", 10, "sea")]);
    let library = MemoryLibrary::new();
    library.file_with_metadata("sea.png", 10, "sea");

    assert!(favorites(&store, &library).delete_metadata("sea.png"));

    assert_eq!(
        store.favorites(),
        vec![favorite(1, "sea.png", 9, "sea-stripped")]
    );
}

#[test]
fn metadata_delete_reads_the_file_only_when_a_favorite_was_rewritten() {
    let store = MemoryFavoriteStore::with(vec![favorite(1, "plain.png", 10, "plain")]);
    let library = MemoryLibrary::new();
    library.file("plain.png", 10, "plain");
    library.file_with_metadata("not-favorite.png", 20, "other");
    let favorites = favorites(&store, &library);

    assert!(!favorites.delete_metadata("plain.png"));
    assert!(favorites.delete_metadata("not-favorite.png"));

    assert!(library.hashed().is_empty());
    assert_eq!(
        store.favorites(),
        vec![favorite(1, "plain.png", 10, "plain")]
    );
}

#[test]
fn clearing_all_metadata_refreshes_every_readable_favorite() {
    let store = MemoryFavoriteStore::with(vec![
        favorite(3, "b.png", 30, "b"),
        favorite(2, "locked.png", 20, "locked"),
        favorite(1, "a.png", 10, "a"),
    ]);
    let library = MemoryLibrary::new();
    library.file_with_metadata("a.png", 10, "a");
    library.file_with_metadata("b.png", 30, "b");
    library.unreadable_indexed_file("locked.png", 20);

    favorites(&store, &library).delete_all_metadata("photos");

    assert_eq!(
        *library.cleared_roots.lock().unwrap(),
        vec!["photos".to_string()]
    );
    assert_eq!(
        store.favorites(),
        vec![
            favorite(3, "b.png", 29, "b-stripped"),
            favorite(2, "locked.png", 20, "locked"),
            favorite(1, "a.png", 9, "a-stripped"),
        ]
    );
}
