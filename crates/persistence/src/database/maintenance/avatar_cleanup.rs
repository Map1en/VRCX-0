use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;

use crate::common::ParamsBuilder;
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

use super::super::DatabaseService;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AvatarAutoCleanupState {
    Disabled,
    NotDue,
    Ran,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarAutoCleanupOutcome {
    pub state: AvatarAutoCleanupState,
    pub retention_days: Option<i64>,
    pub removed_count: i64,
    pub cutoff: Option<String>,
    pub completed_at: Option<String>,
}

pub fn avatar_auto_cleanup_run(
    db: &DatabaseService,
    user_id: &str,
    now: DateTime<Utc>,
) -> Result<AvatarAutoCleanupOutcome, Error> {
    crate::config::ensure_config_table(db)?;
    let user_prefix = normalize_user_table_prefix(user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let cleanup_key = crate::config::resolve_config_key("VRCX_avatarAutoCleanup");
    let completed_key =
        crate::config::resolve_config_key(&format!("lastAvatarCleanupDate_{}", user_id.trim()));

    db.write_transaction(|tx| {
        let setting = tx
            .execute(
                "SELECT value FROM configs WHERE key = @key LIMIT 1",
                &ParamsBuilder::new().set("key", cleanup_key).build(),
            )?
            .first()
            .and_then(|row| row.first())
            .and_then(Value::as_str)
            .unwrap_or("Off")
            .trim()
            .to_string();
        let Some(retention_days) = setting.parse::<i64>().ok().filter(|days| *days > 0) else {
            return Ok(AvatarAutoCleanupOutcome {
                state: AvatarAutoCleanupState::Disabled,
                retention_days: None,
                removed_count: 0,
                cutoff: None,
                completed_at: None,
            });
        };

        let last_completed = tx
            .execute(
                "SELECT value FROM configs WHERE key = @key LIMIT 1",
                &ParamsBuilder::new().set("key", completed_key.clone()).build(),
            )?
            .first()
            .and_then(|row| row.first())
            .and_then(Value::as_str)
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc));
        if last_completed.is_some_and(|last| now.signed_duration_since(last) < Duration::days(7)) {
            return Ok(AvatarAutoCleanupOutcome {
                state: AvatarAutoCleanupState::NotDue,
                retention_days: Some(retention_days),
                removed_count: 0,
                cutoff: None,
                completed_at: last_completed.map(|value| value.to_rfc3339()),
            });
        }

        let cutoff = (now - Duration::days(retention_days))
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();
        let completed_at = now.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let removed_count = tx.execute_non_query(
            &format!("DELETE FROM {user_prefix}_feed_avatar WHERE created_at < @cutoff"),
            &ParamsBuilder::new().set("cutoff", cutoff.clone()).build(),
        )?;
        tx.execute_non_query(
            "INSERT INTO configs (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            &ParamsBuilder::new()
                .set("key", completed_key)
                .set("value", completed_at.clone())
                .build(),
        )?;
        Ok(AvatarAutoCleanupOutcome {
            state: AvatarAutoCleanupState::Ran,
            retention_days: Some(retention_days),
            removed_count,
            cutoff: Some(cutoff),
            completed_at: Some(completed_at),
        })
    })
}
