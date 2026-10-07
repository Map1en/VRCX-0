use std::collections::{BTreeSet, HashMap};

use chrono::NaiveDate;

use super::spans::{read_source_rows, unclosed_stays_sql};
use crate::activity::{activity_iso_from_ms, parse_activity_time_ms};
use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::game_log::ensure_game_log_tables;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::player_list::world_summaries_get;
use crate::social_aggregates::{current_friend_id_set, tz_offset_modifier};
use crate::Error;

use vrcx_0_contracts::activity_page::{ActivityJourneyCompanion, ActivityJourneyVisit};

const COMPANION_LEAVE_GRACE_MS: i64 = 60_000;

struct CompanionLeave {
    left_ms: i64,
    time: i64,
    location: String,
    user_id: String,
    display_name: String,
}

pub fn read_journey_visits(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: i64,
    to_ms: i64,
) -> Result<Vec<ActivityJourneyVisit>, Error> {
    let mut visits = read_source_rows(db, owner_user_id, Some(from_ms), to_ms)?
        .into_iter()
        .filter_map(|row| {
            let end_ms = parse_activity_time_ms(&row.left_at)?;
            Some(ActivityJourneyVisit {
                location: row.location,
                world_id: row.world_id,
                world_name: row.world_name,
                world_image_url: String::new(),
                start_ms: end_ms.checked_sub(row.time)?,
                end_ms,
                companions: Vec::new(),
            })
        })
        .filter(|visit| visit.end_ms > from_ms && visit.start_ms < to_ms)
        .collect::<Vec<_>>();
    let (Some(first_start), Some(last_end)) = (
        visits.iter().map(|visit| visit.start_ms).min(),
        visits.iter().map(|visit| visit.end_ms).max(),
    ) else {
        return Ok(visits);
    };

    let leaves = read_companion_leaves(
        db,
        owner_user_id,
        first_start,
        last_end + COMPANION_LEAVE_GRACE_MS,
    )?;
    let friend_ids = current_friend_id_set(db, owner_user_id)?;
    let worlds = world_summaries_get(
        db,
        owner_user_id,
        visits.iter().map(|visit| visit.world_id.clone()).collect(),
    )?;
    for visit in &mut visits {
        visit.companions = fold_companions(visit, &leaves, &friend_ids);
        if let Some(world) = worlds.get(&visit.world_id) {
            visit.world_image_url = if world.thumbnail_image_url.is_empty() {
                world.image_url.clone()
            } else {
                world.thumbnail_image_url.clone()
            };
        }
    }
    Ok(visits)
}

fn fold_companions(
    visit: &ActivityJourneyVisit,
    leaves: &[CompanionLeave],
    friend_ids: &std::collections::HashSet<String>,
) -> Vec<ActivityJourneyCompanion> {
    let mut by_person: HashMap<String, ActivityJourneyCompanion> = HashMap::new();
    for leave in leaves.iter().filter(|leave| {
        leave.location == visit.location
            && leave.left_ms >= visit.start_ms
            && leave.left_ms <= visit.end_ms + COMPANION_LEAVE_GRACE_MS
            && leave.left_ms - leave.time <= visit.end_ms
    }) {
        let key = if leave.user_id.is_empty() {
            format!("name:{}", leave.display_name)
        } else {
            leave.user_id.clone()
        };
        let shared_ms = (leave.left_ms.min(visit.end_ms)
            - (leave.left_ms - leave.time).max(visit.start_ms))
        .max(0);
        let companion = by_person
            .entry(key)
            .or_insert_with(|| ActivityJourneyCompanion {
                is_friend: friend_ids.contains(&leave.user_id),
                user_id: leave.user_id.clone(),
                ..ActivityJourneyCompanion::default()
            });
        companion.display_name = leave.display_name.clone();
        companion.shared_ms += shared_ms;
    }
    let mut companions = by_person.into_values().collect::<Vec<_>>();
    companions.sort_by(|left, right| {
        right
            .shared_ms
            .cmp(&left.shared_ms)
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    companions
}

fn read_companion_leaves(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: i64,
    to_ms: i64,
) -> Result<Vec<CompanionLeave>, Error> {
    ensure_game_log_tables(db)?;
    let rows = db.execute(
        "SELECT created_at, time, COALESCE(location, ''), COALESCE(user_id, ''),
                COALESCE(display_name, '')
         FROM gamelog_join_leave
         WHERE owner_id IN (0, @owner_id)
           AND type = 'OnPlayerLeft'
           AND created_at >= @from_iso
           AND created_at <= @to_iso
           AND COALESCE(user_id, '') <> @owner_user_id
           AND NOT (trim(COALESCE(user_id, '')) = '' AND trim(COALESCE(display_name, '')) = '')
         ORDER BY created_at ASC, id ASC",
        &ParamsBuilder::new()
            .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
            .set("owner_user_id", owner_user_id.as_str())
            .set("from_iso", activity_iso_from_ms(from_ms))
            .set("to_iso", activity_iso_from_ms(to_ms))
            .build(),
    )?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(CompanionLeave {
                left_ms: parse_activity_time_ms(&row_string(&row, 0))?,
                time: row_i64(&row, 1).max(0),
                location: row_string(&row, 2),
                user_id: row_string(&row, 3),
                display_name: row_string(&row, 4),
            })
        })
        .collect())
}

pub fn read_journey_days(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    utc_offset_minutes: i64,
) -> Result<Vec<String>, Error> {
    ensure_game_log_tables(db)?;
    let rows = db.execute(
        &format!(
            "SELECT substr(datetime(created_at, '-' || (time * 1.0 / 1000) || ' seconds', @tz), 1, 10),
                    substr(datetime(created_at, @tz), 1, 10)
             FROM gamelog_join_leave
             WHERE owner_id IN (0, @owner_id)
               AND user_id = @user_id
               AND type = 'OnPlayerLeft'
               AND time > 0
             UNION ALL
             SELECT substr(datetime(started_at, @tz), 1, 10),
                    substr(datetime(last_at, @tz), 1, 10)
             FROM ({})
             WHERE last_at > started_at",
            unclosed_stays_sql("")
        ),
        &ParamsBuilder::new()
            .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
            .set("user_id", owner_user_id.as_str())
            .set("tz", tz_offset_modifier(utc_offset_minutes))
            .build(),
    )?;
    let mut days = BTreeSet::new();
    for row in rows {
        let (Ok(start), Ok(end)) = (
            NaiveDate::parse_from_str(&row_string(&row, 0), "%Y-%m-%d"),
            NaiveDate::parse_from_str(&row_string(&row, 1), "%Y-%m-%d"),
        ) else {
            continue;
        };
        days.extend(
            start
                .iter_days()
                .take_while(|day| *day <= end)
                .map(|day| day.format("%Y-%m-%d").to_string()),
        );
    }
    Ok(days.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db(name: &str) -> DatabaseService {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-journey-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap();
        ensure_game_log_tables(&db).unwrap();
        db
    }

    fn leave(db: &DatabaseService, created_at: &str, name: &str, user_id: &str, time: i64) {
        db.execute_non_query(
            "INSERT INTO gamelog_join_leave (created_at, type, display_name, location, user_id, time)
             VALUES (@created_at, 'OnPlayerLeft', @name, 'wrld_a:1~friends', @user_id, @time)",
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("name", name)
                .set("user_id", user_id)
                .set("time", time)
                .build(),
        )
        .unwrap();
    }

    fn location(db: &DatabaseService, created_at: &str, location: &str, time: i64) {
        db.execute_non_query(
            "INSERT INTO gamelog_location (created_at, location, world_id, world_name, time)
             VALUES (@created_at, @location, 'wrld_a', 'Alpha', @time)",
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("location", location)
                .set("time", time)
                .build(),
        )
        .unwrap();
    }

    fn video(db: &DatabaseService, created_at: &str) {
        db.execute_non_query(
            "INSERT INTO gamelog_video_play (created_at, video_url, location)
             VALUES (@created_at, @created_at, 'wrld_a:1~friends')",
            &ParamsBuilder::new().set("created_at", created_at).build(),
        )
        .unwrap();
    }

    fn ms(value: &str) -> i64 {
        parse_activity_time_ms(value).unwrap()
    }

    const MINUTE: i64 = 60_000;

    #[test]
    fn visits_carry_companions_with_shared_time_clipped_to_the_visit() {
        let db = test_db("companions");
        let owner = OwnerId::new("usr_me");
        leave(
            &db,
            "2026-10-05T12:00:00.000Z",
            "Me",
            "usr_me",
            120 * MINUTE,
        );
        leave(
            &db,
            "2026-10-05T10:40:00.000Z",
            "Alice",
            "usr_alice",
            30 * MINUTE,
        );
        leave(
            &db,
            "2026-10-05T11:30:00.000Z",
            "Alice",
            "usr_alice",
            20 * MINUTE,
        );
        leave(
            &db,
            "2026-10-05T12:00:30.000Z",
            "Bob",
            "usr_bob",
            300 * MINUTE,
        );
        leave(
            &db,
            "2026-10-05T13:00:00.000Z",
            "Carol",
            "usr_carol",
            10 * MINUTE,
        );

        let visits = read_journey_visits(
            &db,
            &owner,
            ms("2026-10-05T00:00:00.000Z"),
            ms("2026-10-06T00:00:00.000Z"),
        )
        .unwrap();

        assert_eq!(visits.len(), 1);
        assert_eq!(visits[0].start_ms, ms("2026-10-05T10:00:00.000Z"));
        assert_eq!(visits[0].end_ms, ms("2026-10-05T12:00:00.000Z"));
        let shared = visits[0]
            .companions
            .iter()
            .map(|companion| (companion.display_name.as_str(), companion.shared_ms))
            .collect::<Vec<_>>();
        assert_eq!(shared, vec![("Bob", 120 * MINUTE), ("Alice", 50 * MINUTE)]);
    }

    #[test]
    fn journey_days_cover_every_local_day_a_visit_touches() {
        let db = test_db("days");
        let owner = OwnerId::new("usr_me");
        leave(
            &db,
            "2026-10-06T07:30:00.000Z",
            "Me",
            "usr_me",
            8 * 60 * MINUTE,
        );
        leave(&db, "2026-10-08T03:00:00.000Z", "Me", "usr_me", 0);

        assert_eq!(
            read_journey_days(&db, &owner, 0).unwrap(),
            vec!["2026-10-05".to_string(), "2026-10-06".to_string()]
        );
        assert_eq!(
            read_journey_days(&db, &owner, 9 * 60).unwrap(),
            vec!["2026-10-06".to_string()]
        );
    }

    #[test]
    fn unclosed_stays_end_at_their_last_logged_event() {
        let db = test_db("unclosed");
        let owner = OwnerId::new("usr_me");
        location(&db, "2026-10-05T08:00:00.000Z", "wrld_a:1~friends", 0);
        leave(&db, "2026-10-05T09:00:00.000Z", "Me", "usr_me", 60 * MINUTE);
        location(&db, "2026-10-05T23:00:00.000Z", "wrld_a:1~friends", 0);
        leave(
            &db,
            "2026-10-06T00:30:00.000Z",
            "Alice",
            "usr_alice",
            30 * MINUTE,
        );
        video(&db, "2026-10-06T01:15:00.000Z");

        let visits = read_journey_visits(
            &db,
            &owner,
            ms("2026-10-05T00:00:00.000Z"),
            ms("2026-10-07T00:00:00.000Z"),
        )
        .unwrap();

        let spans = visits
            .iter()
            .map(|visit| (visit.start_ms, visit.end_ms))
            .collect::<Vec<_>>();
        assert_eq!(
            spans,
            vec![
                (
                    ms("2026-10-05T08:00:00.000Z"),
                    ms("2026-10-05T09:00:00.000Z")
                ),
                (
                    ms("2026-10-05T23:00:00.000Z"),
                    ms("2026-10-06T01:15:00.000Z")
                ),
            ]
        );
        assert_eq!(visits[1].world_name, "Alpha");
        assert_eq!(visits[1].companions.len(), 1);
        assert_eq!(visits[1].companions[0].shared_ms, 30 * MINUTE);
        assert_eq!(
            read_journey_days(&db, &owner, 0).unwrap(),
            vec!["2026-10-05".to_string(), "2026-10-06".to_string()]
        );
    }
}
