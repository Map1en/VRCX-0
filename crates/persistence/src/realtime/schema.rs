use crate::database::DatabaseService;
use crate::Error;

pub fn ensure_realtime_tables(db: &DatabaseService, user_prefix: &str) -> Result<(), Error> {
    ensure_user_prefix(user_prefix)?;
    db.ensure_schema_once(&format!("realtime:{user_prefix}"), || {
        for sql in realtime_table_statements(user_prefix) {
            db.execute_non_query(&sql, &Default::default())?;
        }
        Ok(())
    })
}

pub fn normalize_user_table_prefix(user_id: &str) -> Result<String, Error> {
    let normalized = user_id.trim().to_string();
    if normalized.is_empty() {
        return Err(Error::Database(
            "User table prefix requires a user id.".into(),
        ));
    }
    let mut user_prefix = normalized.replace(['-', '_'], "");
    if !user_prefix.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return Err(Error::Database(
            "User table prefix contains invalid characters.".into(),
        ));
    }
    if user_prefix
        .chars()
        .next()
        .map(|ch| ch.is_ascii_digit())
        .unwrap_or(false)
    {
        user_prefix = format!("_{user_prefix}");
    }
    ensure_user_prefix(&user_prefix)?;
    Ok(user_prefix)
}

fn ensure_user_prefix(user_prefix: &str) -> Result<(), Error> {
    let mut chars = user_prefix.chars();
    let Some(first) = chars.next() else {
        return Err(Error::Database("User table prefix is required.".into()));
    };
    if !(first.is_ascii_alphabetic() || first == '_') || !chars.all(|ch| ch.is_ascii_alphanumeric())
    {
        return Err(Error::Database(
            "User table prefix contains invalid characters.".into(),
        ));
    }
    Ok(())
}

fn realtime_table_statements(user_prefix: &str) -> Vec<String> {
    vec![
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_gps (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, location TEXT, world_name TEXT, previous_location TEXT, time INTEGER, group_name TEXT)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_feed_gps_user_created_idx ON {user_prefix}_feed_gps (user_id, created_at)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_feed_gps_location_idx ON {user_prefix}_feed_gps (location)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_feed_gps_created_id_idx ON {user_prefix}_feed_gps (created_at DESC, id DESC)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_status (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, status TEXT, status_description TEXT, previous_status TEXT, previous_status_description TEXT)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_feed_status_created_id_idx ON {user_prefix}_feed_status (created_at DESC, id DESC)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_bio (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, bio TEXT, previous_bio TEXT)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_feed_bio_created_id_idx ON {user_prefix}_feed_bio (created_at DESC, id DESC)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_avatar (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, owner_id TEXT, avatar_name TEXT, current_avatar_image_url TEXT, current_avatar_thumbnail_image_url TEXT, previous_current_avatar_image_url TEXT, previous_current_avatar_thumbnail_image_url TEXT)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_feed_avatar_created_id_idx ON {user_prefix}_feed_avatar (created_at DESC, id DESC)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_online_offline (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, type TEXT, location TEXT, world_name TEXT, time INTEGER, group_name TEXT)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_feed_online_offline_user_created_idx ON {user_prefix}_feed_online_offline (user_id, created_at)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_feed_online_offline_created_id_idx ON {user_prefix}_feed_online_offline (created_at DESC, id DESC)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_friend_log_current (user_id TEXT PRIMARY KEY, display_name TEXT, trust_level TEXT, friend_number INTEGER)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_friend_log_history (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, user_id TEXT, display_name TEXT, previous_display_name TEXT, trust_level TEXT, previous_trust_level TEXT, friend_number INTEGER)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_friend_log_history_user_id_idx ON {user_prefix}_friend_log_history (user_id)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_notifications (id TEXT PRIMARY KEY, created_at TEXT, type TEXT, sender_user_id TEXT, sender_username TEXT, receiver_user_id TEXT, message TEXT, world_id TEXT, world_name TEXT, image_url TEXT, invite_message TEXT, request_message TEXT, response_message TEXT, expired INTEGER)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_notifications_created_id_idx ON {user_prefix}_notifications (created_at DESC, id DESC)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_notifications_v2 (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, expires_at TEXT, type TEXT, link TEXT, link_text TEXT, message TEXT, title TEXT, image_url TEXT, seen INTEGER, sender_user_id TEXT, sender_username TEXT, data TEXT, responses TEXT, details TEXT)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_notifications_v2_created_id_idx ON {user_prefix}_notifications_v2 (created_at DESC, id DESC)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_notifications_v2_seen_created_id_idx ON {user_prefix}_notifications_v2 (seen, created_at DESC, id DESC)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_notifications_v2_type_created_id_idx ON {user_prefix}_notifications_v2 (type, created_at DESC, id DESC)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_avatar_history (avatar_id TEXT PRIMARY KEY, created_at TEXT, time INTEGER)"),
    ]
}
