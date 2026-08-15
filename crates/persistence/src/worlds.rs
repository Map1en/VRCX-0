use compact_str::CompactString;
use serde::Serialize;
use serde_json::Value;
use vrcx_0_core::ReleaseStatus;

use crate::cache_entities::{upsert_cache_entities, upsert_cache_entity, CacheEntityInput};
use crate::common::{normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::Error;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldSummaryOutput {
    pub id: String,
    pub author_id: String,
    pub author_name: String,
    #[serde(rename = "created_at")]
    #[specta(type = String)]
    pub created_at: CompactString,
    pub description: String,
    pub image_url: String,
    pub name: String,
    #[specta(type = String)]
    pub release_status: ReleaseStatus,
    pub thumbnail_image_url: String,
    #[serde(rename = "updated_at")]
    #[specta(type = String)]
    pub updated_at: CompactString,
    pub version: i64,
}

pub fn world_cache_upsert(db: &DatabaseService, entry: CacheEntityInput) -> Result<i64, Error> {
    upsert_cache_entity(db, "cache_world", entry)
}

pub fn world_cache_upsert_many(
    db: &DatabaseService,
    entries: Vec<CacheEntityInput>,
) -> Result<u32, Error> {
    upsert_cache_entities(db, "cache_world", entries)
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

pub fn world_cache_search(
    db: &DatabaseService,
    query: impl AsRef<str>,
    limit: i64,
) -> Result<Vec<WorldSummaryOutput>, Error> {
    ensure_global_store_tables(db)?;
    let query = normalize_text(query);
    let limit = limit.clamp(0, 50);
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    Ok(db
        .execute(
            "SELECT id, author_id, author_name, created_at, description, image_url, name, release_status, thumbnail_image_url, updated_at, version FROM cache_world WHERE instr(lower(name), lower(@query)) > 0 ORDER BY CASE WHEN instr(lower(name), lower(@query)) = 1 THEN 0 ELSE 1 END, name COLLATE NOCASE, id LIMIT @limit",
            &ParamsBuilder::new()
                .set("query", query)
                .set("limit", limit)
                .build(),
        )?
        .into_iter()
        .map(|row| world_summary_from_row(&row))
        .collect())
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
        created_at: row_string(row, 3).into(),
        description: row_string(row, 4),
        image_url: row_string(row, 5),
        name: row_string(row, 6),
        release_status: row_string(row, 7).into(),
        thumbnail_image_url: row_string(row, 8),
        updated_at: row_string(row, 9).into(),
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

    #[test]
    fn search_returns_only_matching_worlds_within_limit() {
        let (_dir, db) = test_db("search-bounded");
        world_cache_upsert(db.as_ref(), world_entry("wrld_a", "Cached Alpha")).unwrap();
        world_cache_upsert(db.as_ref(), world_entry("wrld_b", "Cached Beta")).unwrap();
        world_cache_upsert(db.as_ref(), world_entry("wrld_c", "Unrelated")).unwrap();

        let rows = world_cache_search(db.as_ref(), "cached", 1).unwrap();

        assert_eq!(rows.len(), 1);
        assert!(rows[0].name.starts_with("Cached"));
    }

    #[test]
    fn world_summary_preserves_unknown_release_status_as_a_string() {
        let (_dir, db) = test_db("unknown-release-status");
        let mut entry = world_entry("wrld_a", "World A");
        entry.release_status = json!("future");
        world_cache_upsert(db.as_ref(), entry).unwrap();

        let summary = world_cache_get(db.as_ref(), "wrld_a".into())
            .unwrap()
            .unwrap();

        assert_eq!(
            summary.release_status,
            ReleaseStatus::Unknown("future".into())
        );
        assert_eq!(
            serde_json::to_value(summary).unwrap()["releaseStatus"],
            json!("future")
        );
    }

    #[test]
    fn cache_upsert_normalizes_world_id_for_get_and_remove() {
        let (_dir, db) = test_db("normalized-cache-id");

        world_cache_upsert(db.as_ref(), world_entry("  wrld_spaced  ", "Spaced World")).unwrap();

        let cached = world_cache_get(db.as_ref(), "wrld_spaced".into())
            .unwrap()
            .expect("normalized cache id should be readable");
        assert_eq!(cached.id, "wrld_spaced");

        world_cache_remove(db.as_ref(), "  wrld_spaced  ".into()).unwrap();
        assert!(world_cache_get(db.as_ref(), "wrld_spaced".into())
            .unwrap()
            .is_none());
    }

    #[test]
    fn cache_upsert_rejects_invalid_entity_ids_without_writing_rows() {
        let (_dir, db) = test_db("invalid-cache-id");

        for invalid_id in [json!(null), json!(""), json!("   "), json!(42)] {
            let mut entry = world_entry("wrld_placeholder", "Invalid World");
            entry.id = invalid_id;
            assert!(matches!(
                world_cache_upsert(db.as_ref(), entry),
                Err(Error::InvalidData(_))
            ));
        }

        assert!(world_cache_search(db.as_ref(), "Invalid World", 10)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn cache_upsert_many_persists_a_typical_favourites_page_in_one_pass() {
        let (_dir, db) = test_db("upsert-many");

        let entries = (0..300)
            .map(|index| world_entry(&format!("wrld_{index}"), &format!("World {index}")))
            .collect::<Vec<_>>();
        let written = world_cache_upsert_many(db.as_ref(), entries).unwrap();

        assert_eq!(written, 300);
        for index in [0, 150, 299] {
            assert!(world_cache_get(db.as_ref(), format!("wrld_{index}"))
                .unwrap()
                .is_some());
        }
    }

    #[test]
    fn cache_upsert_many_skips_malformed_entries_without_losing_the_batch() {
        let (_dir, db) = test_db("upsert-many-invalid");

        let mut invalid = world_entry("wrld_placeholder", "Invalid World");
        invalid.id = json!(null);
        let entries = vec![
            world_entry("wrld_ok_a", "World A"),
            invalid,
            world_entry("wrld_ok_b", "World B"),
        ];

        let written = world_cache_upsert_many(db.as_ref(), entries).unwrap();

        assert_eq!(written, 2);
        assert!(world_cache_get(db.as_ref(), "wrld_ok_a".into())
            .unwrap()
            .is_some());
        assert!(world_cache_get(db.as_ref(), "wrld_ok_b".into())
            .unwrap()
            .is_some());
    }

    #[test]
    fn cache_upsert_many_reports_database_failures_instead_of_swallowing_them() {
        let (_dir, db) = test_db("upsert-many-db-error");
        world_cache_upsert(db.as_ref(), world_entry("wrld_seed", "Seed")).unwrap();
        db.execute_non_query("DROP TABLE cache_world", &Default::default())
            .unwrap();
        db.execute_non_query(
            "CREATE TABLE cache_world (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER, required_extra TEXT NOT NULL)",
            &Default::default(),
        )
        .unwrap();

        let result = world_cache_upsert_many(db.as_ref(), vec![world_entry("wrld_a", "World A")]);

        assert!(
            result.is_err(),
            "a schema-level write failure must surface, not be downgraded to Ok"
        );
    }

    #[test]
    fn cache_upsert_many_is_a_noop_for_an_empty_batch() {
        let (_dir, db) = test_db("upsert-many-empty");

        assert_eq!(world_cache_upsert_many(db.as_ref(), Vec::new()).unwrap(), 0);
    }
}
