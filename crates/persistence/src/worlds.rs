#![allow(non_snake_case)]

use serde::Serialize;
use serde_json::Value;

use crate::cache_entities::{upsert_cache_entity, CacheEntityInput};
use crate::common::{normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::Error;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldSummaryOutput {
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

pub fn world_cache_upsert(db: &DatabaseService, entry: CacheEntityInput) -> Result<i64, Error> {
    upsert_cache_entity(db, "cache_world", entry)
}

pub fn world_cache_remove(db: &DatabaseService, world_id: String) -> Result<(), Error> {
    ensure_global_store_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(());
    }
    db.execute_non_query(
        "DELETE FROM cache_world WHERE id = @world_id",
        &ParamsBuilder::new().set("world_id", world_id).build(),
    )?;
    Ok(())
}

pub fn world_cache_list(db: &DatabaseService) -> Result<Vec<WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world",
            &Default::default(),
        )?
        .into_iter()
        .map(|row| world_summary_from_row(&row))
        .collect())
}

pub fn world_cache_list_recent(
    db: &DatabaseService,
    limit: i64,
) -> Result<Vec<WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    let limit = limit.max(0);
    if limit == 0 {
        return Ok(Vec::new());
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world ORDER BY COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), added_at, id) DESC, id DESC LIMIT @limit",
            &ParamsBuilder::new().set("limit", limit).build(),
        )?
        .into_iter()
        .map(|row| world_summary_from_row(&row))
        .collect())
}

pub fn world_cache_get(
    db: &DatabaseService,
    world_id: String,
) -> Result<Option<WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    let world_id = normalize_text(world_id);
    if world_id.is_empty() {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world WHERE id = @world_id LIMIT 1",
            &ParamsBuilder::new().set("world_id", world_id).build(),
        )?
        .first()
        .map(|row| world_summary_from_row(row)))
}

pub fn world_cache_get_many(
    db: &DatabaseService,
    world_ids: &[String],
) -> Result<Vec<WorldSummaryOutput>, Error> {
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
                "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world WHERE id IN ({placeholders})"
            ),
            &params.build(),
        )?
        .into_iter()
        .map(|row| world_summary_from_row(&row))
        .collect())
}

pub(crate) fn world_summary_from_row(row: &[Value]) -> WorldSummaryOutput {
    WorldSummaryOutput {
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use serde_json::json;

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
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-worlds-{name}-{}-{nonce}",
                std::process::id()
            ));
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

    fn world_entry(id: &str, name: &str) -> CacheEntityInput {
        CacheEntityInput {
            id: json!(id),
            author_id: json!(null),
            author_name: json!(null),
            created_at: json!("2026-01-01T00:00:00.000Z"),
            description: json!(null),
            image_url: json!("image.png"),
            name: json!(name),
            release_status: json!("public"),
            thumbnail_image_url: json!("thumb.png"),
            updated_at: json!("2026-01-02T00:00:00.000Z"),
            version: json!(1),
        }
    }

    #[test]
    fn get_many_fetches_requested_world_rows_in_one_query() {
        let (_dir, db) = test_db("get-many");
        world_cache_upsert(db.as_ref(), world_entry("wrld_a", "World A")).unwrap();
        world_cache_upsert(db.as_ref(), world_entry("wrld_b", "World B")).unwrap();
        world_cache_upsert(db.as_ref(), world_entry("wrld_c", "World C")).unwrap();

        let mut rows = world_cache_get_many(
            db.as_ref(),
            &[
                " wrld_b ".to_string(),
                String::new(),
                "wrld_missing".to_string(),
                "wrld_a".to_string(),
            ],
        )
        .unwrap()
        .into_iter()
        .map(|row| row.id)
        .collect::<Vec<_>>();
        rows.sort();

        assert_eq!(rows, vec!["wrld_a".to_string(), "wrld_b".to_string()]);
    }
}
