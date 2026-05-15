use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::common::ParamsBuilder;
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::Error;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogUpsert {
    pub target_user_id: String,
    pub display_name: String,
    pub trust_level: String,
    pub friend_number: i64,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogDelete {
    pub target_user_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimePersistenceBatch {
    #[serde(default)]
    pub friend_log_upserts: Vec<FriendLogUpsert>,
    #[serde(default)]
    pub friend_log_deletes: Vec<FriendLogDelete>,
    #[serde(default)]
    pub feed_entries: Vec<Value>,
}

impl RealtimePersistenceBatch {
    pub fn is_empty(&self) -> bool {
        self.friend_log_upserts.is_empty()
            && self.friend_log_deletes.is_empty()
            && self.feed_entries.is_empty()
    }
}

#[derive(Clone, Debug, Default)]
struct ExistingFriendLogRow {
    user_id: String,
    display_name: String,
    trust_level: String,
    friend_number: i64,
}

pub fn write_realtime_batch(
    db: &DatabaseService,
    owner_user_id: &str,
    batch: &RealtimePersistenceBatch,
) -> Result<(), Error> {
    if batch.is_empty() {
        return Ok(());
    }

    let owner_user_id = normalize_user_id(owner_user_id);
    if owner_user_id.is_empty() {
        return Err(Error::Database(
            "Realtime persistence requires a current user id.".into(),
        ));
    }
    let user_prefix = normalize_user_table_prefix(&owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    db.write_transaction(|tx| {
        for entry in &batch.friend_log_upserts {
            upsert_friend_log_current(tx, &user_prefix, entry)?;
        }
        for entry in &batch.friend_log_deletes {
            delete_friend_log_current(tx, &user_prefix, entry)?;
        }
        for entry in &batch.feed_entries {
            insert_feed_entry(tx, &user_prefix, entry)?;
        }
        Ok(())
    })
}

pub fn ensure_realtime_tables(db: &DatabaseService, user_prefix: &str) -> Result<(), Error> {
    ensure_user_prefix(user_prefix)?;
    for sql in realtime_table_statements(user_prefix) {
        db.execute_non_query(&sql, &Default::default())?;
    }
    Ok(())
}

fn upsert_friend_log_current(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &FriendLogUpsert,
) -> Result<(), Error> {
    let target_user_id = normalize_user_id(&entry.target_user_id);
    if target_user_id.is_empty() {
        return Ok(());
    }
    let existing_rows = tx.execute(
        &format!(
            "SELECT user_id, display_name, trust_level, friend_number FROM {user_prefix}_friend_log_current WHERE user_id = @user_id LIMIT 1"
        ),
        &ParamsBuilder::new().set("user_id", target_user_id.clone()).build(),
    )?;
    let existing = existing_rows.first().map(existing_friend_log_row);
    let friend_number = if entry.friend_number > 0 {
        entry.friend_number
    } else if let Some(existing) = existing.as_ref() {
        existing.friend_number
    } else {
        next_friend_number(tx, user_prefix)?
    };
    let display_name = first_non_empty([entry.display_name.as_str(), &target_user_id]);
    let trust_level = first_non_empty([entry.trust_level.as_str(), "Visitor"]);
    let insert_count = tx.execute_non_query(
        &format!(
            "INSERT OR IGNORE INTO {user_prefix}_friend_log_current (user_id, display_name, trust_level, friend_number) VALUES (@user_id, @display_name, @trust_level, @friend_number)"
        ),
        &ParamsBuilder::new()
            .set("user_id", target_user_id.clone())
            .set("display_name", display_name)
            .set("trust_level", trust_level)
            .set("friend_number", friend_number)
            .build(),
    )?;
    if insert_count <= 0 {
        tx.execute_non_query(
            &format!(
                "UPDATE {user_prefix}_friend_log_current SET display_name = @display_name, trust_level = @trust_level, friend_number = CASE WHEN @friend_number > 0 THEN @friend_number ELSE friend_number END WHERE user_id = @user_id"
            ),
            &ParamsBuilder::new()
                .set("user_id", target_user_id.clone())
                .set("display_name", display_name)
                .set("trust_level", trust_level)
                .set("friend_number", friend_number)
                .build(),
        )?;
    } else {
        add_friend_log_history(
            tx,
            user_prefix,
            &entry.created_at,
            "Friend",
            &target_user_id,
            display_name,
            "",
            trust_level,
            "",
            friend_number,
        )?;
    }
    Ok(())
}

fn delete_friend_log_current(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &FriendLogDelete,
) -> Result<(), Error> {
    let target_user_id = normalize_user_id(&entry.target_user_id);
    if target_user_id.is_empty() {
        return Ok(());
    }
    let existing_rows = tx.execute(
        &format!(
            "SELECT user_id, display_name, trust_level, friend_number FROM {user_prefix}_friend_log_current WHERE user_id = @user_id LIMIT 1"
        ),
        &ParamsBuilder::new().set("user_id", target_user_id.clone()).build(),
    )?;
    let Some(existing) = existing_rows.first().map(existing_friend_log_row) else {
        return Ok(());
    };
    let deleted = tx.execute_non_query(
        &format!("DELETE FROM {user_prefix}_friend_log_current WHERE user_id = @user_id"),
        &ParamsBuilder::new().set("user_id", target_user_id).build(),
    )?;
    if deleted > 0 {
        add_friend_log_history(
            tx,
            user_prefix,
            &entry.created_at,
            "Unfriend",
            &existing.user_id,
            &existing.display_name,
            "",
            &existing.trust_level,
            "",
            existing.friend_number,
        )?;
    }
    Ok(())
}

fn add_friend_log_history(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    created_at: &str,
    entry_type: &str,
    user_id: &str,
    display_name: &str,
    previous_display_name: &str,
    trust_level: &str,
    previous_trust_level: &str,
    friend_number: i64,
) -> Result<(), Error> {
    tx.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_friend_log_history (created_at, type, user_id, display_name, previous_display_name, trust_level, previous_trust_level, friend_number) VALUES (@created_at, @type, @user_id, @display_name, @previous_display_name, @trust_level, @previous_trust_level, @friend_number)"
        ),
        &ParamsBuilder::new()
            .set("created_at", created_at)
            .set("type", entry_type)
            .set("user_id", user_id)
            .set("display_name", display_name)
            .set("previous_display_name", previous_display_name)
            .set("trust_level", trust_level)
            .set("previous_trust_level", previous_trust_level)
            .set("friend_number", friend_number)
            .build(),
    )?;
    Ok(())
}

fn insert_feed_entry(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    entry: &Value,
) -> Result<(), Error> {
    let entry_type = entry_string(entry, "type");
    match entry_type.as_str() {
        "GPS" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_gps (created_at, user_id, display_name, location, world_name, previous_location, time, group_name) VALUES (@created_at, @user_id, @display_name, @location, @world_name, @previous_location, @time, @group_name)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("location", entry_string(entry, "location"))
                .set("world_name", entry_string(entry, "worldName"))
                .set("previous_location", entry_string(entry, "previousLocation"))
                .set("time", entry_i64(entry, "time"))
                .set("group_name", entry_string(entry, "groupName"))
                .build(),
        )?,
        "Online" | "Offline" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_online_offline (created_at, user_id, display_name, type, location, world_name, time, group_name) VALUES (@created_at, @user_id, @display_name, @type, @location, @world_name, @time, @group_name)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("type", entry_type)
                .set("location", entry_string(entry, "location"))
                .set("world_name", entry_string(entry, "worldName"))
                .set("time", entry_i64(entry, "time"))
                .set("group_name", entry_string(entry, "groupName"))
                .build(),
        )?,
        "Status" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_status (created_at, user_id, display_name, status, status_description, previous_status, previous_status_description) VALUES (@created_at, @user_id, @display_name, @status, @status_description, @previous_status, @previous_status_description)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("status", entry_string(entry, "status"))
                .set("status_description", entry_string(entry, "statusDescription"))
                .set("previous_status", entry_string(entry, "previousStatus"))
                .set("previous_status_description", entry_string(entry, "previousStatusDescription"))
                .build(),
        )?,
        "Bio" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_bio (created_at, user_id, display_name, bio, previous_bio) VALUES (@created_at, @user_id, @display_name, @bio, @previous_bio)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("bio", entry_string(entry, "bio"))
                .set("previous_bio", entry_string(entry, "previousBio"))
                .build(),
        )?,
        "Avatar" => tx.execute_non_query(
            &format!("INSERT OR IGNORE INTO {user_prefix}_feed_avatar (created_at, user_id, display_name, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url) VALUES (@created_at, @user_id, @display_name, @owner_id, @avatar_name, @current_avatar_image_url, @current_avatar_thumbnail_image_url, @previous_current_avatar_image_url, @previous_current_avatar_thumbnail_image_url)"),
            &ParamsBuilder::new()
                .set("created_at", entry_string(entry, "created_at"))
                .set("user_id", entry_string(entry, "userId"))
                .set("display_name", entry_string(entry, "displayName"))
                .set("owner_id", entry_string(entry, "ownerId"))
                .set("avatar_name", entry_string(entry, "avatarName"))
                .set("current_avatar_image_url", entry_string(entry, "currentAvatarImageUrl"))
                .set("current_avatar_thumbnail_image_url", entry_string(entry, "currentAvatarThumbnailImageUrl"))
                .set("previous_current_avatar_image_url", entry_string(entry, "previousCurrentAvatarImageUrl"))
                .set("previous_current_avatar_thumbnail_image_url", entry_string(entry, "previousCurrentAvatarThumbnailImageUrl"))
                .build(),
        )?,
        _ => 0,
    };
    Ok(())
}

fn next_friend_number(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
) -> Result<i64, Error> {
    let rows = tx.execute(
        &format!("SELECT MAX(friend_number), COUNT(*) FROM {user_prefix}_friend_log_current"),
        &Default::default(),
    )?;
    let max_number = rows
        .first()
        .and_then(|row| row.first())
        .and_then(value_to_i64)
        .unwrap_or(0);
    let count = rows
        .first()
        .and_then(|row| row.get(1))
        .and_then(value_to_i64)
        .unwrap_or(0);
    Ok(if max_number > 0 {
        max_number + 1
    } else {
        count + 1
    })
}

fn existing_friend_log_row(row: &Vec<Value>) -> ExistingFriendLogRow {
    ExistingFriendLogRow {
        user_id: row.first().and_then(Value::as_str).unwrap_or("").to_string(),
        display_name: row.get(1).and_then(Value::as_str).unwrap_or("").to_string(),
        trust_level: row
            .get(2)
            .and_then(Value::as_str)
            .unwrap_or("Visitor")
            .to_string(),
        friend_number: row.get(3).and_then(value_to_i64).unwrap_or(0),
    }
}

fn realtime_table_statements(user_prefix: &str) -> Vec<String> {
    vec![
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_gps (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, location TEXT, world_name TEXT, previous_location TEXT, time INTEGER, group_name TEXT)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_status (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, status TEXT, status_description TEXT, previous_status TEXT, previous_status_description TEXT)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_bio (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, bio TEXT, previous_bio TEXT)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_avatar (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, owner_id TEXT, avatar_name TEXT, current_avatar_image_url TEXT, current_avatar_thumbnail_image_url TEXT, previous_current_avatar_image_url TEXT, previous_current_avatar_thumbnail_image_url TEXT)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_feed_online_offline (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, type TEXT, location TEXT, world_name TEXT, time INTEGER, group_name TEXT)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_feed_online_offline_user_created_idx ON {user_prefix}_feed_online_offline (user_id, created_at)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_friend_log_current (user_id TEXT PRIMARY KEY, display_name TEXT, trust_level TEXT, friend_number INTEGER)"),
        format!("CREATE TABLE IF NOT EXISTS {user_prefix}_friend_log_history (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, user_id TEXT, display_name TEXT, previous_display_name TEXT, trust_level TEXT, previous_trust_level TEXT, friend_number INTEGER)"),
        format!("CREATE INDEX IF NOT EXISTS {user_prefix}_friend_log_history_user_id_idx ON {user_prefix}_friend_log_history (user_id)"),
    ]
}

pub fn normalize_user_table_prefix(user_id: &str) -> Result<String, Error> {
    let normalized = normalize_user_id(user_id);
    if normalized.is_empty() {
        return Err(Error::Database("User table prefix requires a user id.".into()));
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
    if !(first.is_ascii_alphabetic() || first == '_')
        || !chars.all(|ch| ch.is_ascii_alphanumeric())
    {
        return Err(Error::Database(
            "User table prefix contains invalid characters.".into(),
        ));
    }
    Ok(())
}

fn normalize_user_id(value: &str) -> String {
    value.trim().to_string()
}

fn entry_string(entry: &Value, key: &str) -> String {
    entry
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            entry
                .get(key)
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
        })
}

fn entry_i64(entry: &Value, key: &str) -> i64 {
    entry.get(key).and_then(value_to_i64).unwrap_or(0)
}

fn value_to_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| {
            value
                .as_str()
                .and_then(|value| value.trim().parse::<i64>().ok())
        })
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> &'a str {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use crate::common::ParamsBuilder;
    use crate::database::DatabaseService;

    use super::{
        normalize_user_table_prefix, write_realtime_batch, FriendLogUpsert,
        RealtimePersistenceBatch,
    };

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn normalizes_user_table_prefix_like_frontend() {
        assert_eq!(
            normalize_user_table_prefix("usr_123-abc").unwrap(),
            "usr123abc"
        );
        assert_eq!(normalize_user_table_prefix("123").unwrap(), "_123");
    }

    #[test]
    fn writes_friend_log_and_feed_rows() -> Result<(), crate::Error> {
        let dir = TestDir::new("realtime-persistence");
        let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
        write_realtime_batch(
            &db,
            "usr_self",
            &RealtimePersistenceBatch {
                friend_log_upserts: vec![FriendLogUpsert {
                    target_user_id: "usr_friend".into(),
                    display_name: "Friend".into(),
                    trust_level: "Known".into(),
                    friend_number: 12,
                    created_at: "2026-05-15T00:00:00Z".into(),
                }],
                feed_entries: vec![json!({
                    "created_at": "2026-05-15T00:00:00Z",
                    "type": "Online",
                    "userId": "usr_friend",
                    "displayName": "Friend",
                    "location": "wrld_1:123",
                    "worldName": "wrld_1",
                    "time": 0,
                    "groupName": ""
                })],
                ..RealtimePersistenceBatch::default()
            },
        )?;

        let current = db.execute(
            "SELECT user_id, display_name, trust_level, friend_number FROM usrself_friend_log_current WHERE user_id = @user_id",
            &ParamsBuilder::new().set("user_id", "usr_friend").build(),
        )?;
        assert_eq!(current[0][1], json!("Friend"));
        assert_eq!(current[0][3], json!(12));
        let feed = db.execute(
            "SELECT user_id, type, location FROM usrself_feed_online_offline WHERE user_id = @user_id",
            &ParamsBuilder::new().set("user_id", "usr_friend").build(),
        )?;
        assert_eq!(feed[0][1], json!("Online"));
        assert_eq!(feed[0][2], json!("wrld_1:123"));
        Ok(())
    }
}
