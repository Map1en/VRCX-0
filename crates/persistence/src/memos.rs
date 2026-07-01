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
}
