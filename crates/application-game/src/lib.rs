mod activity_events;
mod background_capabilities;
mod game_client;
mod game_event_bus;
mod game_log;
mod game_log_import;
mod game_log_parser;
mod game_log_watcher;
mod ports;
mod process_monitor;
mod registry_backup;
mod worker;

use vrcx_0_application_core::{
    sleep_interruptibly, Error, HostSessionRuntime, LocalGameContextSnapshot,
    LocalGameContextSource, Result, RuntimeAuthScope, RuntimeEventBus, RuntimeSyncEngine,
    TaskSupervisor, WorldCache,
};

pub use background_capabilities::{
    build_background_discord_presence_command, build_background_presence_facts,
    presence_automation_local_group_renamed, presence_automation_rule_enabled_set,
    presence_automation_rules_get, presence_automation_rules_set,
    run_background_presence_automation, BackgroundDiscordActivityPayload,
    BackgroundDiscordPresenceCommand, BackgroundDiscordPresenceState,
    BackgroundPresenceAutomationResult, BackgroundPresenceAutomationState, BackgroundPresenceFacts,
    BackgroundPresenceFactsInput, DiscordPresenceLabels, PresenceAutomationRuleKind,
    PresencePlayer,
};
pub use game_client::{
    DebugLoggingOutcome, DebugLoggingOutcomeKind, GameClientActions, GameClientCacheActions,
    GameClientDebugLoggingActions, GameClientLocationSource, GameClientRuntime,
    GameClientRuntimeDeps, GameClientWindowActions, NoopGameClientCacheActions,
    NoopGameClientWindowActions,
};
pub use game_event_bus::{
    CrashRelaunchDecisionPayload, EmptyEventPayload, GameClientEvent,
    GameLogPersistenceFallbackPayload, GameLogSideEffectEvent, GameLogSideEffectObserver,
    GameLogSideEffectSink, GameNoVrPayload, NowPlayingPayload, NowPlayingSnapshot,
    RuntimeGameEventBusExt, RuntimeGameLogEventPayload, RuntimeNotificationLevel,
    RuntimeNotificationPayload, RuntimeWorkerErrorPayload, ScreenshotProcessedPayload,
};
pub use game_log::lifecycle::IS_GAME_NO_VR_CONFIG_KEY;
pub use game_log::{
    duration_ms, game_log_sessions_query, instance_history_query, parse_event_time_ms, player_key,
    player_list_runtime_snapshot, world_id_from_location, GameLogAvatarChange, GameLogHostActions,
    GameLogIngestEngine, GameLogIngestOptions, GameLogIngestOutput, GameLogLocalGameContextSource,
    GameLogProcessEvent, GameLogProjection, GameLogRuntime, GameLogRuntimeDeps,
    GameLogRuntimeState, GameLogSessionDto, GameLogSessionEventDto, GameLogSessionMemberDto,
    GameLogSessionPlayerDurationRowDto, GameLogSessionsQueryInput, GameLogSideEffect,
    InstanceHistoryEntryOutput, InstanceHistoryQueryInput, NoopGameLogHostActions,
    PlayerListSnapshotContext, PlayerListSnapshotOutput, PlayerListSnapshotPlayer,
    PlayerListSnapshotSource, PlayerState, RuntimeSnapshot, RuntimeSnapshotStore, ScreenshotInput,
};
pub use game_log_import::{
    import_game_log_file, inspect_game_log_import_file, GameLogImportConsent, GameLogImportFile,
    GameLogImportFileStatus,
};
pub use game_log_parser::GameLogEvent;
pub use game_log_watcher::{
    GameLogEventOrigin, GameLogEventSink, GameLogScanCursor, LogLocationSnapshot,
    LogLocationSnapshotScanner, LogWatcher, NoopLogLocationSnapshotScanner,
};
pub use ports::{
    BackgroundRemoteApi, GameStateStore, InstanceMediaPort, PlayerModeration, VideoMetadataPort,
};
pub use process_monitor::{GameProcessMonitorActions, GameProcessStatus, ProcessMonitor};
pub use registry_backup::{
    registry_backup_create, registry_backup_delete, registry_backup_foreground_followup,
    registry_backup_import_json, registry_backup_list, registry_backup_maintenance_run,
    registry_backup_prepare_export, registry_backup_restore,
    registry_backup_restore_prompt_acknowledge, RegistryBackupExport, RegistryBackupHostActions,
    RegistryBackupMaintenanceMode, RegistryBackupMaintenanceResult, RegistryBackupSnapshot,
};
pub use worker::{OverflowPolicy, RuntimeJobHandler, RuntimePushReport};
