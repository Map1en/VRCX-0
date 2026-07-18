use chrono::DateTime;
use serde_json::Value;

use crate::common::{row_string, ParamsBuilder};
use crate::game_log::ensure_game_log_tables;
use crate::Error;

use super::super::DatabaseService;

const MAX_COPRESENCE_DURATION_MS: i64 = 24 * 60 * 60 * 1000;
const REPAIR_CHUNK_SIZE: usize = 5000;

pub(super) fn repair_zero_copresence_durations(db: &DatabaseService) -> Result<(), Error> {
    ensure_game_log_tables(db)?;
    let zero_leaves = db.execute(
        "SELECT id, created_at, location, user_id, display_name FROM gamelog_join_leave WHERE type = 'OnPlayerLeft' AND time = 0 AND location LIKE 'wrld_%'",
        &Default::default(),
    )?;
    for chunk in zero_leaves.chunks(REPAIR_CHUNK_SIZE) {
        db.write_transaction(|tx| {
            for row in chunk {
                let id = row.first().cloned().unwrap_or(Value::Null);
                let leave_at = row_string(row, 1);
                let location = row_string(row, 2);
                let user_id = row_string(row, 3);
                let display_name = row_string(row, 4);
                let join_rows = tx.execute(
                    "SELECT created_at FROM gamelog_join_leave
                     WHERE type = 'OnPlayerJoined' AND location = @location AND created_at <= @created_at
                       AND ((@user_id <> '' AND user_id = @user_id)
                            OR (@user_id = '' AND display_name = @display_name))
                     ORDER BY created_at DESC, id DESC LIMIT 1",
                    &ParamsBuilder::new()
                        .set("location", location)
                        .set("created_at", leave_at.clone())
                        .set("user_id", user_id)
                        .set("display_name", display_name)
                        .build(),
                )?;
                let Some(join_at) = join_rows
                    .first()
                    .map(|join| row_string(join, 0))
                    .filter(|value| !value.is_empty())
                else {
                    continue;
                };
                let (Some(join_ms), Some(leave_ms)) = (rfc3339_ms(&join_at), rfc3339_ms(&leave_at))
                else {
                    continue;
                };
                let duration = leave_ms - join_ms;
                if duration <= 0 || duration > MAX_COPRESENCE_DURATION_MS {
                    continue;
                }
                tx.execute_non_query(
                    "UPDATE gamelog_join_leave SET time = @time WHERE id = @id",
                    &ParamsBuilder::new()
                        .set("time", duration)
                        .set("id", id)
                        .build(),
                )?;
            }
            Ok(())
        })?;
    }
    Ok(())
}

fn rfc3339_ms(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}
