use serde::{Deserialize, Serialize};

use crate::game_log::{GameLogPreviousInstanceGroupOutput, GameLogPreviousInstanceWorldOutput};

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(tag = "kind", content = "params", rename_all = "camelCase")]
pub enum GameLogQuery {
    #[serde(rename_all = "camelCase")]
    RecentDatabase {
        #[serde(default)]
        date_offset: String,
        #[serde(default)]
        max_table_size: Option<i64>,
    },
    #[serde(rename_all = "camelCase")]
    RowsByLocation {
        #[serde(default)]
        instance_id: String,
        #[serde(default)]
        current_user_id: String,
        #[serde(default)]
        filters: Vec<String>,
        #[serde(default)]
        vip_list: Vec<String>,
        #[serde(default)]
        max_entries: Option<i64>,
        #[serde(default)]
        max_rows: Option<i64>,
    },
    #[serde(rename_all = "camelCase")]
    LookupRows {
        #[serde(default)]
        filters: Vec<String>,
        #[serde(default)]
        vip_list: Vec<String>,
        #[serde(default)]
        max_entries: Option<i64>,
        #[serde(default)]
        max_rows: Option<i64>,
    },
    #[serde(rename_all = "camelCase")]
    SearchRows {
        #[serde(default)]
        search: String,
        #[serde(default)]
        current_user_id: String,
        #[serde(default)]
        filters: Vec<String>,
        #[serde(default)]
        vip_list: Vec<String>,
        #[serde(default)]
        max_entries: Option<i64>,
        #[serde(default)]
        max_rows: Option<i64>,
    },
    #[serde(rename_all = "camelCase")]
    LastVisit {
        #[serde(default)]
        world_id: String,
        #[serde(default)]
        current_world_match: bool,
    },
    #[serde(rename_all = "camelCase")]
    VisitCount {
        #[serde(default)]
        world_id: String,
    },
    #[serde(rename_all = "camelCase")]
    TimeSpentInWorld {
        #[serde(default)]
        world_id: String,
    },
    #[serde(rename_all = "camelCase")]
    LastGroupVisit {
        #[serde(default)]
        group_id: String,
    },
    #[serde(rename_all = "camelCase")]
    LastSeen {
        #[serde(default)]
        user_id: String,
        #[serde(default)]
        display_name: String,
        #[serde(default)]
        in_current_world: bool,
    },
    #[serde(rename_all = "camelCase")]
    JoinCount {
        #[serde(default)]
        user_id: String,
        #[serde(default)]
        display_name: String,
    },
    #[serde(rename_all = "camelCase")]
    TimeSpent {
        #[serde(default)]
        user_id: String,
        #[serde(default)]
        display_name: String,
    },
    #[serde(rename_all = "camelCase")]
    UserStats {
        #[serde(default)]
        user_id: String,
        #[serde(default)]
        display_name: String,
        #[serde(default)]
        in_current_world: bool,
    },
    #[serde(rename_all = "camelCase")]
    AllUserStats {
        #[serde(default)]
        user_ids: Vec<String>,
        #[serde(default)]
        display_names: Vec<String>,
    },
    LastDate {},
    #[serde(rename_all = "camelCase")]
    PlayersFromInstanceRows {
        #[serde(default)]
        location: String,
    },
    #[serde(rename_all = "camelCase")]
    LocationBeforeOrAt {
        #[serde(default)]
        created_at: String,
    },
    #[serde(rename_all = "camelCase")]
    JoinLeaveRange {
        #[serde(default)]
        location: String,
        #[serde(default)]
        after_date: String,
        #[serde(default)]
        before_date: String,
    },
    #[serde(rename_all = "camelCase")]
    PlayerDetailFromInstance {
        #[serde(default)]
        location: String,
    },
    #[serde(rename_all = "camelCase")]
    PreviousDisplayNamesByUserId {
        #[serde(default)]
        user_id: String,
    },
    InstanceTimes {},
    #[serde(rename_all = "camelCase")]
    OnlineSessions {
        #[serde(default)]
        from_date: String,
        #[serde(default)]
        to_date: String,
    },
    #[serde(rename_all = "camelCase")]
    OnlineSessionsAfter {
        #[serde(default)]
        after_created_at: String,
        #[serde(default)]
        inclusive: bool,
    },
    #[serde(rename_all = "camelCase")]
    InstanceJoinHistory {
        #[serde(default)]
        user_id: String,
        #[serde(default)]
        created_at: String,
    },
    #[serde(rename_all = "camelCase")]
    WorldNameByWorldId {
        #[serde(default)]
        world_id: String,
    },
    #[serde(rename_all = "camelCase")]
    UserIdFromDisplayName {
        #[serde(default)]
        display_name: String,
    },
    #[serde(rename_all = "camelCase")]
    PreviousInstancesByGroupId {
        #[serde(default)]
        group_id: String,
    },
    #[serde(rename_all = "camelCase")]
    PreviousInstancesByWorldId {
        #[serde(default)]
        world_id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum GameLogQueryOutput {
    RecentDatabase(Vec<GameLogRowOutput>),
    RowsByLocation(Vec<GameLogRowOutput>),
    LookupRows(Vec<GameLogRowOutput>),
    SearchRows(Vec<GameLogRowOutput>),
    LastVisit(GameLogLastVisitOutput),
    VisitCount(GameLogVisitCountOutput),
    TimeSpentInWorld(GameLogWorldTimeSpentOutput),
    LastGroupVisit(GameLogLastGroupVisitOutput),
    LastSeen(GameLogLastSeenOutput),
    JoinCount(GameLogJoinCountOutput),
    TimeSpent(GameLogUserTimeSpentOutput),
    UserStats(GameLogUserStatsOutput),
    AllUserStats(Vec<GameLogAllUserStatsOutput>),
    LastDate(String),
    PlayersFromInstanceRows(Vec<GameLogInstancePlayerEventOutput>),
    LocationBeforeOrAt(Option<GameLogLocationBeforeOutput>),
    JoinLeaveRange(Vec<GameLogJoinLeaveRangeOutput>),
    PlayerDetailFromInstance(Vec<GameLogPlayerDetailOutput>),
    PreviousDisplayNamesByUserId(Vec<GameLogPreviousDisplayNameOutput>),
    InstanceTimes(Vec<GameLogInstanceTimeOutput>),
    OnlineSessions(Vec<GameLogOnlineSessionOutput>),
    OnlineSessionsAfter(Vec<GameLogOnlineSessionOutput>),
    InstanceJoinHistory(Vec<GameLogInstanceJoinOutput>),
    WorldNameByWorldId(String),
    UserIdFromDisplayName(String),
    PreviousInstancesByGroupId(Vec<GameLogPreviousInstanceGroupOutput>),
    PreviousInstancesByWorldId(Vec<GameLogPreviousInstanceWorldOutput>),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogRowOutput {
    pub row_id: i64,
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogLastVisitOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub world_id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogVisitCountOutput {
    pub visit_count: i64,
    pub world_id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogWorldTimeSpentOutput {
    pub time_spent: i64,
    pub world_id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogLastGroupVisitOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogLastSeenOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub user_id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogJoinCountOutput {
    pub join_count: i64,
    pub user_id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogUserTimeSpentOutput {
    pub time_spent: i64,
    pub user_id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogPreviousDisplayNameOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub display_name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogUserStatsOutput {
    pub time_spent: i64,
    pub last_seen: String,
    pub join_count: i64,
    pub user_id: String,
    pub previous_display_names: Vec<GameLogPreviousDisplayNameOutput>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogAllUserStatsOutput {
    pub last_seen: String,
    pub user_id: String,
    pub time_spent: i64,
    pub join_count: i64,
    pub display_name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogInstancePlayerEventOutput {
    pub row_id: i64,
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub display_name: String,
    pub user_id: String,
    pub time: i64,
    pub r#type: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogLocationBeforeOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub group_name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogJoinLeaveRangeOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub r#type: String,
    pub display_name: String,
    pub user_id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
pub struct GameLogPlayerDetailOutput {
    pub created_at: String,
    pub display_name: String,
    pub user_id: String,
    pub time: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogInstanceTimeOutput {
    pub location: String,
    pub time: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogOnlineSessionOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub time: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogInstanceJoinOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub location: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn query_wire_shape_is_kind_plus_params_with_defaulted_fields() {
        let query: GameLogQuery = serde_json::from_value(json!({
            "kind": "rowsByLocation",
            "params": { "instanceId": "wrld_a:1", "filters": ["Location"] }
        }))
        .unwrap();

        let GameLogQuery::RowsByLocation {
            instance_id,
            current_user_id,
            filters,
            vip_list,
            max_entries,
            max_rows,
        } = query
        else {
            panic!("rowsByLocation should deserialize into RowsByLocation");
        };
        assert_eq!(instance_id, "wrld_a:1");
        assert_eq!(filters, vec!["Location".to_string()]);
        assert!(current_user_id.is_empty());
        assert!(vip_list.is_empty());
        assert_eq!(max_entries, None);
        assert_eq!(max_rows, None);
    }

    #[test]
    fn unit_queries_accept_empty_params() {
        let query: GameLogQuery =
            serde_json::from_value(json!({ "kind": "lastDate", "params": {} })).unwrap();
        assert!(matches!(query, GameLogQuery::LastDate {}));
    }

    #[test]
    fn output_wire_shape_is_kind_plus_value_and_keeps_snake_case_created_at() {
        let output = GameLogQueryOutput::RowsByLocation(vec![GameLogRowOutput {
            row_id: 7,
            created_at: "2026-05-14T08:00:00Z".into(),
            r#type: "Location".into(),
            world_id: Some("wrld_a".into()),
            ..Default::default()
        }]);

        assert_eq!(
            serde_json::to_value(output).unwrap(),
            json!({
                "kind": "rowsByLocation",
                "value": [{
                    "rowId": 7,
                    "created_at": "2026-05-14T08:00:00Z",
                    "type": "Location",
                    "worldId": "wrld_a"
                }]
            })
        );
    }
}
