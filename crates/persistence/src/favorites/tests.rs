use std::path::PathBuf;
use std::sync::Arc;

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

fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    (dir, db)
}

fn group(
    db: &DatabaseService,
    owner: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    name: &str,
) -> i64 {
    favorite_group_create(db, owner, kind, name).unwrap().id
}

fn group_names(
    db: &DatabaseService,
    owner: Option<&OwnerId>,
    kind: FavoriteEntityKind,
) -> Vec<String> {
    favorite_group_list(db, owner, kind)
        .unwrap()
        .into_iter()
        .map(|group| group.name)
        .collect()
}

fn member_ids(
    db: &DatabaseService,
    owner: Option<&OwnerId>,
    kind: FavoriteEntityKind,
    group_id: i64,
) -> Vec<String> {
    favorite_list_custom_order(db, owner, kind)
        .unwrap()
        .into_iter()
        .filter(|row| row.group_id == group_id)
        .map(|row| row.entity_id().to_string())
        .collect()
}

#[test]
fn create_trims_names_and_returns_the_existing_group_for_the_same_realm() {
    let (_dir, db) = test_db("favorite-group-create");

    let first = favorite_group_create(&db, None, FavoriteEntityKind::World, " Chill ").unwrap();
    let again = favorite_group_create(&db, None, FavoriteEntityKind::World, "Chill").unwrap();
    group(&db, None, FavoriteEntityKind::World, "Later");

    assert_eq!(first, again);
    assert_eq!(first.name, "Chill");
    assert!(!first.shared);
    assert_eq!(
        group_names(&db, None, FavoriteEntityKind::World),
        vec!["Chill", "Later"]
    );
    assert!(favorite_group_create(&db, None, FavoriteEntityKind::World, "  ").is_err());
}

#[test]
fn friend_groups_are_owner_scoped_and_shared_groups_stay_visible_after_account_groups() {
    let (_dir, db) = test_db("favorite-group-realms");
    let owner_a = OwnerId::new("usr_a");
    let owner_b = OwnerId::new("usr_b");
    let shared = group(&db, None, FavoriteEntityKind::Friend, "Close");
    let account_a = group(&db, Some(&owner_a), FavoriteEntityKind::Friend, "Mine");
    group(&db, Some(&owner_b), FavoriteEntityKind::Friend, "Only B");

    let groups_a = favorite_group_list(&db, Some(&owner_a), FavoriteEntityKind::Friend).unwrap();
    assert_eq!(
        groups_a
            .iter()
            .map(|group| (group.id, group.shared))
            .collect::<Vec<_>>(),
        vec![(account_a, false), (shared, true)]
    );
    assert_eq!(
        group_names(&db, Some(&owner_b), FavoriteEntityKind::Friend),
        vec!["Only B", "Close"]
    );
    assert!(favorite_add(
        &db,
        Some(&owner_b),
        FavoriteEntityKind::Friend,
        "usr_1".into(),
        account_a
    )
    .is_err());
}

#[test]
fn group_names_stay_unique_across_the_shared_and_account_realms() {
    let (_dir, db) = test_db("favorite-group-unique-names");
    let owner_a = OwnerId::new("usr_a");
    let owner_b = OwnerId::new("usr_b");
    let shared = group(&db, None, FavoriteEntityKind::Friend, "Close");
    let account_a = group(&db, Some(&owner_a), FavoriteEntityKind::Friend, "Mine");
    let account_b = group(&db, Some(&owner_b), FavoriteEntityKind::Friend, "Only B");
    let duplicate = |result: Result<i64, Error>| {
        assert_eq!(
            result.unwrap_err().to_string(),
            "A local favorite group with this name already exists."
        );
    };

    assert_eq!(
        group(&db, Some(&owner_a), FavoriteEntityKind::Friend, "Close"),
        shared
    );
    duplicate(favorite_group_rename(
        &db,
        Some(&owner_a),
        FavoriteEntityKind::Friend,
        account_a,
        "Close",
    ));
    duplicate(favorite_group_rename(
        &db,
        Some(&owner_a),
        FavoriteEntityKind::Friend,
        shared,
        "Only B",
    ));
    duplicate(
        favorite_group_create(&db, None, FavoriteEntityKind::Friend, "Only B")
            .map(|group| group.id),
    );
    assert_eq!(
        favorite_group_rename(
            &db,
            Some(&owner_a),
            FavoriteEntityKind::Friend,
            account_a,
            "Only B"
        )
        .unwrap(),
        1
    );
    assert_ne!(account_a, account_b);
    assert_eq!(
        group_names(&db, Some(&owner_a), FavoriteEntityKind::Friend),
        vec!["Only B", "Close"]
    );
}
#[test]
fn rename_to_the_same_trimmed_name_keeps_every_member() {
    let (_dir, db) = test_db("favorite-group-rename-same");
    let id = group(&db, None, FavoriteEntityKind::Friend, "Friends");
    for user_id in ["usr_1", "usr_2"] {
        favorite_add(&db, None, FavoriteEntityKind::Friend, user_id.into(), id).unwrap();
    }

    assert_eq!(
        favorite_group_rename(&db, None, FavoriteEntityKind::Friend, id, "Friends ").unwrap(),
        0
    );
    assert_eq!(
        favorite_group_rename(&db, None, FavoriteEntityKind::Friend, id, "Best").unwrap(),
        1
    );

    assert_eq!(
        group_names(&db, None, FavoriteEntityKind::Friend),
        vec!["Best"]
    );
    assert_eq!(
        member_ids(&db, None, FavoriteEntityKind::Friend, id).len(),
        2
    );
}

#[test]
fn rename_onto_another_group_name_in_the_same_realm_is_rejected() {
    let (_dir, db) = test_db("favorite-group-rename-clash");
    let a = group(&db, None, FavoriteEntityKind::Avatar, "a");
    group(&db, None, FavoriteEntityKind::Avatar, "b");

    assert!(favorite_group_rename(&db, None, FavoriteEntityKind::Avatar, a, "b").is_err());
    assert_eq!(
        group_names(&db, None, FavoriteEntityKind::Avatar),
        vec!["a", "b"]
    );
}

#[test]
fn delete_removes_members_and_never_reuses_the_group_id() {
    let (_dir, db) = test_db("favorite-group-delete");
    let doomed = group(&db, None, FavoriteEntityKind::World, "doomed");
    favorite_add(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_1".into(),
        doomed,
    )
    .unwrap();

    assert_eq!(
        favorite_group_delete(&db, None, FavoriteEntityKind::World, doomed).unwrap(),
        1
    );
    let recreated = group(&db, None, FavoriteEntityKind::World, "doomed");

    assert_ne!(recreated, doomed);
    assert!(favorite_list(&db, None, FavoriteEntityKind::World)
        .unwrap()
        .is_empty());
}

#[test]
fn favorite_add_is_idempotent_for_same_entity_and_group() {
    let (_dir, db) = test_db("favorite-add-idempotent");
    let id = group(&db, None, FavoriteEntityKind::World, "group");

    let first = favorite_add(&db, None, FavoriteEntityKind::World, "wrld_1".into(), id).unwrap();
    let second = favorite_add(&db, None, FavoriteEntityKind::World, " wrld_1 ".into(), id).unwrap();

    assert_eq!((first, second), (1, 0));
    let rows = favorite_list(&db, None, FavoriteEntityKind::World).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (rows[0].group_id, rows[0].group_name.as_str()),
        (id, "group")
    );
}

#[test]
fn custom_order_defaults_to_newest_first_and_keeps_new_rows_on_top_after_reorder() {
    let (_dir, db) = test_db("favorite-custom-order");
    let main = group(&db, None, FavoriteEntityKind::World, "group");
    let other = group(&db, None, FavoriteEntityKind::World, "other");
    for world_id in ["wrld_1", "wrld_2", "wrld_3"] {
        favorite_add(&db, None, FavoriteEntityKind::World, world_id.into(), main).unwrap();
    }
    assert_eq!(
        member_ids(&db, None, FavoriteEntityKind::World, main),
        vec!["wrld_3", "wrld_2", "wrld_1"]
    );

    let affected = favorite_reorder(
        &db,
        None,
        FavoriteEntityKind::World,
        main,
        vec!["wrld_1".into(), "wrld_3".into(), "wrld_2".into()],
    )
    .unwrap();
    assert_eq!(affected, 3);

    favorite_add(&db, None, FavoriteEntityKind::World, "wrld_4".into(), main).unwrap();
    favorite_move(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_2".into(),
        main,
        other,
    )
    .unwrap();
    let moved_back = favorite_move(
        &db,
        None,
        FavoriteEntityKind::World,
        "wrld_2".into(),
        other,
        main,
    )
    .unwrap();

    assert_eq!(
        moved_back,
        FavoriteMoveResult {
            removed: 1,
            added: 1
        }
    );
    assert_eq!(
        member_ids(&db, None, FavoriteEntityKind::World, main),
        vec!["wrld_2", "wrld_4", "wrld_1", "wrld_3"]
    );
    assert_eq!(
        favorite_list(&db, None, FavoriteEntityKind::World)
            .unwrap()
            .into_iter()
            .map(|row| row.entity_id().to_string())
            .collect::<Vec<_>>(),
        vec!["wrld_1", "wrld_3", "wrld_4", "wrld_2"]
    );
}

#[test]
fn friend_reorder_and_custom_order_are_owner_scoped() {
    let (_dir, db) = test_db("favorite-friend-reorder-owner");
    let owner_a = OwnerId::new("usr_a");
    let owner_b = OwnerId::new("usr_b");
    let group_a = group(&db, Some(&owner_a), FavoriteEntityKind::Friend, "friends");
    let group_b = group(&db, Some(&owner_b), FavoriteEntityKind::Friend, "friends");
    for user_id in ["usr_1", "usr_2"] {
        favorite_add(
            &db,
            Some(&owner_a),
            FavoriteEntityKind::Friend,
            user_id.into(),
            group_a,
        )
        .unwrap();
        favorite_add(
            &db,
            Some(&owner_b),
            FavoriteEntityKind::Friend,
            user_id.into(),
            group_b,
        )
        .unwrap();
    }

    favorite_reorder(
        &db,
        Some(&owner_a),
        FavoriteEntityKind::Friend,
        group_a,
        vec!["usr_1".into(), "usr_2".into()],
    )
    .unwrap();

    assert_eq!(
        member_ids(&db, Some(&owner_a), FavoriteEntityKind::Friend, group_a),
        vec!["usr_1", "usr_2"]
    );
    assert_eq!(
        member_ids(&db, Some(&owner_b), FavoriteEntityKind::Friend, group_b),
        vec!["usr_2", "usr_1"]
    );
}

#[test]
fn group_reorder_puts_listed_groups_first_and_keeps_the_rest() {
    let (_dir, db) = test_db("favorite-group-reorder");
    let a = group(&db, None, FavoriteEntityKind::Avatar, "a");
    let b = group(&db, None, FavoriteEntityKind::Avatar, "b");
    let c = group(&db, None, FavoriteEntityKind::Avatar, "c");

    let groups =
        favorite_group_reorder(&db, None, FavoriteEntityKind::Avatar, &[c, 999, a]).unwrap();

    assert_eq!(
        groups.iter().map(|group| group.id).collect::<Vec<_>>(),
        vec![c, a, b]
    );
}
