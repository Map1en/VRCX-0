mod activity_page;
mod activity_warmup;
mod auth_credentials;
mod authenticated_runtime;
mod authenticated_session_maintenance;
mod authenticated_session_storage;
mod avatar;
mod avatar_cache;
mod background_group_remote;
mod background_image_remote;
mod batch_mutation_requests;
mod collections;
mod community_theme_remote;
mod data_dir_migration;
mod favorite_remote_requests;
mod favorite_store;
mod file_cache;
mod friend_log_names;
mod github_release_catalog;
mod group_ban_import;
mod group_calendar_requests;
mod group_membership_requests;
mod group_moderation_requests;
mod group_requests;
mod image_cache;
mod instance_invite_requests;
mod inventory_remote_requests;
mod local_world_details_remote;
mod login_api;
mod media_upload;
mod moderation_sync;
mod mutual_graph;
mod noninteractive_auth;
mod note_export_requests;
mod notification_chains;
mod notification_delivery;
mod notification_mark_seen;
mod notification_sync;
mod prints;
mod profile_backup;
mod profile_bio;
mod profile_config;
mod profile_database_upgrade;
mod proxy_connectivity;
mod quick_search;
mod realtime_journal;
pub mod realtime_lifecycle_log;
mod realtime_remote_requests;
mod realtime_store;
mod realtime_transport;
mod saved_group_favorites;
pub mod screenshots;
mod secret_startup;
mod social_mutation_remote_requests;
mod telemetry;
mod translation;
mod user_api_field_log;
mod user_dialog_tab_counts;
mod vrc_status;
mod vrchat_config;
mod vrchat_request;
mod web_client;
mod world_cache;
mod world_name_resolver;
mod ws_event_log;

pub use activity_page::LocalActivityPageStore;
pub use activity_warmup::{LocalActivityPageWarmupStore, LocalActivitySessionWarmupStore};
pub use auth_credentials::LocalAuthCredentialStore;
pub use authenticated_runtime::{
    LocalAuthenticatedRuntimeLifecycleTrail, VrchatAuthenticatedRuntimeAuthProbe,
};
pub use authenticated_session_maintenance::LocalAuthenticatedSessionMaintenance;
pub use authenticated_session_storage::LocalAuthenticatedSessionStorage;
pub use avatar::{LocalAvatarApplicationAdapter, VrchatAvatarRemote};
pub use avatar_cache::LocalAvatarCacheAdapter;
pub use background_group_remote::VrchatBackgroundGroupRemote;
pub use background_image_remote::ExternalBackgroundImageRemote;
pub use batch_mutation_requests::VrchatBatchMutationRemoteRequests;
pub use collections::{LocalSharedCollectionImportActionsFactory, LocalWorldCollectionAdapter};
pub use community_theme_remote::ExternalCommunityThemeRemote;
pub use data_dir_migration::LocalDataDirMigrationPort;
pub use favorite_remote_requests::VrchatFavoriteRemote;
pub use favorite_store::LocalFavoriteStore;
pub use file_cache::FileCache as LocalFileCacheAdapter;
pub use friend_log_names::LocalFriendLogNameStore;
pub use github_release_catalog::GitHubReleaseCatalogAdapter;
pub use group_ban_import::LocalGroupBanImportActions;
pub use group_calendar_requests::VrchatGroupCalendarRemote;
pub use group_membership_requests::VrchatGroupMembershipRemoteRequests;
pub use group_moderation_requests::VrchatGroupModerationRemoteRequests;
pub use group_requests::VrchatGroupRemoteRequests;
pub use image_cache::LocalImageCacheAdapter;
pub use instance_invite_requests::VrchatInstanceInviteRemoteRequests;
pub use inventory_remote_requests::VrchatInventoryRemoteRequests;
pub use local_world_details_remote::CachedLocalWorldDetailsRemote;
pub use login_api::{VrchatLoginApi, WebAuthSessionCookies};
pub use media_upload::LocalMediaUploadAdapter;
pub use moderation_sync::{LocalModerationSyncStore, VrchatModerationSyncRemoteRequests};
pub use mutual_graph::{LocalMutualGraphStore, VrchatMutualGraphRemoteRequests};
pub use noninteractive_auth::LocalNonInteractiveAuthActions;
pub use note_export_requests::VrchatNoteExportRemoteRequests;
pub use notification_chains::LocalNotificationChainActions;
pub use notification_delivery::{
    LocalNotificationConfig, LocalNotificationWebhookTransport,
    RealtimeNotificationUserImageResolver, VrchatNotificationRemote,
};
pub use notification_mark_seen::LocalNotificationMarkSeenActions;
pub use notification_sync::LocalNotificationSyncAdapter;
pub use prints::LocalPrintAdapter;
pub use profile_backup::{LocalProfileBackupDeps, LocalProfileBackupPort};
pub use profile_bio::{LocalProfileBioStore, VrchatProfileBioRemoteRequests};
pub use profile_config::LocalProfileConfigStore;
pub use profile_database_upgrade::LocalDatabaseUpgradeStore;
pub use proxy_connectivity::ProxyConnectivityAdapter;
pub use quick_search::{LocalQuickSearchDetailStore, VrchatQuickSearchRemoteRequests};
pub use realtime_remote_requests::VrchatRealtimeRemoteRequests;
pub use realtime_store::PersistenceRealtimeStore;
pub use realtime_transport::VrchatRealtimeTransport;
pub use saved_group_favorites::LocalSavedGroupFavoritesAdapter;
pub use secret_startup::LocalSecretStartup;
pub use social_mutation_remote_requests::VrchatSocialMutationRemoteRequests;
pub use telemetry::{HttpTelemetryTransport, LocalTelemetryEnvironment};
pub use translation::LocalTranslationAdapter;
pub use user_dialog_tab_counts::LocalUserDialogTabCountsSource;
pub use vrc_status::VrcStatusRemoteAdapter;
pub use vrchat_config::VrchatConfigAdapter;
pub use vrchat_request::VrchatRequestAdapter;
pub use web_client::WebClient as LocalWebClientAdapter;
pub use world_cache::LocalWorldCacheAdapter;
pub use world_name_resolver::CachedWorldNameResolver;

pub(crate) use vrcx_0_application_core::Error;
pub(crate) type Result<T> = vrcx_0_application_core::Result<T>;

pub(crate) fn map_persistence_error(error: vrcx_0_persistence::Error) -> Error {
    match error {
        vrcx_0_persistence::Error::Database(message) => Error::Database(message),
        vrcx_0_persistence::Error::Sqlite { message, category } => {
            Error::Sqlite { message, category }
        }
        vrcx_0_persistence::Error::Io(error) => Error::Io(error),
        vrcx_0_persistence::Error::Json(error) => Error::Json(error),
        vrcx_0_persistence::Error::InvalidData(message) => Error::PersistenceInvalidData(message),
        vrcx_0_persistence::Error::Custom(message) => Error::Custom(message),
    }
}

pub(crate) fn map_web_client_error(error: vrcx_0_vrchat_client::WebClientError) -> Error {
    match error {
        vrcx_0_vrchat_client::WebClientError::Custom(message) => Error::WebClient(message),
        vrcx_0_vrchat_client::WebClientError::Io(error) => Error::Io(error),
    }
}

pub(crate) fn map_image_fetch_error(error: vrcx_0_vrchat_client::ImageFetchError) -> Error {
    match error {
        vrcx_0_vrchat_client::ImageFetchError::Custom(message) => Error::Custom(message),
    }
}

pub(crate) fn map_http_api_error(error: vrcx_0_vrchat_client::HttpApiError) -> Error {
    match error {
        vrcx_0_vrchat_client::HttpApiError::Custom(message) => Error::Custom(message),
    }
}
