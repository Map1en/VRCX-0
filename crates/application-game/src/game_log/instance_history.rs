use serde::{Deserialize, Serialize};
use vrcx_0_application_core::Result;
use vrcx_0_contracts::game_log::PreviousInstanceEventRow;
use vrcx_0_core::OwnerId;

const INSTANCE_HISTORY_GROUPING_TOLERANCE_MS: i64 = 3_600_000;
const INSTANCE_HISTORY_LIMIT_MAX: u32 = 1_000;

#[derive(Clone, Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceHistoryQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub limit: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceHistoryEntryOutput {
    pub created_at: String,
    pub location: String,
    pub time: i64,
    pub world_name: String,
    pub group_name: String,
    pub events: Vec<i64>,
    pub last_ts: i64,
}

pub fn instance_history_query(
    store: &dyn crate::InstanceHistoryQueries,
    owner_user_id: &OwnerId,
    input: InstanceHistoryQueryInput,
) -> Result<Vec<InstanceHistoryEntryOutput>> {
    let limit = input.limit.min(INSTANCE_HISTORY_LIMIT_MAX) as usize;
    let rows = store.previous_instance_events(
        owner_user_id,
        &input.user_id,
        &input.date_from,
        &input.date_to,
        limit,
    )?;
    Ok(group_previous_instance_events(rows))
}

fn group_previous_instance_events(
    rows: Vec<PreviousInstanceEventRow>,
) -> Vec<InstanceHistoryEntryOutput> {
    let mut groups: Vec<InstanceHistoryEntryOutput> = Vec::new();
    let mut previous_event_type = String::new();

    for row in rows {
        let starts_new_group = groups.last().is_none_or(|current| {
            current.location != row.location
                || (row.created_at_ts - current.last_ts > INSTANCE_HISTORY_GROUPING_TOLERANCE_MS
                    && !(previous_event_type == "OnPlayerJoined"
                        && row.event_type == "OnPlayerLeft"))
        });

        if starts_new_group {
            groups.push(InstanceHistoryEntryOutput {
                created_at: row.created_at,
                location: row.location,
                time: row.time,
                world_name: row.world_name,
                group_name: row.group_name,
                events: vec![row.event_id],
                last_ts: row.created_at_ts,
            });
        } else if let Some(current) = groups.last_mut() {
            current.time += row.time;
            current.last_ts = row.created_at_ts;
            current.events.push(row.event_id);
        }

        previous_event_type = row.event_type;
    }

    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(
        event_id: i64,
        created_at_ts: i64,
        location: &str,
        event_type: &str,
        time: i64,
    ) -> PreviousInstanceEventRow {
        PreviousInstanceEventRow {
            created_at: format!("2026-07-01T00:00:{event_id:02}Z"),
            created_at_ts,
            location: location.into(),
            time,
            world_name: "World".into(),
            group_name: String::new(),
            event_id,
            event_type: event_type.into(),
        }
    }

    #[test]
    fn groups_events_with_the_existing_join_leave_tolerance_contract() {
        let rows = vec![
            event(1, 0, "wrld_a:1", "OnPlayerJoined", 0),
            event(
                2,
                INSTANCE_HISTORY_GROUPING_TOLERANCE_MS + 1,
                "wrld_a:1",
                "OnPlayerLeft",
                10,
            ),
            event(
                3,
                INSTANCE_HISTORY_GROUPING_TOLERANCE_MS * 2 + 2,
                "wrld_a:1",
                "OnPlayerJoined",
                0,
            ),
            event(
                4,
                INSTANCE_HISTORY_GROUPING_TOLERANCE_MS * 2 + 3,
                "wrld_b:1",
                "OnPlayerLeft",
                20,
            ),
        ];

        let groups = group_previous_instance_events(rows);

        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].events, vec![1, 2]);
        assert_eq!(groups[0].time, 10);
        assert_eq!(groups[1].events, vec![3]);
        assert_eq!(groups[2].events, vec![4]);
    }
}
