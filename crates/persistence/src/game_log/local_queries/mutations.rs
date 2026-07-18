use super::*;

pub fn game_log_entries_add(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: String,
    entries: Vec<Value>,
) -> Result<u64, Error> {
    let batch = game_log_batch_for_kind(&kind, entries)?;
    write_game_log_batch(db, owner_user_id, &batch)
}

pub fn game_log_instance_delete_by_location(
    db: &DatabaseService,
    owner_user_id: &str,
    location: String,
) -> Result<i64, Error> {
    ensure_game_log_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    db.execute_non_query(
        "DELETE FROM gamelog_location WHERE location = @location AND owner_id IN (0, @owner_id)",
        &scoped_params(owner_id)
            .set("location", normalize_text(location))
            .build(),
    )
}

pub fn game_log_instance_delete(
    db: &DatabaseService,
    owner_user_id: &str,
    location: String,
    event_ids: Vec<i64>,
) -> Result<i64, Error> {
    ensure_game_log_tables(db)?;
    let location = normalize_text(location);
    let event_ids: Vec<i64> = event_ids.into_iter().filter(|value| *value > 0).collect();
    if event_ids.is_empty() {
        return Ok(0);
    }
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let (params, placeholders) = append_i64_in_params(
        scoped_params(owner_id).set("location", location),
        &event_ids,
        "event_id",
    );
    db.execute_non_query(
        &format!(
            "DELETE FROM gamelog_join_leave WHERE location = @location AND id IN ({}) AND owner_id IN (0, @owner_id)",
            placeholders
                .iter()
                .map(|value| format!("@{value}"))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        &params.build(),
    )
}

pub fn game_log_entry_delete(
    db: &DatabaseService,
    owner_user_id: &str,
    kind: String,
    entry: Value,
) -> Result<i64, Error> {
    ensure_game_log_tables(db)?;
    let row_id = value_as_i64(
        object_field(&entry, "rowId")
            .or_else(|| object_field(&entry, "id"))
            .unwrap_or(&Value::Null),
    );
    let (table_name, fallback_column, fallback_value) = match kind.as_str() {
        "VideoPlay" => (
            "gamelog_video_play",
            "video_url",
            object_field_string(&entry, &["videoUrl", "video_url"]),
        ),
        "Event" => (
            "gamelog_event",
            "data",
            object_field_string(&entry, &["data"]),
        ),
        "External" => (
            "gamelog_external",
            "message",
            object_field_string(&entry, &["message"]),
        ),
        "StringLoad" | "ImageLoad" | "ResourceLoad" => (
            "gamelog_resource_load",
            "resource_url",
            object_field_string(&entry, &["resourceUrl", "resource_url"]),
        ),
        _ => return Ok(0),
    };
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    if row_id > 0 {
        return db.execute_non_query(
            &format!("DELETE FROM {table_name} WHERE id = @id AND owner_id IN (0, @owner_id)"),
            &scoped_params(owner_id).set("id", row_id).build(),
        );
    }
    db.execute_non_query(
        &format!(
            "DELETE FROM {table_name} WHERE created_at = @created_at AND {fallback_column} = @fallback_value AND owner_id IN (0, @owner_id)"
        ),
        &scoped_params(owner_id)
            .set(
                "created_at",
                object_field_string(&entry, &["created_at", "createdAt"]),
            )
            .set("fallback_value", fallback_value)
            .build(),
    )
}
