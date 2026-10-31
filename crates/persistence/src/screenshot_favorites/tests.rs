use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "vrcx0-screenshot-favorites-{name}-{}-{id}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_db(name: &str) -> (TestDir, DatabaseService) {
    let dir = TestDir::new(name);
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
    (dir, db)
}

#[test]
fn refavoriting_a_path_refreshes_the_fingerprint_without_duplicating_it() {
    let (_dir, db) = test_db("upsert");
    add_screenshot_favorite(&db, r"C:\Photos\a.png", 10, "hash-a").unwrap();
    let first = get_screenshot_favorite(&db, r"C:\Photos\a.png")
        .unwrap()
        .unwrap();

    add_screenshot_favorite(&db, r"C:\Photos\a.png", 12, "hash-a2").unwrap();

    let favorites = list_screenshot_favorites(&db).unwrap();
    assert_eq!(favorites.len(), 1);
    assert_eq!(favorites[0].id, first.id);
    assert_eq!(favorites[0].created_at, first.created_at);
    assert_eq!(favorites[0].size_bytes, 12);
    assert_eq!(favorites[0].sha256, "hash-a2");
}

#[test]
fn relinking_moves_a_favorite_to_its_new_path_and_keeps_its_id() {
    let (_dir, db) = test_db("relink");
    add_screenshot_favorite(&db, r"C:\Photos\old.png", 10, "hash").unwrap();
    let id = get_screenshot_favorite(&db, r"C:\Photos\old.png")
        .unwrap()
        .unwrap()
        .id;

    update_screenshot_favorite_file(&db, id, r"D:\Photos\new.png", 10, "hash").unwrap();

    assert!(get_screenshot_favorite(&db, r"C:\Photos\old.png")
        .unwrap()
        .is_none());
    let moved = get_screenshot_favorite(&db, r"D:\Photos\new.png")
        .unwrap()
        .unwrap();
    assert_eq!(moved.id, id);
}

#[test]
fn removing_a_favorite_only_drops_that_path() {
    let (_dir, db) = test_db("remove");
    add_screenshot_favorite(&db, r"C:\Photos\a.png", 1, "a").unwrap();
    add_screenshot_favorite(&db, r"C:\Photos\b.png", 2, "b").unwrap();

    remove_screenshot_favorite(&db, r"C:\Photos\a.png").unwrap();

    let paths = list_screenshot_favorites(&db)
        .unwrap()
        .into_iter()
        .map(|favorite| favorite.path)
        .collect::<Vec<_>>();
    assert_eq!(paths, vec![r"C:\Photos\b.png".to_string()]);
}
