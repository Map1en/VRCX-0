use rusqlite::functions::FunctionFlags;
use rusqlite::types::Value;
use rusqlite::Connection;
use vrcx_0_core::screenshots::{
    ScreenshotFacet, ScreenshotFilter, ScreenshotLibraryImage, ScreenshotPeopleMatch,
    ScreenshotQueryResult,
};

use super::MetadataCacheDb;
use crate::{Error, Result};

const IMAGE_COLUMNS: &str = "f.path, f.folder_path, f.file_name, f.size_bytes, f.modified_at,
    f.created_at, f.width, f.height, f.world_id, f.world_name, f.captured_at, f.error,
    f.metadata_json, f.captured_at_ms";
const PLAYER_ID: &str = "json_extract(p.value, '$.id')";
const UNICODE_LOWER: &str = "vrcx_lower";

pub(super) fn register_functions(conn: &Connection) -> Result<()> {
    conn.create_scalar_function(
        UNICODE_LOWER,
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            Ok(ctx
                .get::<Option<String>>(0)?
                .map(|value| value.to_lowercase()))
        },
    )
    .map_err(|error| Error::sqlite_with_context("register screenshot search functions", error))
}

struct Clause {
    sql: String,
    params: Vec<Value>,
}

impl Clause {
    fn push(&mut self, condition: &str, values: impl IntoIterator<Item = Value>) {
        self.sql.push_str(" AND ");
        self.sql.push_str(condition);
        self.params.extend(values);
    }
}

fn placeholders(count: usize) -> String {
    vec!["?"; count].join(", ")
}

fn filter_clause(root_path: &str, filter: &ScreenshotFilter, include_people: bool) -> Clause {
    let mut clause = Clause {
        sql: "f.scan_root = ?".into(),
        params: vec![Value::Text(root_path.into())],
    };
    if let Some(from_ms) = filter.from_ms {
        clause.push("f.captured_at_ms >= ?", [Value::Integer(from_ms)]);
    }
    if let Some(to_ms) = filter.to_ms {
        clause.push("f.captured_at_ms < ?", [Value::Integer(to_ms)]);
    }
    let world_ids = trimmed(&filter.world_ids);
    if !world_ids.is_empty() {
        clause.push(
            &format!("f.world_id IN ({})", placeholders(world_ids.len())),
            world_ids.into_iter().map(Value::Text),
        );
    }
    let people = trimmed(&filter.people);
    if include_people && !people.is_empty() {
        let count = people.len();
        let members = format!(
            "FROM json_each(f.metadata_json, '$.players') p WHERE {PLAYER_ID} IN ({})",
            placeholders(count)
        );
        let condition = match filter.people_match {
            ScreenshotPeopleMatch::All => {
                format!("(SELECT COUNT(DISTINCT {PLAYER_ID}) {members}) = {count}")
            }
            ScreenshotPeopleMatch::Any => format!("EXISTS (SELECT 1 {members})"),
        };
        clause.push(&condition, people.into_iter().map(Value::Text));
    }
    let text = filter.text.trim();
    if !text.is_empty() {
        let needle = Value::Text(text.to_lowercase());
        let exact = Value::Text(text.into());
        clause.push(
            &format!(
                "(instr({UNICODE_LOWER}(COALESCE(f.world_name, '')), ?) > 0
                  OR instr({UNICODE_LOWER}(f.file_name), ?) > 0
                  OR f.world_id = ?
                  OR EXISTS (
                      SELECT 1 FROM json_each(f.metadata_json, '$.players') p
                      WHERE {PLAYER_ID} = ?
                         OR instr({UNICODE_LOWER}(json_extract(p.value, '$.displayName')), ?) > 0
                  ))"
            ),
            [needle.clone(), needle.clone(), exact.clone(), exact, needle],
        );
    }
    clause
}

fn trimmed(values: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && seen.insert(*value))
        .map(str::to_string)
        .collect()
}

impl MetadataCacheDb {
    pub fn query_screenshots_for_root(
        &self,
        root_path: &str,
        filter: &ScreenshotFilter,
        limit: Option<i64>,
    ) -> Result<ScreenshotQueryResult> {
        let conn = self.inner.conn.lock().unwrap();
        let clause = filter_clause(root_path, filter, true);
        let total = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM screenshot_files f WHERE {}",
                    clause.sql
                ),
                rusqlite::params_from_iter(&clause.params),
                |row| row.get(0),
            )
            .map_err(|error| Error::sqlite_with_context("count filtered screenshots", error))?;
        let without_people = if trimmed(&filter.people).is_empty() {
            0
        } else {
            let scope = filter_clause(root_path, filter, false);
            conn.query_row(
                &format!(
                    "SELECT COUNT(*) FROM screenshot_files f WHERE {}
                       AND COALESCE(json_array_length(f.metadata_json, '$.players'), 0) = 0",
                    scope.sql
                ),
                rusqlite::params_from_iter(&scope.params),
                |row| row.get(0),
            )
            .map_err(|error| {
                Error::sqlite_with_context("count screenshots without people", error)
            })?
        };
        let mut params = clause.params;
        params.push(Value::Integer(limit.unwrap_or(-1)));
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {IMAGE_COLUMNS} FROM screenshot_files f WHERE {}
                 ORDER BY f.captured_at_ms DESC, f.path DESC LIMIT ?",
                clause.sql
            ))
            .map_err(|error| Error::sqlite_with_context("prepare filtered screenshots", error))?;
        let images = stmt
            .query_map(
                rusqlite::params_from_iter(&params),
                Self::map_library_image_row,
            )
            .map_err(|error| Error::sqlite_with_context("read filtered screenshots", error))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| Error::sqlite_with_context("read filtered screenshot row", error))?;
        Ok(ScreenshotQueryResult {
            total,
            without_people,
            images,
        })
    }

    pub fn screenshot_people_for_root(
        &self,
        root_path: &str,
        filter: &ScreenshotFilter,
        limit: i64,
    ) -> Result<Vec<ScreenshotFacet>> {
        let mut clause = filter_clause(root_path, filter, true);
        let people = trimmed(&filter.people);
        if !people.is_empty() {
            clause.push(
                &format!("{PLAYER_ID} NOT IN ({})", placeholders(people.len())),
                people.into_iter().map(Value::Text),
            );
        }
        self.facets(
            &format!(
                "SELECT {PLAYER_ID} AS player_id, json_extract(p.value, '$.displayName'),
                        COUNT(*), MAX(f.captured_at_ms), f.path
                 FROM screenshot_files f, json_each(f.metadata_json, '$.players') p
                 WHERE {} AND substr({PLAYER_ID}, 1, 4) = 'usr_'
                   AND {PLAYER_ID} <> COALESCE(json_extract(f.metadata_json, '$.author.id'), '')
                 GROUP BY player_id ORDER BY 3 DESC, 4 DESC LIMIT ?",
                clause.sql
            ),
            clause.params,
            limit,
        )
    }

    pub fn screenshot_worlds_for_root(
        &self,
        root_path: &str,
        filter: &ScreenshotFilter,
        limit: i64,
    ) -> Result<Vec<ScreenshotFacet>> {
        let clause = filter_clause(root_path, filter, true);
        self.facets(
            &format!(
                "SELECT f.world_id, COALESCE(f.world_name, ''), COUNT(*), MAX(f.captured_at_ms), f.path
                 FROM screenshot_files f
                 WHERE {} AND COALESCE(f.world_id, '') <> ''
                 GROUP BY f.world_id ORDER BY 3 DESC, 4 DESC LIMIT ?",
                clause.sql
            ),
            clause.params,
            limit,
        )
    }

    pub fn screenshot_months_for_root(
        &self,
        root_path: &str,
        filter: &ScreenshotFilter,
        utc_offset_minutes: i64,
        limit: i64,
    ) -> Result<Vec<ScreenshotFacet>> {
        let clause = filter_clause(root_path, filter, true);
        let mut params = vec![Value::Text(format!("{utc_offset_minutes:+} minutes"))];
        params.extend(clause.params);
        self.facets(
            &format!(
                "SELECT strftime('%Y-%m', f.captured_at_ms / 1000, 'unixepoch', ?) AS month,
                        '', COUNT(*), MAX(f.captured_at_ms), f.path
                 FROM screenshot_files f
                 WHERE {} AND f.captured_at_ms > 0
                 GROUP BY month ORDER BY month DESC LIMIT ?",
                clause.sql
            ),
            params,
            limit,
        )
    }

    pub fn screenshots_by_file_names_for_root(
        &self,
        root_path: &str,
        file_names: &[String],
    ) -> Result<Vec<ScreenshotLibraryImage>> {
        let names = trimmed(file_names);
        if names.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.inner.conn.lock().unwrap();
        let mut params = vec![Value::Text(root_path.into())];
        params.extend(names.iter().cloned().map(Value::Text));
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {IMAGE_COLUMNS} FROM screenshot_files f
                 WHERE f.scan_root = ? AND f.file_name IN ({})
                 ORDER BY f.captured_at_ms DESC, f.path DESC",
                placeholders(names.len())
            ))
            .map_err(|error| Error::sqlite_with_context("prepare screenshots by name", error))?;
        let mut images = stmt
            .query_map(
                rusqlite::params_from_iter(&params),
                Self::map_library_image_row,
            )
            .map_err(|error| Error::sqlite_with_context("read screenshots by name", error))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| Error::sqlite_with_context("read screenshot by name row", error))?;
        let mut seen = std::collections::HashSet::new();
        images.retain(|image| seen.insert(image.file_name.clone()));
        Ok(images)
    }

    fn facets(
        &self,
        sql: &str,
        mut params: Vec<Value>,
        limit: i64,
    ) -> Result<Vec<ScreenshotFacet>> {
        params.push(Value::Integer(limit.clamp(1, 5000)));
        let conn = self.inner.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(sql)
            .map_err(|error| Error::sqlite_with_context("prepare screenshot facets", error))?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(&params), |row| {
                Ok(ScreenshotFacet {
                    id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    count: row.get(2)?,
                    last_captured_at_ms: row.get::<_, Option<i64>>(3)?.unwrap_or_default(),
                    cover_path: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                })
            })
            .map_err(|error| Error::sqlite_with_context("read screenshot facets", error))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| Error::sqlite_with_context("read screenshot facet row", error))
    }
}
