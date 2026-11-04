mod instance_history;
mod legacy_ownership;
mod local_queries;
mod query;
mod schema;
mod tables;
mod types;
mod write;

pub use instance_history::previous_instance_event_rows_query;
pub(crate) use legacy_ownership::claim_legacy_ownership;
pub use local_queries::{
    game_log_entries_add, game_log_entry_delete, game_log_instance_delete,
    game_log_instance_delete_by_location, game_log_query,
};
pub use query::{
    game_log_location_table_exists, get_game_log_events, get_game_log_externals,
    get_game_log_join_leave, get_game_log_locations, get_join_leave_entries_for_location_range,
    get_join_leave_entries_for_location_range_unscoped, get_last_game_log_date,
    get_last_game_log_location, get_location_before_or_at, get_previous_instances_by_group_id,
    get_previous_instances_by_world_id, get_session_events_for_range,
    get_session_location_segments, get_session_location_segments_by_date_range,
    get_session_player_duration_rows, get_user_id_from_display_name, get_visit_span_at,
};
pub use tables::ensure_game_log_tables;
pub use types::{
    GameLogEntryDeleteKind, GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry,
    GameLogJoinLeaveSnapshot, GameLogLocationEntry, GameLogLocationTimeUpdate,
    GameLogPortalSpawnEntry, GameLogPreviousInstanceGroupOutput,
    GameLogPreviousInstanceWorldOutput, GameLogResourceLoadEntry, GameLogVideoPlayEntry,
    GameLogVisitSpan, GameLogWriteBatch, GameLogWriteKind, PreviousInstanceEventRow,
    SessionEventRow, SessionLocationSegmentRow, SessionPlayerDurationRow,
};
pub use vrcx_0_contracts::game_log_query::{
    GameLogAllUserStatsOutput, GameLogQuery, GameLogQueryOutput, GameLogRowOutput,
};
pub use write::{fill_location_group_name, write_batch};
