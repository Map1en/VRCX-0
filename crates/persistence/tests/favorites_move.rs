use std::path::PathBuf;
use std::sync::Arc;

use vrcx_0_persistence::favorites::{favorite_add, favorite_list, favorite_move};
use vrcx_0_persistence::DatabaseService;

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

fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    (dir, db)
}

fn group_names(db: &DatabaseService, kind: &str) -> Vec<String> {
    let mut names: Vec<String> = favorite_list(db, None, kind.into())
        .unwrap()
        .into_iter()
        .map(|row| row.group_name)
        .collect();
    names.sort();
    names
}

#[test]
fn favorite_move_removes_source_and_adds_target_atomically() {
    let (_dir, db) = test_db("favorite-move");
    favorite_add(&db, None, "world".into(), "wrld_1".into(), "source".into()).unwrap();

    let result = favorite_move(
        &db,
        None,
        "world".into(),
        "wrld_1".into(),
        "source".into(),
        "target".into(),
    )
    .unwrap();

    assert_eq!(result.removed, 1);
    assert_eq!(result.added, 1);
    assert_eq!(group_names(&db, "world"), vec!["target".to_string()]);
}

#[test]
fn favorite_move_rolls_back_when_target_write_fails() {
    let (_dir, db) = test_db("favorite-move-rollback");
    favorite_add(&db, None, "world".into(), "wrld_1".into(), "source".into()).unwrap();

    let result = favorite_move(
        &db,
        None,
        "world".into(),
        "wrld_1".into(),
        "source".into(),
        String::new(),
    );

    assert!(result.is_err());
    assert_eq!(group_names(&db, "world"), vec!["source".to_string()]);
}

#[test]
fn favorite_move_is_idempotent_when_target_already_has_entity() {
    let (_dir, db) = test_db("favorite-move-target-present");
    favorite_add(&db, None, "world".into(), "wrld_1".into(), "source".into()).unwrap();
    favorite_add(&db, None, "world".into(), "wrld_1".into(), "target".into()).unwrap();

    let result = favorite_move(
        &db,
        None,
        "world".into(),
        "wrld_1".into(),
        "source".into(),
        "target".into(),
    )
    .unwrap();

    assert_eq!(result.removed, 1);
    assert_eq!(result.added, 0);
    assert_eq!(group_names(&db, "world"), vec!["target".to_string()]);
}
