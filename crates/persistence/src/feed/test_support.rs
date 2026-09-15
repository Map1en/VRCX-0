use crate::database::DatabaseService;
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

pub(crate) fn seed_feed_gps_rows(
    db: &DatabaseService,
    user_id: &str,
    rows: i64,
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    db.execute_non_query(
        &format!(
            "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < {rows}) \
             INSERT INTO {user_prefix}_feed_gps (created_at, user_id, display_name, location, world_name, previous_location, time, group_name) \
             SELECT \
               strftime('%Y-%m-%dT%H:%M:%fZ', 1700000000 + n * 60, 'unixepoch'), \
               'usr_' || printf('%08x', (n * 7919) % 500) || '-0000-0000-0000-000000000000', \
               'Friend ' || ((n * 7919) % 500), \
               'wrld_' || printf('%08x', (n * 104729) % 20000) || '-1111-2222-3333-444444444444:' || (n % 99999) || '~region(jp)', \
               'World ' || ((n * 104729) % 20000), \
               'wrld_' || printf('%08x', (n * 104729 + 1) % 20000) || '-1111-2222-3333-444444444444:' || (n % 99999) || '~private(usr_' || printf('%08x', n % 500) || ')~region(us)', \
               (n * 37) % 100000, \
               CASE WHEN n % 10 = 0 THEN 'Group ' || (n % 300) END \
             FROM seq"
        ),
        &Default::default(),
    )?;
    db.execute_non_query("ANALYZE", &Default::default())?;
    Ok(())
}
