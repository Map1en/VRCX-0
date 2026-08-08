#![allow(non_snake_case)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::cache_entities::{upsert_cache_entity, CacheEntityInput};
use crate::common::{normalize_text, now_iso, row_i64, row_string, ParamsBuilder};
use crate::database::schema::{ensure_global_store_tables, ensure_user_store_tables};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

#[cfg(test)]
mod tests;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTagInput {
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub color: Value,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarCacheOutput {
    pub id: String,
    pub author_id: String,
    pub author_name: String,
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub description: String,
    pub image_url: String,
    pub name: String,
    pub release_status: String,
    pub thumbnail_image_url: String,
    #[serde(rename = "updated_at")]
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTimeSpentOutput {
    pub avatar_id: String,
    pub time_spent: i64,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTagOutput {
    pub avatar_id: String,
    pub tag: String,
    pub color: Value,
}

#[derive(Debug, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTagsPatchInput {
    #[serde(default)]
    pub previous_entries: Vec<AvatarTagInput>,
    #[serde(default)]
    pub next_entries: Vec<AvatarTagInput>,
}

pub fn avatar_cache_upsert(db: &DatabaseService, entry: CacheEntityInput) -> Result<i64, Error> {
    upsert_cache_entity(db, "cache_avatar", entry)
}

pub fn avatar_cache_get(
    db: &DatabaseService,
    avatar_id: String,
) -> Result<Option<AvatarCacheOutput>, Error> {
    ensure_global_store_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_avatar WHERE id = @avatar_id LIMIT 1",
            &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
        )?
        .first()
        .map(|row| cache_entity_from_row(row)))
}

pub fn avatar_cache_existing_ids(
    db: &DatabaseService,
    avatar_ids: &[String],
) -> Result<Vec<String>, Error> {
    ensure_global_store_tables(db)?;
    let avatar_ids = avatar_ids
        .iter()
        .map(|id| normalize_text(id.clone()))
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if avatar_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut params = ParamsBuilder::new();
    let placeholders = avatar_ids
        .iter()
        .enumerate()
        .map(|(index, avatar_id)| {
            let param = format!("avatar_id_{index}");
            params = std::mem::take(&mut params).set(&param, avatar_id.clone());
            format!("@{param}")
        })
        .collect::<Vec<_>>()
        .join(", ");
    Ok(db
        .execute(
            &format!("SELECT id FROM cache_avatar WHERE id IN ({placeholders})"),
            &params.build(),
        )?
        .into_iter()
        .filter_map(|row| {
            row.first()
                .and_then(|value| value.as_str().map(ToOwned::to_owned))
        })
        .collect())
}

pub fn avatar_cache_list(db: &DatabaseService) -> Result<Vec<AvatarCacheOutput>, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_avatar",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| cache_entity_from_row(&row))
        .collect())
}

pub fn avatar_cache_remove(db: &DatabaseService, avatar_id: String) -> Result<(), Error> {
    ensure_global_store_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        "DELETE FROM cache_avatar WHERE id = @avatar_id",
        &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
    )?;
    Ok(())
}

pub fn avatar_history_add(
    db: &DatabaseService,
    user_id: String,
    avatar_id: String,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time) VALUES (@avatar_id, @created_at, 0) ON CONFLICT(avatar_id) DO UPDATE SET created_at = @created_at"),
        &ParamsBuilder::new()
            .set("avatar_id", avatar_id)
            .set("created_at", now_iso())
            .build(),
    )?;
    Ok(())
}

pub fn avatar_time_spent_add(
    db: &DatabaseService,
    user_id: String,
    avatar_id: String,
    time_spent: i64,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        &format!("INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time) VALUES (@avatar_id, @created_at, @time_spent) ON CONFLICT(avatar_id) DO UPDATE SET time = time + @time_spent"),
        &ParamsBuilder::new()
            .set("avatar_id", avatar_id)
            .set("created_at", now_iso())
            .set("time_spent", time_spent)
            .build(),
    )?;
    Ok(())
}

pub fn avatar_history_list(
    db: &DatabaseService,
    user_id: String,
    limit: i64,
) -> Result<Vec<AvatarCacheOutput>, Error> {
    let user_id = normalize_text(user_id);
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            &format!(
                "SELECT cache_avatar.id, cache_avatar.author_id, cache_avatar.author_name, cache_avatar.created_at, cache_avatar.description, cache_avatar.image_url, cache_avatar.name, cache_avatar.release_status, cache_avatar.thumbnail_image_url, cache_avatar.updated_at, cache_avatar.version
                 FROM {user_prefix}_avatar_history
                 INNER JOIN cache_avatar ON cache_avatar.id = {user_prefix}_avatar_history.avatar_id
                 WHERE author_id != @current_user_id
                 ORDER BY {user_prefix}_avatar_history.created_at DESC
                 LIMIT @limit"
            ),
            &ParamsBuilder::new()
                .set("current_user_id", user_id)
                .set("limit", if limit > 0 { limit } else { 100 })
                .build(),
        )?
        .into_iter()
        .map(|row| cache_entity_from_row(&row))
        .collect())
}

pub fn avatar_time_spent_get(
    db: &DatabaseService,
    user_id: String,
    avatar_id: String,
) -> Result<AvatarTimeSpentOutput, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    let avatar_id = normalize_text(avatar_id);
    let time_spent = if avatar_id.is_empty() {
        0
    } else {
        db.execute(
            &format!("SELECT time FROM {user_prefix}_avatar_history WHERE avatar_id = @avatar_id"),
            &ParamsBuilder::new()
                .set("avatar_id", avatar_id.clone())
                .build(),
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or(0)
    };
    Ok(AvatarTimeSpentOutput {
        avatar_id,
        time_spent,
    })
}

pub fn avatar_time_spent_list(
    db: &DatabaseService,
    user_id: String,
) -> Result<Vec<AvatarTimeSpentOutput>, Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    Ok(db
        .execute(
            &format!("SELECT avatar_id, time FROM {user_prefix}_avatar_history"),
            &Default::default(),
        )?
        .into_iter()
        .map(|row| AvatarTimeSpentOutput {
            avatar_id: row_string(&row, 0),
            time_spent: row_i64(&row, 1),
        })
        .collect())
}

pub fn avatar_history_clear(db: &DatabaseService, user_id: String) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    db.execute_non_query(
        &format!("DELETE FROM {user_prefix}_avatar_history"),
        &Default::default(),
    )?;
    Ok(())
}

pub fn avatar_tag_add(
    db: &DatabaseService,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    db.execute_non_query(
        "INSERT OR IGNORE INTO avatar_tags (avatar_id, tag, color) VALUES (@avatar_id, @tag, @color)",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .set("tag", tag)
            .set("color", color)
            .build(),
    )
}

pub fn avatar_tags_get(
    db: &DatabaseService,
    avatar_id: String,
) -> Result<Vec<AvatarTagOutput>, Error> {
    ensure_global_store_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    Ok(db
        .execute(
            "SELECT avatar_id, tag, color FROM avatar_tags WHERE avatar_id = @avatar_id",
            &ParamsBuilder::new().set("avatar_id", avatar_id).build(),
        )?
        .into_iter()
        .map(|row| AvatarTagOutput {
            avatar_id: row_string(&row, 0),
            tag: row_string(&row, 1),
            color: row.get(2).cloned().unwrap_or(Value::Null),
        })
        .collect())
}

pub fn avatar_tags_list(db: &DatabaseService) -> Result<Vec<AvatarTagOutput>, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            "SELECT avatar_id, tag, color FROM avatar_tags",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| AvatarTagOutput {
            avatar_id: row_string(&row, 0),
            tag: row_string(&row, 1),
            color: row.get(2).cloned().unwrap_or(Value::Null),
        })
        .collect())
}

pub fn avatar_tags_distinct(db: &DatabaseService) -> Result<Vec<String>, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            "SELECT DISTINCT tag FROM avatar_tags ORDER BY tag",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter(|tag| !tag.is_empty())
        .collect())
}

pub fn avatar_tag_update_color(
    db: &DatabaseService,
    avatar_id: String,
    tag: Value,
    color: Value,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    db.execute_non_query(
        "UPDATE avatar_tags SET color = @color WHERE avatar_id = @avatar_id AND tag = @tag",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .set("tag", tag)
            .set("color", color)
            .build(),
    )
}

pub fn avatar_tag_remove(
    db: &DatabaseService,
    avatar_id: String,
    tag: Value,
) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    db.execute_non_query(
        "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id AND tag = @tag",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .set("tag", tag)
            .build(),
    )
}

pub fn avatar_tags_remove_all(db: &DatabaseService, avatar_id: String) -> Result<i64, Error> {
    ensure_global_store_tables(db)?;
    db.execute_non_query(
        "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id",
        &ParamsBuilder::new()
            .set("avatar_id", normalize_text(avatar_id))
            .build(),
    )
}

pub fn avatar_tags_replace(
    db: &DatabaseService,
    avatar_id: String,
    entries: Vec<AvatarTagInput>,
) -> Result<(), Error> {
    ensure_global_store_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }

    let entries = entries
        .into_iter()
        .filter_map(normalize_avatar_tag_entry)
        .collect::<Vec<_>>();

    db.write_transaction(|tx| {
        tx.execute_non_query(
            "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id",
            &ParamsBuilder::new()
                .set("avatar_id", avatar_id.clone())
                .build(),
        )?;
        for (tag, color) in &entries {
            tx.execute_non_query(
                "INSERT OR REPLACE INTO avatar_tags (avatar_id, tag, color) VALUES (@avatar_id, @tag, @color)",
                &ParamsBuilder::new()
                    .set("avatar_id", avatar_id.clone())
                    .set("tag", tag.clone())
                    .set("color", color.clone())
                    .build(),
            )?;
        }
        Ok(())
    })?;
    Ok(())
}

pub fn avatar_tags_patch(
    db: &DatabaseService,
    avatar_id: String,
    patch: AvatarTagsPatchInput,
) -> Result<(), Error> {
    ensure_global_store_tables(db)?;
    let avatar_id = normalize_text(avatar_id);
    if avatar_id.is_empty() {
        return Ok(());
    }

    let previous_entries = normalize_avatar_tag_map(patch.previous_entries);
    let next_entries = normalize_avatar_tag_map(patch.next_entries);

    db.write_transaction(|tx| {
        for tag in previous_entries.keys() {
            if !next_entries.contains_key(tag) {
                tx.execute_non_query(
                    "DELETE FROM avatar_tags WHERE avatar_id = @avatar_id AND tag = @tag",
                    &ParamsBuilder::new()
                        .set("avatar_id", avatar_id.clone())
                        .set("tag", tag.clone())
                        .build(),
                )?;
            }
        }
        for (tag, color) in &next_entries {
            match previous_entries.get(tag) {
                None => {
                    tx.execute_non_query(
                        "INSERT OR IGNORE INTO avatar_tags (avatar_id, tag, color) VALUES (@avatar_id, @tag, @color)",
                        &ParamsBuilder::new()
                            .set("avatar_id", avatar_id.clone())
                            .set("tag", tag.clone())
                            .set("color", color.clone())
                            .build(),
                    )?;
                }
                Some(previous_color) if nullish_color(previous_color) != nullish_color(color) => {
                    tx.execute_non_query(
                        "UPDATE avatar_tags SET color = @color WHERE avatar_id = @avatar_id AND tag = @tag",
                        &ParamsBuilder::new()
                            .set("avatar_id", avatar_id.clone())
                            .set("tag", tag.clone())
                            .set("color", color.clone())
                            .build(),
                    )?;
                }
                _ => {}
            }
        }
        Ok(())
    })?;
    Ok(())
}

pub(crate) fn cache_entity_from_row(row: &[Value]) -> AvatarCacheOutput {
    AvatarCacheOutput {
        id: row_string(row, 0),
        author_id: row_string(row, 1),
        author_name: row_string(row, 2),
        created_at: row_string(row, 3),
        description: row_string(row, 4),
        image_url: row_string(row, 5),
        name: row_string(row, 6),
        release_status: row_string(row, 7),
        thumbnail_image_url: row_string(row, 8),
        updated_at: row_string(row, 9),
        version: row_i64(row, 10),
    }
}

pub(crate) fn normalize_avatar_tag_entry(entry: AvatarTagInput) -> Option<(String, Value)> {
    let tag = normalize_text(entry.tag);
    if tag.is_empty() {
        return None;
    }
    Some((tag, entry.color))
}

pub(crate) fn normalize_avatar_tag_map(
    entries: Vec<AvatarTagInput>,
) -> std::collections::BTreeMap<String, Value> {
    entries
        .into_iter()
        .filter_map(normalize_avatar_tag_entry)
        .collect()
}

pub(crate) fn nullish_color(value: &Value) -> Option<Value> {
    if value.is_null() {
        None
    } else {
        Some(value.clone())
    }
}
