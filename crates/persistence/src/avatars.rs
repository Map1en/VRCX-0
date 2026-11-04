use serde_json::Value;
pub use vrcx_0_contracts::{
    AvatarCacheOutput, AvatarTagOutput, AvatarTimeSpentOutput, AvatarUsageRow, AvatarWearSegment,
};
use vrcx_0_contracts::{AvatarTagInput, AvatarTagsPatchInput};

use crate::activity::{activity_iso_from_ms, parse_activity_time_ms};

use crate::cache_entities::{upsert_cache_entities, upsert_cache_entity, CacheEntityInput};
use crate::common::{affected_count, normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::schema::{ensure_global_store_tables, ensure_user_store_tables};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::realtime::{normalize_user_table_prefix, AvatarHistoryUpsert, AvatarTimeSpentUpsert};
use crate::Error;

#[cfg(test)]
mod tests;

pub fn avatar_cache_upsert(db: &DatabaseService, entry: CacheEntityInput) -> Result<i64, Error> {
    upsert_cache_entity(db, "cache_avatar", entry)
}

pub fn avatar_cache_upsert_many(
    db: &DatabaseService,
    entries: Vec<CacheEntityInput>,
) -> Result<u32, Error> {
    upsert_cache_entities(db, "cache_avatar", entries)
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

pub fn avatar_cache_find_by_file_id(
    db: &DatabaseService,
    file_id: &str,
) -> Result<Option<AvatarCacheOutput>, Error> {
    ensure_global_store_tables(db)?;
    let file_id = normalize_text(file_id);
    if !file_id.starts_with("file_")
        || !file_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_avatar WHERE image_url LIKE @file_id OR thumbnail_image_url LIKE @file_id LIMIT 1",
            &ParamsBuilder::new()
                .set("file_id", format!("%{file_id}%"))
                .build(),
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

pub fn avatar_usage_ranking(
    db: &DatabaseService,
    user_id: String,
    limit: i64,
) -> Result<Vec<AvatarUsageRow>, Error> {
    let user_prefix = normalize_user_table_prefix(&normalize_text(user_id))?;
    ensure_user_store_tables(db, &user_prefix)?;
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            &format!(
                "SELECT history.avatar_id, COALESCE(cache_avatar.name, ''), COALESCE(cache_avatar.thumbnail_image_url, ''), COALESCE(cache_avatar.image_url, ''), history.time
                 FROM {user_prefix}_avatar_history AS history
                 LEFT JOIN cache_avatar ON cache_avatar.id = history.avatar_id
                 WHERE history.time > 0
                 ORDER BY history.time DESC
                 LIMIT @limit"
            ),
            &ParamsBuilder::new()
                .set("limit", if limit > 0 { limit } else { 10 })
                .build(),
        )?
        .into_iter()
        .map(|row| AvatarUsageRow {
            avatar_id: row_string(&row, 0),
            name: row_string(&row, 1),
            thumbnail_image_url: row_string(&row, 2),
            image_url: row_string(&row, 3),
            time_spent: row_i64(&row, 4),
        })
        .collect())
}

pub fn avatar_wear_segments(
    db: &DatabaseService,
    user_id: String,
    from_ms: i64,
    to_ms: i64,
) -> Result<Vec<AvatarWearSegment>, Error> {
    if to_ms <= from_ms {
        return Ok(Vec::new());
    }
    let user_prefix = normalize_user_table_prefix(&normalize_text(user_id))?;
    ensure_user_store_tables(db, &user_prefix)?;
    ensure_global_store_tables(db)?;
    let rows = db.execute(
        &format!(
            "SELECT log.avatar_id, log.started_at, log.ended_at, COALESCE(cache_avatar.name, ''), COALESCE(cache_avatar.thumbnail_image_url, ''), COALESCE(cache_avatar.image_url, '')
             FROM {user_prefix}_avatar_wear_log AS log
             LEFT JOIN cache_avatar ON cache_avatar.id = log.avatar_id
             WHERE log.started_at < @to_iso AND log.ended_at > @from_iso
             ORDER BY log.started_at, log.id"
        ),
        &ParamsBuilder::new()
            .set("from_iso", activity_iso_from_ms(from_ms))
            .set("to_iso", activity_iso_from_ms(to_ms))
            .build(),
    )?;

    let mut segments: Vec<AvatarWearSegment> = Vec::new();
    for row in rows {
        let (Some(started_ms), Some(ended_ms)) = (
            parse_activity_time_ms(&row_string(&row, 1)),
            parse_activity_time_ms(&row_string(&row, 2)),
        ) else {
            continue;
        };
        let started_at_ms = started_ms.max(from_ms);
        let ended_at_ms = ended_ms.min(to_ms);
        if ended_at_ms <= started_at_ms {
            continue;
        }
        let avatar_id = row_string(&row, 0);
        if let Some(last) = segments.last_mut() {
            if last.avatar_id == avatar_id {
                last.ended_at_ms = last.ended_at_ms.max(ended_at_ms);
                continue;
            }
        }
        segments.push(AvatarWearSegment {
            avatar_id,
            name: row_string(&row, 3),
            thumbnail_image_url: row_string(&row, 4),
            image_url: row_string(&row, 5),
            started_at_ms,
            ended_at_ms,
        });
    }
    Ok(segments)
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
        release_status: row_string(row, 7).into(),
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

pub(crate) fn upsert_avatar_history(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &AvatarHistoryUpsert,
) -> Result<u64, Error> {
    let avatar_id = normalize_text(&entry.avatar_id);
    if avatar_id.is_empty() {
        return Ok(0);
    }
    tx.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time)
             VALUES (@avatar_id, @created_at, 0)
             ON CONFLICT(avatar_id) DO UPDATE SET created_at = @created_at"
        ),
        &ParamsBuilder::new()
            .set("avatar_id", avatar_id)
            .set("created_at", entry.created_at.clone())
            .build(),
    )
    .map(affected_count)
}

pub(crate) fn upsert_avatar_time_spent(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &AvatarTimeSpentUpsert,
) -> Result<u64, Error> {
    let avatar_id = normalize_text(&entry.avatar_id);
    if avatar_id.is_empty() || entry.ended_at_ms <= entry.started_at_ms {
        return Ok(0);
    }
    if entry.time_spent > 0 {
        tx.execute_non_query(
            &format!(
                "INSERT INTO {user_prefix}_avatar_history (avatar_id, created_at, time)
                 VALUES (@avatar_id, @created_at, @time_spent)
                 ON CONFLICT(avatar_id) DO UPDATE SET time = time + @time_spent"
            ),
            &ParamsBuilder::new()
                .set("avatar_id", avatar_id.clone())
                .set("created_at", entry.created_at.clone())
                .set("time_spent", entry.time_spent)
                .build(),
        )?;
    }
    let params = ParamsBuilder::new()
        .set("avatar_id", avatar_id)
        .set("started_at", activity_iso_from_ms(entry.started_at_ms))
        .set("ended_at", activity_iso_from_ms(entry.ended_at_ms))
        .set("time", entry.ended_at_ms - entry.started_at_ms)
        .build();
    let updated = tx.execute_non_query(
        &format!(
            "UPDATE {user_prefix}_avatar_wear_log SET ended_at = @ended_at, time = @time
             WHERE avatar_id = @avatar_id AND started_at = @started_at"
        ),
        &params,
    )?;
    if updated > 0 {
        return Ok(affected_count(updated));
    }
    tx.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_avatar_wear_log (avatar_id, started_at, ended_at, time)
             VALUES (@avatar_id, @started_at, @ended_at, @time)"
        ),
        &params,
    )
    .map(affected_count)
}
