use std::collections::BTreeMap;

use crate::common::{row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::realtime::normalize_user_table_prefix;
use crate::Error;

use super::caveats::invite_history_caveats;
use super::helpers::{append_time_window_filter, clamped_optional_limit, table_exists};
use super::types::{InviteDirection, InviteHistoryInput, InviteHistoryOutput, InviteHistoryRow};

pub fn get_invite_history(
    db: &DatabaseService,
    input: InviteHistoryInput,
) -> Result<InviteHistoryOutput, Error> {
    let user_prefix = normalize_user_table_prefix(&input.owner_user_id)?;
    let mut grouped: BTreeMap<(String, InviteDirection), InviteAccumulator> = BTreeMap::new();
    append_v1_invites(db, &input, &user_prefix, &mut grouped)?;
    append_v2_invites(db, &input, &user_prefix, &mut grouped)?;

    let limit = clamped_optional_limit(input.limit, 50, 200);
    let mut rows = grouped
        .into_values()
        .map(|entry| InviteHistoryRow {
            user_id: entry.user_id,
            display_name: entry.display_name,
            direction: entry.direction,
            total_count: entry.total_count,
            last_invite_at: entry.last_invite_at,
            types: entry.types,
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .total_count
            .cmp(&left.total_count)
            .then_with(|| right.last_invite_at.cmp(&left.last_invite_at))
            .then_with(|| left.display_name.cmp(&right.display_name))
            .then_with(|| left.user_id.cmp(&right.user_id))
    });
    rows.truncate(limit as usize);

    let summary = invite_history_summary(&rows);
    Ok(InviteHistoryOutput {
        rows,
        summary,
        caveats: invite_history_caveats(),
    })
}

fn invite_history_summary(rows: &[InviteHistoryRow]) -> String {
    if rows.is_empty() {
        return "No invites found in this window.".to_string();
    }
    let entries = rows
        .iter()
        .map(|row| format!("{} ({})", row.display_name, row.total_count))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{} people in invite history: {entries}.", rows.len())
}

fn append_v1_invites(
    db: &DatabaseService,
    input: &InviteHistoryInput,
    user_prefix: &str,
    grouped: &mut BTreeMap<(String, InviteDirection), InviteAccumulator>,
) -> Result<(), Error> {
    let table_name = format!("{user_prefix}_notifications");
    if !table_exists(db, &table_name)? {
        return Ok(());
    }
    let mut sql = format!(
        "SELECT sender_user_id, sender_username, receiver_user_id, type, created_at
         FROM {table_name}
         WHERE lower(type) LIKE '%invite%'"
    );
    let mut params = ParamsBuilder::new();
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");

    for row in db.execute(&sql, &params.build())? {
        let sender_user_id = row_string(&row, 0);
        let sender_username = row_string(&row, 1);
        let receiver_user_id = row_string(&row, 2);
        let kind = row_string(&row, 3);
        let created_at = row_string(&row, 4);
        let inferred_direction = if sender_user_id == input.owner_user_id {
            InviteDirection::Sent
        } else {
            InviteDirection::Received
        };
        if !direction_matches(&input.direction, &inferred_direction) {
            continue;
        }
        let (other_user_id, display_name) = match inferred_direction {
            InviteDirection::Sent => (receiver_user_id, String::new()),
            InviteDirection::Received | InviteDirection::Both => (sender_user_id, sender_username),
        };
        add_invite_row(
            grouped,
            other_user_id,
            display_name,
            inferred_direction,
            kind,
            created_at,
        );
    }
    Ok(())
}

fn append_v2_invites(
    db: &DatabaseService,
    input: &InviteHistoryInput,
    user_prefix: &str,
    grouped: &mut BTreeMap<(String, InviteDirection), InviteAccumulator>,
) -> Result<(), Error> {
    if matches!(input.direction, InviteDirection::Sent) {
        return Ok(());
    }
    let table_name = format!("{user_prefix}_notifications_v2");
    if !table_exists(db, &table_name)? {
        return Ok(());
    }
    let mut sql = format!(
        "SELECT sender_user_id, sender_username, type, created_at
         FROM {table_name}
         WHERE lower(type) LIKE '%invite%'"
    );
    let mut params = ParamsBuilder::new();
    append_time_window_filter(&mut sql, &mut params, &input.time_window, "created_at");

    for row in db.execute(&sql, &params.build())? {
        add_invite_row(
            grouped,
            row_string(&row, 0),
            row_string(&row, 1),
            InviteDirection::Received,
            row_string(&row, 2),
            row_string(&row, 3),
        );
    }
    Ok(())
}

fn add_invite_row(
    grouped: &mut BTreeMap<(String, InviteDirection), InviteAccumulator>,
    user_id: String,
    display_name: String,
    direction: InviteDirection,
    kind: String,
    created_at: String,
) {
    if user_id.trim().is_empty() {
        return;
    }
    let key = (user_id.clone(), direction.clone());
    let entry = grouped.entry(key).or_insert_with(|| InviteAccumulator {
        user_id,
        display_name: display_name.clone(),
        direction,
        ..InviteAccumulator::default()
    });
    if entry.display_name.is_empty() && !display_name.is_empty() {
        entry.display_name = display_name;
    }
    entry.total_count += 1;
    if created_at > entry.last_invite_at {
        entry.last_invite_at = created_at;
    }
    let kind = if kind.trim().is_empty() {
        "unknown".to_string()
    } else {
        kind
    };
    *entry.types.entry(kind).or_insert(0) += 1;
}

fn direction_matches(requested: &InviteDirection, actual: &InviteDirection) -> bool {
    matches!(requested, InviteDirection::Both) || requested == actual
}

#[derive(Clone, Debug, Default)]
struct InviteAccumulator {
    user_id: String,
    display_name: String,
    direction: InviteDirection,
    total_count: i64,
    last_invite_at: String,
    types: BTreeMap<String, i64>,
}
