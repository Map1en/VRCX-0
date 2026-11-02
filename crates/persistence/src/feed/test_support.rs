use crate::common::ParamsBuilder;
use crate::database::DatabaseService;
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

pub fn seed_feed_avatar_row(
    db: &DatabaseService,
    owner_user_id: &str,
    (created_at, user_id, display_name, owner_id, avatar_name): (&str, &str, &str, &str, &str),
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    db.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_feed_avatar (created_at, user_id, display_name, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url) \
             VALUES (@created_at, @user_id, @display_name, @owner_id, @avatar_name, '', '', '', '')"
        ),
        &ParamsBuilder::new()
            .set("created_at", created_at)
            .set("user_id", user_id)
            .set("display_name", display_name)
            .set("owner_id", owner_id)
            .set("avatar_name", avatar_name)
            .build(),
    )?;
    Ok(())
}

pub fn seed_feed_bio_row(
    db: &DatabaseService,
    owner_user_id: &str,
    (created_at, user_id, display_name, bio, previous_bio): (&str, &str, &str, &str, &str),
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    db.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_feed_bio (created_at, user_id, display_name, bio, previous_bio) \
             VALUES (@created_at, @user_id, @display_name, @bio, @previous_bio)"
        ),
        &ParamsBuilder::new()
            .set("created_at", created_at)
            .set("user_id", user_id)
            .set("display_name", display_name)
            .set("bio", bio)
            .set("previous_bio", previous_bio)
            .build(),
    )?;
    Ok(())
}

pub fn seed_feed_online_row(
    db: &DatabaseService,
    owner_user_id: &str,
    (created_at, user_id, display_name): (&str, &str, &str),
) -> Result<(), Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    db.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_feed_online_offline (created_at, user_id, display_name, type) \
             VALUES (@created_at, @user_id, @display_name, 'Online')"
        ),
        &ParamsBuilder::new()
            .set("created_at", created_at)
            .set("user_id", user_id)
            .set("display_name", display_name)
            .build(),
    )?;
    Ok(())
}

pub fn seed_feed_gps_rows(db: &DatabaseService, user_id: &str, rows: i64) -> Result<(), Error> {
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
