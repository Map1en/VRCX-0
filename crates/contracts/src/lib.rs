pub mod activity;
pub mod activity_page;
mod avatar;
pub mod background_image;
pub mod collector_auth;
mod community_theme;
pub mod community_theme_protocol;
mod data_dir_migration;
mod database_upgrade;
mod entity_cache;
pub mod external_api;
mod favorites;
pub mod feed;
pub mod feed_live;
pub mod friend_log;
pub mod game_log;
pub mod game_log_query;
mod legacy_migration;
pub mod llm;
mod media;
pub mod notifications;
mod persistence;
mod profile_backup;
pub mod profile_bio;
mod profile_config;
pub mod realtime;
pub mod social_aggregates;
pub mod telemetry;
mod translation;
pub mod vrchat_api;
pub mod vrchat_requests;
mod web;
pub mod world_collections;

pub use avatar::{AvatarTagOutput, AvatarTimeSpentOutput, AvatarUsageRow, AvatarWearSegment};
pub use collector_auth::{CollectorAuthStatus, CollectorAuthStatusKind};
pub use community_theme::{
    CommunityThemeAuthor, CommunityThemeCatalog, CommunityThemeManifest, CommunityThemeStatsById,
    CommunityThemeStatsEntry,
};
pub use data_dir_migration::{
    DataDirCleanupPending, DataDirCleanupReport, DataDirMigrationResult,
    DataDirMigrationResultStatus, DataDirMigrationTargetState, DataDirMigrationWarning,
    DATA_DIR_MIGRATION_SPACE_MARGIN_BYTES,
};
pub use database_upgrade::DatabaseUpgradeStatus;
pub use entity_cache::{
    AvatarCacheOutput, CacheEntityInput, FileMetadataOutput, WorldSummaryOutput,
};
pub use favorites::{
    FavoriteRow, SavedGroupCollection, SavedGroupCollectionCreateInput,
    SavedGroupCollectionDeleteInput, SavedGroupFavoriteAddInput, SavedGroupFavoriteRemoveInput,
    SavedGroupFavoritesSnapshot, VrchatFavoriteType,
};
pub use legacy_migration::{
    LegacyMigrationPaths, LegacyMigrationProgress, LegacyVrcxDiscovery, LegacyVrcxMigrationStatus,
    LegacyVrcxSource,
};
pub use llm::{
    AssistantTurn, ChatMessage, FunctionCall, LlmEndpointDetectModelsResult, LlmModelReasoning,
    LlmRequestOptions, ToolCall, ToolDefinition,
};
pub use media::UgcCategory;
pub use persistence::{ApplicationErrorPayload, ApplicationErrorSource, SqliteErrorCategory};
pub use profile_backup::{
    ProfileBackupKind, ProfileRestoreAppVersionCheck, ProfileRestoreArchiveCheck,
    ProfileRestoreDataDisposition, ProfileRestoreDatabaseCheck, ProfileRestoreDatabaseVersionCheck,
    ProfileRestoreFailure, ProfileRestoreFailureCode, ProfileRestoreManifestSummary,
    ProfileRestoreResult, ProfileRestoreResultStatus, ProfileRestoreValidation,
    ProfileRestoreValidationOutcome,
};
pub use profile_config::{resolve_config_key, ConfigMutation, ConfigReadEntry, ConfigWriteEntry};
pub use translation::TranslationProvider;
pub use vrchat_api::{
    VrchatAuthFailureKind, VrchatFailure, VrchatJsonResponse, VrchatRequest, VrchatRequestBody,
    VrchatResponse, VrchatResponseClass, VrchatResponsePolicy, VrchatScope, VrchatUpload,
};
pub use vrcx_0_runtime_event::{
    runtime_event_payload, InstanceRosterMember, InstanceRosterObserver, InstanceRosterSnapshot,
    RuntimeEventPayload,
};
pub use web::{
    RealtimeAuthTokenFetch, RealtimeConnectionOptions, WebExecuteRequest, WebUploadMode,
};
