use std::path::PathBuf;
use std::sync::Arc;

use vrcx_0_core::FavoriteEntityKind;
use vrcx_0_persistence::favorites::{
    favorite_add, favorite_group_create, favorite_list, favorite_move,
};
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

fn world_groups(db: &DatabaseService) -> (i64, i64) {
    (
        favorite_group_create(db, None, FavoriteEntityKind::World, "source")
            .unwrap()
            .id,
        favorite_group_create(db, None, FavoriteEntityKind::World, "target")
            .unwrap()
            .id,
    )
}

fn group_names(db: &DatabaseService) -> Vec<String> {
    let mut names: Vec<String> = favorite_list(db, None, FavoriteEntityKind::World)
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
    let (source, target) = world_groups(&db);
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        source,
    )
    .unwrap();

    let result = favorite_move(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        source,
        target,
    )
    .unwrap();

    assert_eq!((result.removed, result.added), (1, 1));
    assert_eq!(group_names(&db), vec!["target".to_string()]);
}

#[test]
fn favorite_move_rolls_back_when_target_group_is_missing() {
    let (_dir, db) = test_db("favorite-move-rollback");
    let (source, _) = world_groups(&db);
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        source,
    )
    .unwrap();

    let result = favorite_move(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        source,
        999,
    );

    assert!(result.is_err());
    assert_eq!(group_names(&db), vec!["source".to_string()]);
}

#[test]
fn favorite_move_is_idempotent_when_target_already_has_entity() {
    let (_dir, db) = test_db("favorite-move-target-present");
    let (source, target) = world_groups(&db);
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        source,
    )
    .unwrap();
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        target,
    )
    .unwrap();

    let result = favorite_move(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        source,
        target,
    )
    .unwrap();

    assert_eq!((result.removed, result.added), (1, 0));
    assert_eq!(group_names(&db), vec!["target".to_string()]);
}
