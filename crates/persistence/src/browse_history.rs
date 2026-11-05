use chrono::{Duration, SecondsFormat, Utc};
use serde_json::Value;
use vrcx_0_contracts::browse_history::{
    BrowseHistoryCursor, BrowseHistoryEntityKind, BrowseHistoryItemOutput, BrowseHistoryPageOutput,
    BrowseHistoryQueryInput, BrowseHistoryRecordInput,
};

use crate::common::{normalize_text, now_iso, strict_row_i64, strict_row_string, ParamsBuilder};
use crate::config;
use crate::database::DatabaseService;
use crate::ownership::OwnerId;
use crate::Error;

const RETENTION_CONFIG_KEY: &str = "browseHistoryRetentionDays";
const DEFAULT_RETENTION_DAYS: i64 = 30;
const OFF_RETENTION_DAYS: i64 = -1;
const ALLOWED_RETENTION_DAYS: [i64; 6] = [OFF_RETENTION_DAYS, 0, 7, 30, 90, 365];
const DEFAULT_PAGE_LIMIT: i64 = 120;
const MAX_PAGE_LIMIT: i64 = 200;

fn entity_kind_as_str(kind: BrowseHistoryEntityKind) -> &'static str {
    match kind {
        BrowseHistoryEntityKind::User => "user",
        BrowseHistoryEntityKind::World => "world",
        BrowseHistoryEntityKind::Avatar => "avatar",
        BrowseHistoryEntityKind::Group => "group",
    }
}

fn parse_entity_kind(value: &str) -> Result<BrowseHistoryEntityKind, Error> {
    match value {
        "user" => Ok(BrowseHistoryEntityKind::User),
        "world" => Ok(BrowseHistoryEntityKind::World),
        "avatar" => Ok(BrowseHistoryEntityKind::Avatar),
        "group" => Ok(BrowseHistoryEntityKind::Group),
        _ => Err(Error::Database(format!(
            "browse history contains unsupported entity kind: {value}"
        ))),
    }
}

fn ensure_browse_history_table(db: &DatabaseService) -> Result<(), Error> {
    db.ensure_schema_once("browse-history", || {
        db.execute_non_query(
            "CREATE TABLE IF NOT EXISTS browse_history (
                owner_user_id TEXT NOT NULL,
                entity_kind TEXT NOT NULL CHECK(entity_kind IN ('user', 'world', 'avatar', 'group')),
                entity_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                image_url TEXT NOT NULL DEFAULT '',
                first_viewed_at TEXT NOT NULL,
                last_viewed_at TEXT NOT NULL,
                view_count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (owner_user_id, entity_kind, entity_id)
            )",
            &Default::default(),
        )?;
        db.execute_non_query(
            "CREATE INDEX IF NOT EXISTS browse_history_owner_recent_idx
             ON browse_history (owner_user_id, last_viewed_at DESC, entity_kind, entity_id)",
            &Default::default(),
        )?;
        Ok(())
    })
}

fn normalized_retention_days(value: i64) -> i64 {
    if ALLOWED_RETENTION_DAYS.contains(&value) {
        value
    } else {
        DEFAULT_RETENTION_DAYS
    }
}

pub fn browse_history_retention_days_get(db: &DatabaseService) -> Result<i64, Error> {
    let value = config::get_string(
        db,
        RETENTION_CONFIG_KEY,
        &DEFAULT_RETENTION_DAYS.to_string(),
    )?;
    Ok(normalized_retention_days(
        value.parse().unwrap_or(DEFAULT_RETENTION_DAYS),
    ))
}

fn retention_cutoff(retention_days: i64) -> Option<String> {
    (retention_days > 0).then(|| {
        (Utc::now() - Duration::days(retention_days)).to_rfc3339_opts(SecondsFormat::Millis, true)
    })
}

pub fn browse_history_retention_days_set(
    db: &DatabaseService,
    retention_days: i64,
) -> Result<i64, Error> {
    if !ALLOWED_RETENTION_DAYS.contains(&retention_days) {
        return Err(Error::InvalidData(
            "Browse history retention must be off, 0, 7, 30, 90, or 365 days.".into(),
        ));
    }
    ensure_browse_history_table(db)?;
    config::set_string(db, RETENTION_CONFIG_KEY, &retention_days.to_string())?;
    if let Some(cutoff) = retention_cutoff(retention_days) {
        db.execute_non_query(
            "DELETE FROM browse_history WHERE last_viewed_at < @cutoff",
            &ParamsBuilder::new().set("cutoff", cutoff).build(),
        )?;
    }
    Ok(retention_days)
}

pub fn browse_history_record(
    db: &DatabaseService,
    input: BrowseHistoryRecordInput,
) -> Result<(), Error> {
    let owner_user_id = normalize_text(input.owner_user_id.as_str());
    let entity_id = normalize_text(input.entity_id);
    let is_own_profile =
        input.entity_kind == BrowseHistoryEntityKind::User && entity_id == owner_user_id;
    if owner_user_id.is_empty() || entity_id.is_empty() || is_own_profile {
        return Ok(());
    }

    ensure_browse_history_table(db)?;
    let retention_days = browse_history_retention_days_get(db)?;
    if retention_days == OFF_RETENTION_DAYS {
        return Ok(());
    }
    let viewed_at = now_iso();
    let title = normalize_text(input.title);
    let image_url = normalize_text(input.image_url);
    let record_visit = i64::from(input.record_visit);

    db.write_transaction(|tx| {
        if let Some(cutoff) = retention_cutoff(retention_days) {
            tx.execute_non_query(
                "DELETE FROM browse_history
                 WHERE owner_user_id = @owner_user_id AND last_viewed_at < @cutoff",
                &ParamsBuilder::new()
                    .set("owner_user_id", owner_user_id.clone())
                    .set("cutoff", cutoff)
                    .build(),
            )?;
        }
        tx.execute_non_query(
            "INSERT INTO browse_history (
                owner_user_id, entity_kind, entity_id, title, image_url,
                first_viewed_at, last_viewed_at, view_count
             ) VALUES (
                @owner_user_id, @entity_kind, @entity_id, @title, @image_url,
                @viewed_at, @viewed_at, @record_visit
             )
             ON CONFLICT(owner_user_id, entity_kind, entity_id) DO UPDATE SET
                title = CASE WHEN excluded.title = '' THEN browse_history.title ELSE excluded.title END,
                image_url = CASE WHEN excluded.image_url = '' THEN browse_history.image_url ELSE excluded.image_url END,
                last_viewed_at = CASE WHEN @record_visit = 1 THEN excluded.last_viewed_at ELSE browse_history.last_viewed_at END,
                view_count = browse_history.view_count + @record_visit",
            &ParamsBuilder::new()
                .set("owner_user_id", owner_user_id.clone())
                .set("entity_kind", entity_kind_as_str(input.entity_kind))
                .set("entity_id", entity_id.clone())
                .set("title", title.clone())
                .set("image_url", image_url.clone())
                .set("viewed_at", viewed_at.clone())
                .set("record_visit", record_visit)
                .build(),
        )?;
        Ok(())
    })
}

fn item_from_row(row: &[Value]) -> Result<BrowseHistoryItemOutput, Error> {
    Ok(BrowseHistoryItemOutput {
        entity_kind: parse_entity_kind(&strict_row_string(row, 0)?)?,
        entity_id: strict_row_string(row, 1)?,
        title: strict_row_string(row, 2)?,
        image_url: strict_row_string(row, 3)?,
        first_viewed_at: strict_row_string(row, 4)?,
        last_viewed_at: strict_row_string(row, 5)?,
        view_count: strict_row_i64(row, 6)?,
    })
}

pub fn browse_history_query(
    db: &DatabaseService,
    input: BrowseHistoryQueryInput,
) -> Result<BrowseHistoryPageOutput, Error> {
    let owner_user_id = normalize_text(input.owner_user_id.as_str());
    if owner_user_id.is_empty() {
        return Ok(BrowseHistoryPageOutput {
            items: Vec::new(),
            next_cursor: None,
        });
    }

    ensure_browse_history_table(db)?;
    let limit = if input.limit > 0 {
        input.limit.min(MAX_PAGE_LIMIT)
    } else {
        DEFAULT_PAGE_LIMIT
    };
    let search = normalize_text(input.search).to_lowercase();
    let retention_days = browse_history_retention_days_get(db)?;
    let mut clauses = vec!["owner_user_id = @owner_user_id", "view_count > 0"];
    let mut params = ParamsBuilder::new()
        .set("owner_user_id", owner_user_id)
        .set("limit", limit + 1);

    if let Some(cutoff) = retention_cutoff(retention_days) {
        clauses.push("last_viewed_at >= @cutoff");
        params = params.set("cutoff", cutoff);
    }
    if let Some(entity_kind) = input.entity_kind {
        clauses.push("entity_kind = @entity_kind");
        params = params.set("entity_kind", entity_kind_as_str(entity_kind));
    }
    if !search.is_empty() {
        clauses.push("(LOWER(title) LIKE @search OR LOWER(entity_id) LIKE @search)");
        params = params.set("search", format!("%{search}%"));
    }
    let date_from = normalize_text(input.date_from);
    if !date_from.is_empty() {
        clauses.push("last_viewed_at >= @date_from");
        params = params.set("date_from", date_from);
    }
    let date_to = normalize_text(input.date_to);
    if !date_to.is_empty() {
        clauses.push("last_viewed_at <= @date_to");
        params = params.set("date_to", date_to);
    }
    if let Some(cursor) = input.cursor {
        clauses.push(
            "(last_viewed_at < @cursor_viewed_at
              OR (last_viewed_at = @cursor_viewed_at AND entity_kind > @cursor_kind)
              OR (last_viewed_at = @cursor_viewed_at AND entity_kind = @cursor_kind AND entity_id > @cursor_id))",
        );
        params = params
            .set("cursor_viewed_at", normalize_text(cursor.last_viewed_at))
            .set("cursor_kind", entity_kind_as_str(cursor.entity_kind))
            .set("cursor_id", normalize_text(cursor.entity_id));
    }

    let sql = format!(
        "SELECT entity_kind, entity_id, title, image_url,
                first_viewed_at, last_viewed_at, view_count
         FROM browse_history
         WHERE {}
         ORDER BY last_viewed_at DESC, entity_kind ASC, entity_id ASC
         LIMIT @limit",
        clauses.join(" AND ")
    );
    let mut items = db
        .execute(&sql, &params.build())?
        .into_iter()
        .map(|row| item_from_row(&row))
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = items.len() > limit as usize;
    if has_more {
        items.truncate(limit as usize);
    }
    let next_cursor = has_more && !items.is_empty();
    let next_cursor = next_cursor.then(|| {
        let item = items.last().expect("checked non-empty browse history page");
        BrowseHistoryCursor {
            last_viewed_at: item.last_viewed_at.clone(),
            entity_kind: item.entity_kind,
            entity_id: item.entity_id.clone(),
        }
    });

    Ok(BrowseHistoryPageOutput { items, next_cursor })
}

pub fn browse_history_delete(
    db: &DatabaseService,
    owner_user_id: OwnerId,
    entity_kind: BrowseHistoryEntityKind,
    entity_id: String,
) -> Result<i64, Error> {
    ensure_browse_history_table(db)?;
    db.execute_non_query(
        "DELETE FROM browse_history
         WHERE owner_user_id = @owner_user_id AND entity_kind = @entity_kind AND entity_id = @entity_id",
        &ParamsBuilder::new()
            .set("owner_user_id", normalize_text(owner_user_id.as_str()))
            .set("entity_kind", entity_kind_as_str(entity_kind))
            .set("entity_id", normalize_text(entity_id))
            .build(),
    )
}

pub fn browse_history_clear(
    db: &DatabaseService,
    owner_user_id: OwnerId,
    entity_kind: Option<BrowseHistoryEntityKind>,
) -> Result<i64, Error> {
    ensure_browse_history_table(db)?;
    let owner_user_id = normalize_text(owner_user_id.as_str());
    match entity_kind {
        Some(entity_kind) => db.execute_non_query(
            "DELETE FROM browse_history
             WHERE owner_user_id = @owner_user_id AND entity_kind = @entity_kind",
            &ParamsBuilder::new()
                .set("owner_user_id", owner_user_id)
                .set("entity_kind", entity_kind_as_str(entity_kind))
                .build(),
        ),
        None => db.execute_non_query(
            "DELETE FROM browse_history WHERE owner_user_id = @owner_user_id",
            &ParamsBuilder::new()
                .set("owner_user_id", owner_user_id)
                .build(),
        ),
    }
}

#[cfg(test)]
mod tests;
