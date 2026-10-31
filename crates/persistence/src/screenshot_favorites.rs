use crate::common::{now_iso, row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_global_store_tables;
use crate::database::DatabaseService;
use crate::Error;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScreenshotFavoriteRecord {
    pub id: i64,
    pub path: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub created_at: String,
}

fn map_record(row: &[serde_json::Value]) -> ScreenshotFavoriteRecord {
    ScreenshotFavoriteRecord {
        id: row_i64(row, 0),
        path: row_string(row, 1),
        size_bytes: row_i64(row, 2),
        sha256: row_string(row, 3),
        created_at: row_string(row, 4),
    }
}

pub fn list_screenshot_favorites(
    db: &DatabaseService,
) -> Result<Vec<ScreenshotFavoriteRecord>, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            "SELECT id, path, size_bytes, sha256, created_at FROM favorite_screenshot ORDER BY created_at DESC, id DESC",
            &Default::default(),
        )?
        .iter()
        .map(|row| map_record(row))
        .collect())
}

pub fn get_screenshot_favorite(
    db: &DatabaseService,
    path: &str,
) -> Result<Option<ScreenshotFavoriteRecord>, Error> {
    ensure_global_store_tables(db)?;
    Ok(db
        .execute(
            "SELECT id, path, size_bytes, sha256, created_at FROM favorite_screenshot WHERE path = @path LIMIT 1",
            &ParamsBuilder::new().set("path", path).build(),
        )?
        .first()
        .map(|row| map_record(row)))
}

pub fn add_screenshot_favorite(
    db: &DatabaseService,
    path: &str,
    size_bytes: i64,
    sha256: &str,
) -> Result<(), Error> {
    ensure_global_store_tables(db)?;
    db.execute_non_query(
        "INSERT INTO favorite_screenshot (path, size_bytes, sha256, created_at)
         VALUES (@path, @size_bytes, @sha256, @created_at)
         ON CONFLICT(path) DO UPDATE SET size_bytes = excluded.size_bytes, sha256 = excluded.sha256",
        &ParamsBuilder::new()
            .set("path", path)
            .set("size_bytes", size_bytes)
            .set("sha256", sha256)
            .set("created_at", now_iso())
            .build(),
    )?;
    Ok(())
}

pub fn update_screenshot_favorite_file(
    db: &DatabaseService,
    id: i64,
    path: &str,
    size_bytes: i64,
    sha256: &str,
) -> Result<(), Error> {
    ensure_global_store_tables(db)?;
    db.execute_non_query(
        "UPDATE favorite_screenshot SET path = @path, size_bytes = @size_bytes, sha256 = @sha256 WHERE id = @id",
        &ParamsBuilder::new()
            .set("id", id)
            .set("path", path)
            .set("size_bytes", size_bytes)
            .set("sha256", sha256)
            .build(),
    )?;
    Ok(())
}

pub fn remove_screenshot_favorite(db: &DatabaseService, path: &str) -> Result<(), Error> {
    ensure_global_store_tables(db)?;
    db.execute_non_query(
        "DELETE FROM favorite_screenshot WHERE path = @path",
        &ParamsBuilder::new().set("path", path).build(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
