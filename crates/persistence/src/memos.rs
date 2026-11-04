use vrcx_0_contracts::memos::{
    AvatarMemoOutput, MemoSaveResult, UserMemoOutput, UserNoteOutput, WorldMemoOutput,
};

use crate::common::{normalize_text, now_iso, row_i64, row_string, ParamsBuilder};
use crate::database::schema::{ensure_global_store_tables, ensure_user_store_tables};
use crate::database::DatabaseService;
use crate::ownership::OwnerId;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

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
    owner_user_id: OwnerId,
) -> Result<Vec<UserNoteOutput>, Error> {
    let owner_user_id = normalize_text(owner_user_id.as_str());
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
mod tests;
