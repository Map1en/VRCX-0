#![allow(non_snake_case)]

use serde::Serialize;

use crate::common::{normalize_text, now_iso, row_i64, row_string, ParamsBuilder};
use crate::database::schema::{ensure_global_store_tables, ensure_user_store_tables};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MemoSaveResult {
    pub entity_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserMemoOutput {
    pub user_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldMemoOutput {
    pub world_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarMemoOutput {
    pub avatar_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserNoteOutput {
    pub user_id: String,
    pub display_name: String,
    pub note: String,
    pub created_at: String,
}

pub fn memo_get_user(
    db: &DatabaseService,
    user_id: String,
) -> Result<Option<UserMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    let user_id = normalize_text(user_id);
    if user_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT user_id, edited_at, memo FROM memos WHERE user_id = @user_id LIMIT 1",
            &ParamsBuilder::new().set("user_id", user_id).build(),
        )?
        .first()
        .map(|row| UserMemoOutput {
            user_id: row_string(row, 0),
            edited_at: row_string(row, 1),
            memo: row_string(row, 2),
        }))
}

pub fn memo_list_users(db: &DatabaseService) -> Result<Vec<UserMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            "SELECT user_id, edited_at, memo FROM memos",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| UserMemoOutput {
            user_id: row_string(&row, 0),
            edited_at: row_string(&row, 1),
            memo: row_string(&row, 2),
        })
        .collect())
}

pub fn memo_count_users(db: &DatabaseService) -> Result<usize, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute("SELECT COUNT(*) FROM memos", &Default::default())?
        .first()
        .map(|row| usize::try_from(row_i64(row, 0).max(0)).unwrap_or(0))
        .unwrap_or(0))
}

pub fn memo_list_users_page(
    db: &DatabaseService,
    limit: i64,
    cursor: Option<(&str, &str)>,
) -> Result<Vec<UserMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    let mut sql = String::from("SELECT user_id, edited_at, memo FROM memos WHERE 1 = 1");
    let mut params = ParamsBuilder::new().set("limit", limit.max(1));
    if let Some((edited_at, user_id)) = cursor {
        sql.push_str(
            " AND (edited_at < @cursor_edited_at OR (edited_at = @cursor_edited_at AND user_id > @cursor_user_id))",
        );
        params = params
            .set("cursor_edited_at", edited_at)
            .set("cursor_user_id", user_id);
    }
    sql.push_str(" ORDER BY edited_at DESC, user_id ASC LIMIT @limit");

    Ok(db
        .execute(&sql, &params.build())?
        .into_iter()
        .map(|row| UserMemoOutput {
            user_id: row_string(&row, 0),
            edited_at: row_string(&row, 1),
            memo: row_string(&row, 2),
        })
        .collect())
}

pub fn memo_list_user_notes(
    db: &DatabaseService,
    owner_user_id: String,
) -> Result<Vec<UserNoteOutput>, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!("SELECT user_id, display_name, note, created_at FROM {user_prefix}_notes"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| UserNoteOutput {
            user_id: row_string(&row, 0),
            display_name: row_string(&row, 1),
            note: row_string(&row, 2),
            created_at: row_string(&row, 3),
        })
        .collect())
}

pub fn memo_get_world(
    db: &DatabaseService,
    world_id: String,
) -> Result<Option<WorldMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT world_id, edited_at, memo FROM world_memos WHERE world_id = @world_id LIMIT 1",
            &ParamsBuilder::new().set("world_id", world_id).build(),
        )?
        .first()
        .map(|row| WorldMemoOutput {
            world_id: row_string(row, 0),
            edited_at: row_string(row, 1),
            memo: row_string(row, 2),
        }))
}

pub fn memo_get_worlds_many(
    db: &DatabaseService,
    world_ids: &[String],
) -> Result<Vec<WorldMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    let world_ids = world_ids
        .iter()
        .map(normalize_text)
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if world_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut params = ParamsBuilder::new();
    let placeholders = world_ids
        .iter()
        .enumerate()
        .map(|(index, world_id)| {
            let param = format!("world_id_{index}");
            params = std::mem::take(&mut params).set(&param, world_id.clone());
            format!("@{param}")
        })
        .collect::<Vec<_>>()
        .join(", ");
    Ok(db
        .execute(
            &format!(
                "SELECT world_id, edited_at, memo FROM world_memos WHERE world_id IN ({placeholders})"
            ),
            &params.build(),
        )?
        .into_iter()
        .map(|row| WorldMemoOutput {
            world_id: row_string(&row, 0),
            edited_at: row_string(&row, 1),
            memo: row_string(&row, 2),
        })
        .collect())
}

pub fn memo_get_avatar(
    db: &DatabaseService,
    avatar_id: String,
) -> Result<Option<AvatarMemoOutput>, Error> {
    ensure_global_store_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT avatar_id, edited_at, memo FROM avatar_memos WHERE avatar_id = @avatar_id LIMIT 1",
            &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
        )?
        .first()
        .map(|row| AvatarMemoOutput {
            avatar_id: row_string(row, 0),
            edited_at: row_string(row, 1),
            memo: row_string(row, 2),
        }))
}

pub fn memo_save_user(
    db: &DatabaseService,
    user_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    save_memo(db, "memos", "user_id", user_id, memo)
}

pub fn memo_save_world(
    db: &DatabaseService,
    world_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    save_memo(db, "world_memos", "world_id", world_id, memo)
}

pub fn memo_save_avatar(
    db: &DatabaseService,
    avatar_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    save_memo(db, "avatar_memos", "avatar_id", avatar_id, memo)
}

pub(crate) fn save_memo(
    db: &DatabaseService,
    table_name: &str,
    id_column: &str,
    entity_id: String,
    memo: String,
) -> Result<MemoSaveResult, Error> {
    ensure_global_store_tables(db)?;
    let normalized_id = normalize_text(entity_id);
    if normalized_id.is_empty() {
        return Err(Error::Custom("memo save requires an entity id".into()));
    }
    let next_memo = memo;
    if next_memo.is_empty() {
        db.execute_non_query(
            &format!("DELETE FROM {table_name} WHERE {id_column} = @entity_id"),
            &ParamsBuilder::new()
                .set("entity_id", normalized_id.clone())
                .build(),
        )?;
        return Ok(MemoSaveResult {
            entity_id: normalized_id,
            edited_at: String::new(),
            memo: String::new(),
        });
    }
    let edited_at = now_iso();
    db.execute_non_query(
        &format!("INSERT OR REPLACE INTO {table_name} ({id_column}, edited_at, memo) VALUES (@entity_id, @edited_at, @memo)"),
        &ParamsBuilder::new()
            .set("entity_id", normalized_id.clone())
            .set("edited_at", edited_at.clone())
            .set("memo", next_memo.clone())
            .build(),
    )?;
    Ok(MemoSaveResult {
        entity_id: normalized_id,
        edited_at,
        memo: next_memo,
    })
}

#[cfg(test)]
mod tests {
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
            let path = std::env::temp_dir()
                .join(format!("vrcx0-memos-{name}-{}-{id}", std::process::id()));
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
    fn memo_list_users_page_returns_ordered_cursor_page() {
        let (_dir, db) = test_db("page");
        ensure_global_store_tables(&db).unwrap();
        db.execute_non_query(
            "INSERT INTO memos (user_id, edited_at, memo)
             VALUES
                ('usr_a', '2026-06-01T10:00:00Z', 'A'),
                ('usr_b', '2026-06-03T10:00:00Z', 'B'),
                ('usr_c', '2026-06-02T10:00:00Z', 'C')",
            &Default::default(),
        )
        .unwrap();

        assert_eq!(memo_count_users(&db).unwrap(), 3);
        assert_eq!(memo_list_users(&db).unwrap().len(), 3);

        let first = memo_list_users_page(&db, 2, None).unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].user_id, "usr_b");
        assert_eq!(first[1].user_id, "usr_c");

        let second = memo_list_users_page(
            &db,
            2,
            Some((first[1].edited_at.as_str(), first[1].user_id.as_str())),
        )
        .unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].user_id, "usr_a");
    }

    #[test]
    fn save_memo_rejects_a_blank_entity_id() {
        let (_dir, db) = test_db("save-blank-id");

        let result = memo_save_user(&db, "   ".into(), "hello".into());

        assert!(result.is_err());
    }

    #[test]
    fn save_memo_upserts_a_non_empty_memo_and_stamps_edited_at() {
        let (_dir, db) = test_db("save-upsert");

        let saved = memo_save_user(&db, "usr_alice".into(), "remember this".into()).unwrap();
        assert_eq!(saved.memo, "remember this");
        assert!(!saved.edited_at.is_empty());

        let fetched = memo_get_user(&db, "usr_alice".into()).unwrap().unwrap();
        assert_eq!(fetched.memo, "remember this");
        assert_eq!(fetched.edited_at, saved.edited_at);

        let updated = memo_save_user(&db, "usr_alice".into(), "updated memo".into()).unwrap();
        let refetched = memo_get_user(&db, "usr_alice".into()).unwrap().unwrap();
        assert_eq!(refetched.memo, "updated memo");
        assert_eq!(refetched.edited_at, updated.edited_at);
    }

    #[test]
    fn save_memo_with_empty_memo_deletes_the_row_instead_of_storing_a_blank() {
        let (_dir, db) = test_db("save-delete-on-empty");
        memo_save_user(&db, "usr_alice".into(), "remember this".into()).unwrap();

        let result = memo_save_user(&db, "usr_alice".into(), "".into()).unwrap();

        assert_eq!(result.edited_at, "");
        assert_eq!(result.memo, "");
        assert!(memo_get_user(&db, "usr_alice".into()).unwrap().is_none());
    }

    #[test]
    fn save_memo_with_empty_memo_on_a_missing_row_is_a_no_op() {
        let (_dir, db) = test_db("save-delete-missing");

        let result = memo_save_user(&db, "usr_ghost".into(), "".into()).unwrap();

        assert_eq!(result.entity_id, "usr_ghost");
        assert_eq!(result.memo, "");
        assert_eq!(memo_count_users(&db).unwrap(), 0);
    }

    #[test]
    fn memo_get_user_returns_none_for_blank_or_unknown_id() {
        let (_dir, db) = test_db("get-user-none");

        assert!(memo_get_user(&db, "  ".into()).unwrap().is_none());
        assert!(memo_get_user(&db, "usr_unknown".into()).unwrap().is_none());
    }

    #[test]
    fn memo_save_world_and_avatar_route_to_their_own_tables() {
        let (_dir, db) = test_db("save-world-avatar");
        memo_save_world(&db, "wrld_1".into(), "great world".into()).unwrap();
        memo_save_avatar(&db, "avtr_1".into(), "cool avatar".into()).unwrap();

        assert_eq!(
            memo_get_world(&db, "wrld_1".into()).unwrap().unwrap().memo,
            "great world"
        );
        assert_eq!(
            memo_get_avatar(&db, "avtr_1".into()).unwrap().unwrap().memo,
            "cool avatar"
        );
        assert!(memo_get_avatar(&db, "wrld_1".into()).unwrap().is_none());
        assert!(memo_get_world(&db, "avtr_1".into()).unwrap().is_none());
    }

    #[test]
    fn memo_get_worlds_many_filters_blanks_and_only_returns_matches() {
        let (_dir, db) = test_db("worlds-many");
        memo_save_world(&db, "wrld_1".into(), "memo one".into()).unwrap();
        memo_save_world(&db, "wrld_2".into(), "memo two".into()).unwrap();

        assert!(memo_get_worlds_many(&db, &[]).unwrap().is_empty());
        assert!(memo_get_worlds_many(&db, &["   ".to_string()])
            .unwrap()
            .is_empty());

        let rows = memo_get_worlds_many(
            &db,
            &[
                "wrld_1".to_string(),
                "wrld_missing".to_string(),
                "  ".to_string(),
            ],
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].world_id, "wrld_1");
    }

    #[test]
    fn memo_list_user_notes_returns_empty_for_blank_owner_without_touching_db() {
        let (_dir, db) = test_db("notes-blank-owner");

        assert!(memo_list_user_notes(&db, "  ".into()).unwrap().is_empty());
    }

    #[test]
    fn memo_list_user_notes_reads_the_owners_notes_table() {
        let (_dir, db) = test_db("notes-list");
        let prefix = normalize_user_table_prefix("usr_self").unwrap();
        ensure_user_store_tables(&db, &prefix).unwrap();
        db.execute_non_query(
            &format!(
                "INSERT INTO {prefix}_notes (user_id, display_name, note, created_at)
                 VALUES ('usr_alice', 'Alice', 'met at a concert', '2026-06-01T00:00:00Z')"
            ),
            &Default::default(),
        )
        .unwrap();

        let notes = memo_list_user_notes(&db, "usr_self".into()).unwrap();

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].user_id, "usr_alice");
        assert_eq!(notes[0].note, "met at a concert");
    }

    #[test]
    fn memo_count_users_and_list_users_agree_on_an_empty_table() {
        let (_dir, db) = test_db("count-empty");

        assert_eq!(memo_count_users(&db).unwrap(), 0);
        assert!(memo_list_users(&db).unwrap().is_empty());
    }
}
