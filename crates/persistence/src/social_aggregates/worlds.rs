use std::collections::BTreeSet;

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::favorites;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::Error;
use vrcx_0_core::location::parse_location;
use vrcx_0_core::FavoriteEntityKind;

use super::caveats::{favorite_local_caveats, worlds_visited_caveats};
use super::helpers::{append_time_window_filter, millis_to_minutes, world_names_for_ids};
use super::types::{
    FavoriteAction, FavoriteLocalInput, FavoriteOutput, SearchWorldsVisitedInput,
    SearchWorldsVisitedOutput, TopVisitedWorldRow, TopVisitedWorldsInput, VisitedWorldRow,
};
use super::visits::shift_timestamp;

pub fn search_worlds_visited(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    input: SearchWorldsVisitedInput,
) -> Result<SearchWorldsVisitedOutput, Error> {
    let limit = input.limit.clamp(1, 100);
    let mut sql = String::from(
        "SELECT world_id, world_name, location, created_at, time
         FROM gamelog_location
         WHERE owner_id IN (0, @owner_id)",
    );
    let mut params = ParamsBuilder::new()
        .set("limit", limit)
        .set("owner_id", owner_id_for_filter(db, owner_user_id)?);
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT @limit");

    let rows = db
        .execute(&sql, &params.build())?
        .into_iter()
        .map(|row| {
            let visited_at = row_string(&row, 3);
            let stay_millis = row_i64(&row, 4).max(0);
            let location = row_string(&row, 2);
            VisitedWorldRow {
                world_id: row_string(&row, 0),
                world_name: row_string(&row, 1),
                access_type: parse_location(&location).access_type,
                location,
                left_at: (stay_millis > 0)
                    .then(|| shift_timestamp(&visited_at, stay_millis))
                    .flatten(),
                visited_at,
                stay_minutes: millis_to_minutes(stay_millis),
            }
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

pub fn top_visited_worlds(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    input: TopVisitedWorldsInput,
) -> Result<Vec<TopVisitedWorldRow>, Error> {
    let mut sql = String::from(
        "SELECT
            MAX(COALESCE(world_id, '')),
            COALESCE(MAX(NULLIF(world_name, '')), ''),
            COUNT(*) AS visits,
            SUM(MAX(COALESCE(time, 0), 0) / 60000) AS total_minutes,
            MAX(created_at),
            CASE WHEN COALESCE(world_id, '') <> '' THEN world_id ELSE COALESCE(location, '') END
                AS world_key
         FROM gamelog_location
         WHERE owner_id IN (0, @owner_id)",
    );
    let mut params = ParamsBuilder::new()
        .set("limit", input.limit.clamp(1, 100))
        .set("owner_id", owner_id_for_filter(db, owner_user_id)?);
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");
    sql.push_str(
        " GROUP BY world_key
          HAVING world_key <> ''
          ORDER BY visits DESC, total_minutes DESC, 2 ASC
          LIMIT @limit",
    );

    let mut rows = db
        .execute(&sql, &params.build())?
        .into_iter()
        .map(|row| TopVisitedWorldRow {
            world_id: row_string(&row, 0),
            world_name: row_string(&row, 1),
            visits: row_i64(&row, 2),
            total_minutes: row_i64(&row, 3),
            last_visited_at: row_string(&row, 4),
        })
        .collect::<Vec<_>>();
    let world_ids = rows
        .iter()
        .filter(|row| !row.world_id.is_empty())
        .map(|row| row.world_id.clone())
        .collect::<BTreeSet<_>>();
    let latest_names = world_names_for_ids(db, owner_user_id, &world_ids)?;
    for row in &mut rows {
        if let Some(name) = latest_names.get(&row.world_id) {
            row.world_name = name.clone();
        }
    }
    Ok(rows)
}

fn worlds_visited_summary(rows: &[VisitedWorldRow]) -> String {
    if rows.is_empty() {
        return "No world visits found in this window.".to_string();
    }
    let mut visits_per_world: Vec<(&str, usize)> = Vec::new();
    for row in rows {
        let name = if row.world_name.is_empty() {
            "an unnamed world"
        } else {
            row.world_name.as_str()
        };
        match visits_per_world.iter_mut().find(|(seen, _)| *seen == name) {
            Some((_, count)) => *count += 1,
            None => visits_per_world.push((name, 1)),
        }
    }
    let names = visits_per_world
        .iter()
        .map(|(name, count)| format!("{name} ({count})"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{} recent world visit(s) across {} world(s), newest first: {names}.",
        rows.len(),
        visits_per_world.len()
    )
}

pub fn favorite_local(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    input: FavoriteLocalInput,
) -> Result<FavoriteOutput, Error> {
    let kind = input.kind;
    let entity_id = input.entity_id.trim().to_string();
    let group = input.group.trim().to_string();
    let action = input.action;
    let expected_prefix = kind.entity_id_prefix();
    if entity_id.is_empty() {
        return Err(Error::InvalidData("favorite requires entity_id".into()));
    }
    if !entity_id.starts_with(expected_prefix) {
        return Err(Error::InvalidData(format!(
            "favorite {} entity_id must start with {expected_prefix}",
            kind.as_str()
        )));
    }
    if group.is_empty() {
        return Err(Error::InvalidData("favorite requires group".into()));
    }
    let affected_rows = if input.dry_run {
        0
    } else {
        apply_favorite_action(action, db, owner_user_id, kind, &entity_id, &group)?
    };
    Ok(FavoriteOutput {
        kind,
        entity_id,
        group,
        action,
        dry_run: input.dry_run,
        affected_rows,
        caveats: favorite_local_caveats(),
    })
}

fn apply_favorite_action(
    action: FavoriteAction,
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
    entity_id: &str,
    group: &str,
) -> Result<i64, Error> {
    match action {
        FavoriteAction::Add => favorites::favorite_add(
            db,
            Some(owner_user_id),
            kind,
            entity_id.to_string(),
            group.to_string(),
        ),
        FavoriteAction::Remove => favorites::favorite_remove(
            db,
            Some(owner_user_id),
            kind,
            entity_id.to_string(),
            group.to_string(),
        ),
    }
}
