#![allow(non_snake_case)]

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::common::{
    add_list_params, normalize_text, object_field, object_field_string, query_param_bool,
    query_param_i64, query_param_string, query_param_string_array, row_i64, row_json, row_string,
    strict_row_json, strict_row_string, value_as_i64, ParamsBuilder,
};
use crate::database::DatabaseService;
use crate::ownership::owner_id_for_filter;
use crate::Error;

use super::{
    ensure_game_log_tables, write_batch as write_game_log_batch, GameLogEventEntry,
    GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogLocationTimeUpdate,
    GameLogPortalSpawnEntry, GameLogQueryInput, GameLogResourceLoadEntry, GameLogVideoPlayEntry,
    GameLogWriteBatch,
};

mod mutations;
mod query;
mod rows;
mod sql;

#[cfg(test)]
mod aggregate_stats_tests;
#[cfg(test)]
mod recent_lookup_tests;
#[cfg(test)]
mod test_support;

use rows::{
    game_log_base_columns, game_log_batch_for_kind, game_log_filter_flags,
    game_log_row_from_unified_row,
};
use sql::{
    append_i64_in_params, game_log_event_union_select, game_log_external_union_select,
    game_log_join_leave_union_select, game_log_location_union_select,
    game_log_portal_spawn_union_select, game_log_recent_select_sql,
    game_log_resource_load_union_select, game_log_video_play_union_select,
    GAME_LOG_RECENT_DESCRIPTORS,
};

fn scoped_params(owner_id: i64) -> ParamsBuilder {
    ParamsBuilder::new().set("owner_id", owner_id)
}

fn scoped_param_map(owner_id: i64) -> HashMap<String, Value> {
    HashMap::from([("@owner_id".into(), Value::from(owner_id))])
}

pub use mutations::{
    game_log_entries_add, game_log_entry_delete, game_log_instance_delete,
    game_log_instance_delete_by_location,
};
pub use query::game_log_query;
