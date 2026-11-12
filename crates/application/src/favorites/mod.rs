mod bulk_remove;
mod cache_policy;
mod favorite_details_hydrate;
mod favorite_import;
mod favorite_transfer;
mod favorite_world_cards;
mod local_favorites;
mod local_world_details;
mod mutation_coordinator;
mod remote_favorites;
mod remote_move;
#[cfg(test)]
mod test_support;

pub use vrcx_0_contracts::FavoriteRow;

pub use bulk_remove::{
    FavoriteBulkRemoveInput, FavoriteBulkRemoveItem, FavoriteBulkRemoveItemResult,
    FavoriteBulkRemoveItemState, FavoriteBulkRemoveResult, FavoriteBulkRemoveSource,
    FAVORITE_BULK_REMOVE_MAX_ITEMS,
};
pub use cache_policy::{
    persist_favorite_cache_snapshot, FavoriteCacheKind, FavoriteCacheSnapshotInput,
};
pub use favorite_details_hydrate::{
    FavoriteDetailsHydrateInput, FavoriteDetailsHydrateKind, FavoriteDetailsHydrateOutput,
    FavoriteDetailsRuntime,
};
pub use favorite_import::{
    FavoriteImportItemResult, FavoriteImportItemState, FavoriteImportKind, FavoriteImportLocation,
    FavoriteImportOperation, FavoriteImportRuntime, FavoriteImportRuntimeDeps,
    FavoriteImportStartInput, FavoriteImportState, FavoriteImportStatus, FavoriteImportTarget,
    FAVORITE_IMPORT_MAX_ITEMS,
};
pub use favorite_transfer::{
    favorite_transfer_plan_for_item, FavoriteTransferInput, FavoriteTransferItem,
    FavoriteTransferItemResult, FavoriteTransferItemStatus, FavoriteTransferLocation,
    FavoriteTransferMode, FavoriteTransferResult, FavoriteTransferSelectionInput,
    FavoriteTransferSelectionResult, FavoriteTransferSource, FavoriteTransferStage,
    FavoriteTransferTarget,
};
pub use local_favorites::{
    get_local_favorite_snapshot, list_local_favorite_custom_order, list_local_favorites,
    FavoriteMoveResult, FavoriteStore, LocalFavoriteGroupWrite, LocalFavoriteSnapshot,
};
pub use local_world_details::{
    refresh_local_world_details, LocalWorldDetailsRefreshOutput, LocalWorldDetailsRemote,
};
pub use mutation_coordinator::{FavoriteMutationCoordinator, FavoriteMutationRuntimeDeps};
pub use remote_favorites::{
    FavoriteRemote, FavoriteRemoteAddInput, FavoriteRemoteCommand, FavoriteRemoteDeleteInput,
    FavoriteRemoteFuture, FavoriteRemoteGroupClearInput, FavoriteRemoteGroupSaveInput,
};
pub use remote_move::{
    FavoriteRemoteEntry, FavoriteRemoteGroup, FavoriteRemoteGroupSummary, FavoriteRemoteListInput,
    FavoriteRemoteListing, FavoriteRemoteMoveInput, FavoriteRemoteMoveItem,
    FavoriteRemoteMoveOutput, FavoriteRemoteMoveStatus, FAVORITE_REMOTE_MOVE_MAX_ITEMS,
};
