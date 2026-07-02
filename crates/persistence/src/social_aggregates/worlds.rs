use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::favorites;
use crate::Error;

use super::caveats::{favorite_local_caveats, worlds_visited_caveats};
use super::helpers::{append_time_window_filter, millis_to_minutes};
use super::types::{
    FavoriteLocalInput, FavoriteOutput, SearchWorldsVisitedInput, SearchWorldsVisitedOutput,
    VisitedWorldRow,
};

pub fn search_worlds_visited(
    db: &DatabaseService,
    input: SearchWorldsVisitedInput,
) -> Result<SearchWorldsVisitedOutput, Error> {
    let limit = input.limit.clamp(1, 100);
    let mut sql = String::from(
        "SELECT world_id, world_name, location, created_at, time
         FROM gamelog_location
         WHERE 1 = 1",
    );
    let mut params = ParamsBuilder::new().set("limit", limit);
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT @limit");

    let rows = db
        .execute(&sql, &params.build())?
        .into_iter()
        .map(|row| VisitedWorldRow {
            world_id: row_string(&row, 0),
            world_name: row_string(&row, 1),
            location: row_string(&row, 2),
            visited_at: row_string(&row, 3),
            stay_minutes: millis_to_minutes(row_i64(&row, 4).max(0)),
        })
        .filter(|row| !row.world_id.is_empty() || !row.location.is_empty())
        .collect::<Vec<_>>();

    let summary = worlds_visited_summary(&rows);
    Ok(SearchWorldsVisitedOutput {
        rows,
        summary,
        caveats: worlds_visited_caveats(),
    })
}

fn worlds_visited_summary(rows: &[VisitedWorldRow]) -> String {
    if rows.is_empty() {
        return "No world visits found in this window.".to_string();
    }
    let names = rows
        .iter()
        .map(|row| {
            if row.world_name.is_empty() {
                row.location.as_str()
            } else {
                row.world_name.as_str()
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("{} recent world visit(s): {names}.", rows.len())
}

pub fn favorite_local(
    db: &DatabaseService,
    input: FavoriteLocalInput,
) -> Result<FavoriteOutput, Error> {
    let kind = input.kind.trim().to_ascii_lowercase();
    let entity_id = input.entity_id.trim().to_string();
    let group = input.group.trim().to_string();
    let action = FavoriteAction::parse(&input.action)?;
    if kind.is_empty() {
        return Err(Error::InvalidData("favorite requires kind".into()));
    }
    let Some(expected_prefix) = favorite_entity_prefix(&kind) else {
        return Err(Error::InvalidData(
            "favorite kind must be world, friend, or avatar".into(),
        ));
    };
    if entity_id.is_empty() {
        return Err(Error::InvalidData("favorite requires entity_id".into()));
    }
    if !entity_id.starts_with(expected_prefix) {
        return Err(Error::InvalidData(format!(
            "favorite {kind} entity_id must start with {expected_prefix}"
        )));
    }
    if group.is_empty() {
        return Err(Error::InvalidData("favorite requires group".into()));
    }
    let affected_rows = if input.dry_run {
        0
    } else {
        action.apply(db, &kind, &entity_id, &group)?
    };
    Ok(FavoriteOutput {
        kind,
        entity_id,
        group,
        action: action.as_str().into(),
        dry_run: input.dry_run,
        affected_rows,
        caveats: favorite_local_caveats(),
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FavoriteAction {
    Add,
    Remove,
}

impl FavoriteAction {
    fn parse(value: &str) -> Result<Self, Error> {
        match value.trim().to_ascii_lowercase().as_str() {
            "add" => Ok(Self::Add),
            "remove" => Ok(Self::Remove),
            _ => Err(Error::InvalidData(
                "favorite action must be add or remove".into(),
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Remove => "remove",
        }
    }

    fn apply(
        self,
        db: &DatabaseService,
        kind: &str,
        entity_id: &str,
        group: &str,
    ) -> Result<i64, Error> {
        match self {
            Self::Add => favorites::favorite_add(
                db,
                kind.to_string(),
                entity_id.to_string(),
                group.to_string(),
            ),
            Self::Remove => favorites::favorite_remove(
                db,
                kind.to_string(),
                entity_id.to_string(),
                group.to_string(),
            ),
        }
    }
}

fn favorite_entity_prefix(kind: &str) -> Option<&'static str> {
    match kind {
        "world" => Some("wrld_"),
        "friend" => Some("usr_"),
        "avatar" => Some("avtr_"),
        _ => None,
    }
}
