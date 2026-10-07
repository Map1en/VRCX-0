use crate::activity::parse_activity_time_ms;
use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::game_log::ensure_game_log_tables;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::social_aggregates::{access_bucket_sql, world_id_from_location_sql};
use crate::Error;

use vrcx_0_contracts::activity_page::ActivityLocationSpan as LocationSpan;
use vrcx_0_core::activity_sessions::{span_duration_ms, SpanEnd};

pub(super) struct SourceRow {
    pub(super) left_at: String,
    pub(super) time: i64,
    pub(super) location: String,
    pub(super) world_id: String,
    pub(super) world_name: String,
    pub(super) access_bucket: String,
}

pub fn read_instance_spans(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
) -> Result<Vec<LocationSpan>, Error> {
    let rows = read_source_rows(db, owner_user_id, from_ms, to_ms)?;
    Ok(clip_spans(&spans_from_rows(&rows), from_ms, to_ms))
}

pub fn read_play_spans(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
    open_location: Option<&str>,
) -> Result<Vec<LocationSpan>, Error> {
    let mut spans = spans_from_rows(&read_source_rows(db, owner_user_id, from_ms, to_ms)?);
    let open = match open_location {
        Some(location) => read_open_instance_span(db, owner_user_id, location, to_ms)?,
        None => None,
    };
    if let Some(open) = open {
        spans.retain(|span| span.start_ms != open.start_ms);
        spans.push(open);
    }
    Ok(clip_spans(&spans, from_ms, to_ms))
}

fn read_open_instance_span(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    location: &str,
    now_ms: i64,
) -> Result<Option<LocationSpan>, Error> {
    let location = location.trim();
    if location.is_empty() {
        return Ok(None);
    }
    ensure_game_log_tables(db)?;
    let world_id_expr = world_id_from_location_sql("location");
    let access_expr = access_bucket_sql("location");
    let rows = db.execute(
        &format!(
            "SELECT created_at, time, {world_id_expr} AS world_id,
                    COALESCE(world_name, '') AS world_name, {access_expr} AS access_bucket
             FROM gamelog_location
             WHERE owner_id IN (0, @owner_id) AND location = @location
             ORDER BY created_at DESC, id DESC
             LIMIT 1"
        ),
        &ParamsBuilder::new()
            .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
            .set("location", location)
            .build(),
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    if row_i64(row, 1) != 0 {
        return Ok(None);
    }
    let Some(start_ms) = parse_activity_time_ms(&row_string(row, 0)) else {
        return Ok(None);
    };
    let duration_ms = span_duration_ms(start_ms, 0, SpanEnd::OpenTail, now_ms);
    if duration_ms <= 0 {
        return Ok(None);
    }
    Ok(Some(LocationSpan {
        start_ms,
        end_ms: start_ms + duration_ms,
        world_id: row_string(row, 2),
        world_name: row_string(row, 3),
        access_bucket: row_string(row, 4),
    }))
}

pub(super) fn read_source_rows(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
) -> Result<Vec<SourceRow>, Error> {
    let mut rows = read_closed_rows(db, owner_user_id, from_ms, to_ms)?;
    let closed = rows.iter().filter_map(row_bounds).collect::<Vec<_>>();
    rows.extend(
        read_unclosed_rows(db, owner_user_id, to_ms)?
            .into_iter()
            .filter(|row| {
                row_bounds(row).is_some_and(|(start_ms, end_ms)| {
                    from_ms.is_none_or(|from_ms| end_ms > from_ms)
                        && !closed.iter().any(|&(closed_start, closed_end)| {
                            start_ms < closed_end && closed_start < end_ms
                        })
                })
            }),
    );
    rows.sort_by_key(|row| parse_activity_time_ms(&row.left_at));
    Ok(rows)
}

fn row_bounds(row: &SourceRow) -> Option<(i64, i64)> {
    let end_ms = parse_activity_time_ms(&row.left_at)?;
    Some((end_ms.checked_sub(row.time)?, end_ms))
}

pub(super) fn unclosed_stays_sql(started_filter: &str) -> String {
    let last_event_sql = |table: &str| {
        format!(
            "COALESCE((SELECT MAX(e.created_at) FROM {table} e
                       WHERE e.location = s.location
                         AND e.created_at >= s.started_at
                         AND (s.next_at IS NULL OR e.created_at < s.next_at)
                         AND e.owner_id IN (0, @owner_id)), '')"
        )
    };
    let last_event_exprs = [
        "gamelog_join_leave",
        "gamelog_video_play",
        "gamelog_portal_spawn",
        "gamelog_resource_load",
    ]
    .map(last_event_sql)
    .join(",\n");
    format!(
        "WITH stays AS MATERIALIZED (
             SELECT l.created_at AS started_at, l.location,
                    COALESCE(l.world_name, '') AS world_name,
                    (SELECT MIN(n.created_at) FROM gamelog_location n
                     WHERE n.owner_id IN (0, @owner_id) AND n.created_at > l.created_at) AS next_at
             FROM gamelog_location l
             WHERE l.owner_id IN (0, @owner_id)
               AND l.time = 0
               AND l.location LIKE 'wrld_%'
               {started_filter}
         )
         SELECT s.started_at, s.location, s.world_name,
                MAX({last_event_exprs}) AS last_at
         FROM stays s
         WHERE NOT EXISTS (
             SELECT 1 FROM gamelog_join_leave j
             WHERE j.owner_id IN (0, @owner_id)
               AND j.type = 'OnPlayerLeft'
               AND j.time > 0
               AND +j.user_id = @user_id
               AND j.location = s.location
               AND j.created_at >= s.started_at
               AND (s.next_at IS NULL OR j.created_at <= s.next_at)
         )"
    )
}

fn read_unclosed_rows(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    to_ms: i64,
) -> Result<Vec<SourceRow>, Error> {
    let world_id_expr = world_id_from_location_sql("location");
    let access_expr = access_bucket_sql("location");
    let rows = db.execute(
        &format!(
            "SELECT started_at, last_at, location, {world_id_expr}, world_name, {access_expr}
             FROM ({})",
            unclosed_stays_sql("AND l.created_at <= @to_iso")
        ),
        &ParamsBuilder::new()
            .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
            .set("user_id", owner_user_id.as_str())
            .set("to_iso", crate::activity::activity_iso_from_ms(to_ms))
            .build(),
    )?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let start_ms = parse_activity_time_ms(&row_string(&row, 0))?;
            let left_at = row_string(&row, 1);
            let time = parse_activity_time_ms(&left_at)? - start_ms;
            (time > 0).then(|| SourceRow {
                left_at,
                time,
                location: row_string(&row, 2),
                world_id: row_string(&row, 3),
                world_name: row_string(&row, 4),
                access_bucket: row_string(&row, 5),
            })
        })
        .collect())
}

fn read_closed_rows(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
) -> Result<Vec<SourceRow>, Error> {
    ensure_game_log_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let world_id_expr = world_id_from_location_sql("jl.location");
    let access_expr = access_bucket_sql("jl.location");
    let from_filter = if from_ms.is_some() {
        "AND julianday(jl.created_at) >= julianday(@from_iso)"
    } else {
        ""
    };
    let params = ParamsBuilder::new()
        .set("owner_id", owner_id)
        .set("user_id", owner_user_id.as_str())
        .set(
            "from_iso",
            from_ms
                .map(crate::activity::activity_iso_from_ms)
                .unwrap_or_default(),
        )
        .set("to_iso", crate::activity::activity_iso_from_ms(to_ms))
        .build();
    let sql = format!(
        "SELECT jl.created_at,
                jl.time,
                COALESCE(jl.location, '') AS location,
                {world_id_expr} AS world_id,
                COALESCE((
                    SELECT gl.world_name
                    FROM gamelog_location gl
                    WHERE gl.owner_id IN (0, @owner_id)
                      AND gl.location = jl.location
                    ORDER BY gl.id DESC
                    LIMIT 1
                ), '') AS world_name,
                {access_expr} AS access_bucket
         FROM gamelog_join_leave jl
         WHERE jl.owner_id IN (0, @owner_id)
           AND jl.user_id = @user_id
           AND jl.type = 'OnPlayerLeft'
           AND jl.time > 0
           {from_filter}
           AND julianday(jl.created_at, '-' || (jl.time * 1.0 / 1000) || ' seconds') <= julianday(@to_iso)
         ORDER BY jl.created_at ASC, jl.id ASC"
    );

    Ok(db
        .execute(&sql, &params)?
        .into_iter()
        .map(|row| SourceRow {
            left_at: row_string(&row, 0),
            time: row_i64(&row, 1),
            location: row_string(&row, 2),
            world_id: row_string(&row, 3),
            world_name: row_string(&row, 4),
            access_bucket: row_string(&row, 5),
        })
        .collect())
}

fn spans_from_rows(rows: &[SourceRow]) -> Vec<LocationSpan> {
    let mut spans = Vec::with_capacity(rows.len());
    for row in rows {
        if row.time <= 0 {
            continue;
        }
        let Some(end_ms) = parse_activity_time_ms(&row.left_at) else {
            continue;
        };
        let Some(start_ms) = end_ms.checked_sub(row.time) else {
            continue;
        };
        spans.push(LocationSpan {
            start_ms,
            end_ms,
            world_id: row.world_id.clone(),
            world_name: row.world_name.clone(),
            access_bucket: row.access_bucket.clone(),
        });
    }
    spans
}

fn clip_spans(spans: &[LocationSpan], from_ms: Option<i64>, to_ms: i64) -> Vec<LocationSpan> {
    let mut clipped = Vec::with_capacity(spans.len());
    for span in spans {
        let start_ms = match from_ms {
            Some(from_ms) => span.start_ms.max(from_ms),
            None => span.start_ms,
        };
        let end_ms = span.end_ms.min(to_ms);
        if end_ms <= start_ms {
            continue;
        }
        clipped.push(LocationSpan {
            start_ms,
            end_ms,
            world_id: span.world_id.clone(),
            world_name: span.world_name.clone(),
            access_bucket: span.access_bucket.clone(),
        });
    }
    clipped
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: i64 = 1_700_000_000_000;
    const HOUR: i64 = 3_600_000;

    fn source_row(left_offset_ms: i64, time: i64) -> SourceRow {
        SourceRow {
            left_at: crate::activity::activity_iso_from_ms(BASE + left_offset_ms),
            time,
            location: "wrld_a:1".into(),
            world_id: "wrld_a".into(),
            world_name: "Alpha".into(),
            access_bucket: "public".into(),
        }
    }

    #[test]
    fn spans_use_the_closed_instance_end_and_duration() {
        let spans = spans_from_rows(&[source_row(3 * HOUR, HOUR)]);

        assert_eq!(spans.len(), 1);
        assert_eq!((spans[0].end_ms - spans[0].start_ms), HOUR);
        assert_eq!(spans[0].start_ms, BASE + 2 * HOUR);
        assert_eq!(spans[0].end_ms, BASE + 3 * HOUR);
    }

    #[test]
    fn spans_drop_unclosed_instance_rows() {
        let spans = spans_from_rows(&[source_row(3 * HOUR, 0)]);

        assert!(spans.is_empty());
    }

    #[test]
    fn clip_trims_spans_to_window_bounds() {
        let spans = vec![LocationSpan {
            start_ms: BASE,
            end_ms: BASE + 10 * HOUR,
            world_id: "wrld_a".into(),
            world_name: "Alpha".into(),
            access_bucket: "public".into(),
        }];

        let clipped = clip_spans(&spans, Some(BASE + 2 * HOUR), BASE + 5 * HOUR);

        assert_eq!(clipped.len(), 1);
        assert_eq!(clipped[0].start_ms, BASE + 2 * HOUR);
        assert_eq!(clipped[0].end_ms, BASE + 5 * HOUR);
    }

    #[test]
    fn clip_drops_spans_outside_window() {
        let spans = vec![LocationSpan {
            start_ms: BASE,
            end_ms: BASE + HOUR,
            world_id: "wrld_a".into(),
            world_name: "Alpha".into(),
            access_bucket: "public".into(),
        }];

        assert!(clip_spans(&spans, Some(BASE + 2 * HOUR), BASE + 5 * HOUR).is_empty());
    }

    fn test_db(name: &str) -> DatabaseService {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-spans-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap();
        ensure_game_log_tables(&db).unwrap();
        db
    }

    fn iso(offset_ms: i64) -> String {
        crate::activity::activity_iso_from_ms(BASE + offset_ms)
    }

    fn insert_location(db: &DatabaseService, offset_ms: i64, location: &str) {
        db.execute_non_query(
            "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time)
             VALUES (@created_at, @location, 'wrld_a', 'Alpha', 0)",
            &ParamsBuilder::new()
                .set("created_at", iso(offset_ms))
                .set("location", location)
                .build(),
        )
        .unwrap();
    }

    fn insert_leave(
        db: &DatabaseService,
        offset_ms: i64,
        location: &str,
        user_id: &str,
        time: i64,
    ) {
        db.execute_non_query(
            "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
             VALUES (@created_at, 'OnPlayerLeft', @user_id, @location, @user_id, @time)",
            &ParamsBuilder::new()
                .set("created_at", iso(offset_ms))
                .set("location", location)
                .set("user_id", user_id)
                .set("time", time)
                .build(),
        )
        .unwrap();
    }

    fn bounds(spans: &[LocationSpan]) -> Vec<(i64, i64)> {
        spans
            .iter()
            .map(|span| (span.start_ms - BASE, span.end_ms - BASE))
            .collect()
    }

    #[test]
    fn instance_spans_count_unclosed_stays_only_up_to_their_last_event() {
        let db = test_db("unclosed");
        let owner = OwnerId::new("usr_me");
        insert_location(&db, 0, "wrld_a:1");
        insert_leave(&db, HOUR, "wrld_a:1", "usr_alice", HOUR);
        insert_location(&db, 5 * HOUR, "wrld_a:2");
        insert_location(&db, 30 * HOUR, "wrld_a:3");
        insert_leave(&db, 31 * HOUR, "wrld_a:3", "usr_bob", HOUR);
        insert_leave(&db, 32 * HOUR, "", "usr_me", 2 * HOUR);

        let spans = read_instance_spans(&db, &owner, None, BASE + 40 * HOUR).unwrap();

        assert_eq!(bounds(&spans), vec![(0, HOUR), (30 * HOUR, 32 * HOUR)]);
    }

    #[test]
    fn play_spans_keep_the_open_instance_once() {
        let db = test_db("open");
        let owner = OwnerId::new("usr_me");
        insert_location(&db, 0, "wrld_a:1");
        insert_leave(&db, HOUR, "wrld_a:1", "usr_alice", HOUR);

        let spans = read_play_spans(&db, &owner, None, BASE + 3 * HOUR, Some("wrld_a:1")).unwrap();

        assert_eq!(bounds(&spans), vec![(0, 3 * HOUR)]);
    }
}
