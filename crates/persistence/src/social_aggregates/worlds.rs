use std::collections::BTreeSet;

use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::favorites;
use crate::ownership::{owner_id_for_filter, OwnerId, OwnerRowId};
use crate::Error;
use vrcx_0_core::location::parse_location;
use vrcx_0_core::FavoriteEntityKind;

use super::caveats::{favorite_local_caveats, worlds_visited_caveats};
use super::helpers::{append_time_window_filter, millis_to_minutes, world_names_for_ids};
use super::types::{
    FavoriteAction, FavoriteLocalInput, FavoriteOutput, SearchWorldsVisitedInput,
    SearchWorldsVisitedOutput, TopVisitedWorldRow, TopVisitedWorldsInput, VisitedWorldMatch,
    VisitedWorldRow, WorldVisitHistory,
};
use super::visits::shift_timestamp;

const VISIT_PEOPLE_LIMIT: i64 = 5;
const VISIT_LEAVE_SLACK_MILLIS: i64 = 60_000;
const OPEN_VISIT_WINDOW_MILLIS: i64 = 24 * 60 * 60 * 1000;

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
                people: None,
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

pub fn world_visit_history(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    world_id: &str,
    recent_limit: i64,
) -> Result<WorldVisitHistory, Error> {
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let world_params = || {
        ParamsBuilder::new()
            .set("owner_id", owner_id)
            .set("world_id", world_id.trim())
    };
    let totals = db.execute(
        "SELECT COUNT(*), COALESCE(SUM(MAX(COALESCE(time, 0), 0)), 0),
                COALESCE(MIN(created_at), ''), COALESCE(MAX(created_at), '')
         FROM gamelog_location
         WHERE owner_id IN (0, @owner_id) AND world_id = @world_id",
        &world_params().build(),
    )?;
    let Some(totals) = totals.first() else {
        return Ok(WorldVisitHistory::default());
    };
    let mut recent_visits: Vec<VisitedWorldRow> = db
        .execute(
            "SELECT world_id, world_name, location, created_at, time
             FROM gamelog_location
             WHERE owner_id IN (0, @owner_id) AND world_id = @world_id
             ORDER BY created_at DESC, id DESC LIMIT @limit",
            &world_params()
                .set("limit", recent_limit.clamp(1, 20))
                .build(),
        )?
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
                people: None,
            }
        })
        .collect();
    for visit in &mut recent_visits {
        visit.people = Some(people_during_visit(db, owner_user_id, owner_id, visit)?);
    }
    Ok(WorldVisitHistory {
        visits: row_i64(totals, 0),
        total_minutes: millis_to_minutes(row_i64(totals, 1)),
        first_visited_at: row_string(totals, 2),
        last_visited_at: row_string(totals, 3),
        recent_visits,
    })
}

fn people_during_visit(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    owner_id: OwnerRowId,
    visit: &VisitedWorldRow,
) -> Result<Vec<String>, Error> {
    let stay_millis = visit.stay_minutes.max(0).saturating_mul(60_000);
    let until = shift_timestamp(
        &visit.visited_at,
        if stay_millis > 0 {
            stay_millis + VISIT_LEAVE_SLACK_MILLIS
        } else {
            OPEN_VISIT_WINDOW_MILLIS
        },
    )
    .unwrap_or_default();
    Ok(db
        .execute(
            "SELECT COALESCE(NULLIF(MAX(display_name), ''), user_id)
             FROM gamelog_join_leave
             WHERE owner_id IN (0, @owner_id) AND type = 'OnPlayerLeft'
               AND location = @location
               AND created_at > @from AND created_at <= @until
               AND trim(COALESCE(user_id, '')) <> '' AND user_id <> @owner_user_id
             GROUP BY user_id
             ORDER BY SUM(COALESCE(time, 0)) DESC
             LIMIT @limit",
            &ParamsBuilder::new()
                .set("owner_id", owner_id)
                .set("owner_user_id", owner_user_id.as_str())
                .set("location", visit.location.as_str())
                .set("from", visit.visited_at.as_str())
                .set("until", until)
                .set("limit", VISIT_PEOPLE_LIMIT)
                .build(),
        )?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .collect())
}

pub fn find_visited_worlds(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    name: &str,
    limit: i64,
) -> Result<Vec<VisitedWorldMatch>, Error> {
    let name = name.trim().to_lowercase();
    if name.is_empty() {
        return Ok(Vec::new());
    }
    let rows = db.execute(
        "SELECT world_id, world_name, MAX(created_at) AS last_visited_at,
                MAX(lower(world_name) = @name) AS exact
         FROM gamelog_location
         WHERE owner_id IN (0, @owner_id)
           AND COALESCE(world_id, '') <> ''
           AND instr(lower(world_name), @name) > 0
         GROUP BY world_id
         ORDER BY exact DESC, last_visited_at DESC
         LIMIT @limit",
        &ParamsBuilder::new()
            .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
            .set("name", name)
            .set("limit", limit.clamp(1, 20))
            .build(),
    )?;
    Ok(rows
        .into_iter()
        .map(|row| VisitedWorldMatch {
            world_id: row_string(&row, 0),
            world_name: row_string(&row, 1),
            last_visited_at: row_string(&row, 2),
        })
        .collect())
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
