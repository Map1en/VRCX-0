mod auth_credentials;
mod auth_scope;
mod backend_runtime;
mod background;
mod background_capabilities;
mod config;
mod diagnostics;
mod error;
mod event_bus;
mod game_client;
mod game_log;
pub mod groups;
mod image_cache;
mod interruptible_sleep;
mod local_favorites;
mod log_watcher;
mod media_upload;
mod moderation_sync;
mod mutual_graph_fetch;
mod noninteractive_auth;
mod overlay_activity;
mod process_monitor;
mod proxy;
mod realtime;
mod registry_backup;
mod runtime_lifecycle;
mod runtime_output;
mod screenshots;
mod session;
mod social_baseline;
mod sync;
mod task_supervisor;
pub mod vrchat_api;
mod web_client;
mod worker;
mod world_cache;
mod world_enrich;

pub mod ports {
    pub use crate::event_bus::{RuntimeEventBus, RuntimeEventSink};
    pub use crate::game_log::GameLogHostActions;
    pub use crate::process_monitor::{
        GameProcessEventSink, GameProcessMonitorActions, GameProcessStatus,
    };
    pub use crate::task_supervisor::{
        RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, TaskStopToken, TaskSupervisor,
    };
}

pub use auth_credentials::{
    delete_saved_credential, record_login_success, record_logout, saved_credential_login_start,
    saved_snapshot, LoginSuccessRecordInput, LogoutRecordInput, SavedCredentialLoginStartInput,
};
pub use auth_scope::{RuntimeAuthScope, RuntimeAuthScopeSnapshot};
pub use backend_runtime::{
    BackendRuntime, BackendRuntimeMode, BackendRuntimePhase, BackendRuntimeSnapshot,
    BackendRuntimeTelemetry,
};
pub use background::{RuntimeBackgroundJobSnapshot, RuntimeBackgroundJobs};
pub use background_capabilities::{
    build_background_discord_presence_command, build_background_presence_facts,
    refresh_background_current_user, refresh_background_group_instances,
    run_background_presence_automation, BackgroundCapabilitySession,
    BackgroundDiscordActivityPayload, BackgroundDiscordPresenceCommand,
    BackgroundDiscordPresenceState, BackgroundGroupInstancesRefresh,
    BackgroundPresenceAutomationResult, BackgroundPresenceAutomationState, BackgroundPresenceFacts,
    BackgroundPresenceFactsInput, PresencePlayer,
};
pub use config::validate_config_writes;
pub use diagnostics::{RuntimeDiagnostics, RuntimeDiagnosticsSnapshot};
pub use error::Error;
pub use event_bus::{RuntimeEventBus, RuntimeEventSink};
pub use game_client::{
    GameClientActions, GameClientCacheActions, GameClientLocationSource, GameClientRuntime,
    GameClientRuntimeDeps, GameClientWindowActions, NoopGameClientCacheActions,
    NoopGameClientWindowActions,
};
pub use game_log::{
    duration_ms, parse_event_time_ms, player_key, world_id_from_location, GameLogHostActions,
    GameLogIngestEngine, GameLogIngestOptions, GameLogIngestOutput, GameLogProcessEvent,
    GameLogProjection, GameLogRuntime, GameLogRuntimeDeps, GameLogRuntimeState, GameLogSideEffect,
    NoopGameLogHostActions, PlayerState, RuntimeSnapshot, ScreenshotInput,
};
pub use groups::{
    ban_member, block_group, cancel_request, create_post, delete_invite, delete_post, edit_post,
    get_audit_log_types, get_bans, get_gallery, get_group, get_group_instances,
    get_group_quick_moderation, get_invites, get_join_requests, get_logs, get_members, get_posts,
    get_user_groups, get_user_instances, join_group, kick_member, leave_group,
    respond_join_request, run_group_quick_moderation_action, search_members, send_invite,
    set_member_props, set_representation, unban_member, unblock_group, GroupApiDeps,
    GroupQuickModerationActionInput, GroupQuickModerationActionOutput, GroupQuickModerationDeps,
    GroupQuickModerationGroup, GroupQuickModerationInput, GroupQuickModerationOutput,
    VrchatGroupGalleryInput, VrchatGroupIdInput, VrchatGroupJoinRequestRespondInput,
    VrchatGroupJoinRequestsInput, VrchatGroupLogsInput, VrchatGroupMemberPropsInput,
    VrchatGroupMembersInput, VrchatGroupMembersSearchInput, VrchatGroupPagedInput,
    VrchatGroupPostCreateInput, VrchatGroupPostDeleteInput, VrchatGroupPostEditInput,
    VrchatGroupProfileInput, VrchatGroupRepresentationInput, VrchatGroupUserGroupsInput,
    VrchatGroupUserInput,
};
pub use image_cache::{save_ugc_image_to_file, ImageCache};
pub use local_favorites::{
    create_local_favorite_group, delete_local_favorite_group, rename_local_favorite_group,
};
pub use log_watcher::{
    GameLogEvent, GameLogEventSink, LogLocationSnapshot, LogLocationSnapshotScanner, LogWatcher,
    NoopLogLocationSnapshotScanner,
};
pub use media_upload::{
    prepare_media_upload_request, require_prepared_image_data, upload_legacy_entity_image,
    LegacyEntityImageKind, LegacyEntityImageUploadInput, LegacyMediaUploadDeps,
};
pub use moderation_sync::{
    refresh_player_moderations, update_player_moderation, ModerationSyncDeps,
    ModerationSyncMutationInput, ModerationSyncMutationOutput, ModerationSyncRefreshInput,
    ModerationSyncRefreshOutput, RemoteModerationRow,
};
pub use mutual_graph_fetch::{
    MutualGraphFetchCancelInput, MutualGraphFetchRuntime, MutualGraphFetchStartInput,
    MutualGraphFetchStatus,
};
pub use noninteractive_auth::{
    auth_response_error_message, current_user_from_cookie, parse_current_user_response,
    probe_current_user_from_cookie, AuthenticatedRuntimeSession, CookieSessionProbe,
    NonInteractiveAuthError,
};
pub use overlay_activity::{
    overlay_activity_type_definitions, OverlayActivityActorRelation, OverlayActivityCandidate,
    OverlayActivityCategory, OverlayActivityContent, OverlayActivityDelivery, OverlayActivityEntry,
    OverlayActivityFavoriteGroupKeys, OverlayActivityFilters, OverlayActivityRule,
    OverlayActivityRuntime, OverlayActivityScope, OverlayActivitySink, OverlayActivitySnapshot,
    OverlayActivitySurface, OverlayActivitySurfaceFilters, OverlayActivityText,
    OverlayActivityTypeDefinition, OverlayFavoriteGroups,
};
pub use process_monitor::{
    GameProcessEvent, GameProcessEventSink, GameProcessMonitorActions, GameProcessStatus,
    ProcessMonitor,
};
pub use realtime::{
    is_friend_event_type, FriendBaselineResult, FriendProjection, FriendProjectionPatch,
    PendingOfflineTimerAction, RealtimeCurrentUserAuthority, RealtimeCurrentUserOutput,
    RealtimeCurrentUserProjection, RealtimeEntryCorrection, RealtimeEntryCorrectionFields,
    RealtimeEntryCorrectionStream, RealtimeFriendApplyResult, RealtimeFriendOutput,
    RealtimeFriendSnapshot, RealtimeFriendsRuntime, RealtimeHostRuntime, RealtimeHostRuntimeDeps,
    RealtimeInstanceClosedOutput, RealtimeInstanceClosedProjection,
    RealtimeInstanceQueueProjection, RealtimeNotificationOutput, RealtimeNotificationProjection,
    RealtimeNotificationUpsert, RealtimeSessionContext, RealtimeStopRequest,
    RealtimeTransportStartResult, RealtimeWsMessagePayload, RealtimeWsStatusPayload,
};
pub use registry_backup::{
    registry_backup_create, registry_backup_delete, registry_backup_export_json,
    registry_backup_import_json, registry_backup_list, registry_backup_maintenance_run,
    registry_backup_restore, RegistryBackupHostActions, RegistryBackupMaintenanceMode,
    RegistryBackupMaintenanceResult, RegistryBackupSnapshot,
};
pub use runtime_lifecycle::{RuntimeLifecycle, RuntimeLifecycleSnapshot};
pub use runtime_output::{
    format_runtime_output_event, RuntimeOutputLevel, RuntimeOutputLine, RuntimeOutputMode,
};
pub use screenshots::{
    add_screenshot_metadata, can_decode_image, delete_all_screenshot_metadata,
    delete_text_metadata, ensure_screenshot_thumbnail, extra_screenshot_data, find_screenshots,
    find_screenshots_json, get_screenshot_metadata, has_vrcx_metadata, is_path_inside_directory,
    is_png_file, is_vrchat_screenshot_file_path, last_screenshot, list_screenshot_folder_images,
    list_world_screenshots, read_png_dimensions, screenshot_folder_tree, screenshot_metadata_json,
    start_screenshot_library_scan, write_vrcx_metadata, MetadataCacheDb, ScreenshotFolderTree,
    ScreenshotLibraryImage, ScreenshotLibraryScanStatus, ScreenshotMetadata, ScreenshotSearchType,
};
pub use session::{
    GameProcessStatus as HostSessionGameProcessStatus, HostSessionProjection, HostSessionRuntime,
    RealtimeSessionContext as HostRealtimeSessionContext, SessionHostRuntime,
};
pub use social_baseline::{
    build_favorites_baseline, build_friend_roster_baseline, SocialBaselineDeps,
    SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput, SocialFriendRosterBaselineInput,
    SocialFriendRosterBaselineOutput,
};
pub use sync::{RuntimeSyncEngine, RuntimeSyncSnapshot};
pub use task_supervisor::{
    RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, TaskStopToken, TaskSupervisor,
};
pub use vrcx_0_core::location::ParsedLocation;
pub use web_client::WebClient;
pub use worker::{OverflowPolicy, RuntimeJobHandler, RuntimePushReport};
pub use world_cache::WorldCache;

pub type Result<T> = std::result::Result<T, Error>;
