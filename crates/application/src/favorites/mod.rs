mod bulk_remove;
mod cache_policy;
mod favorite_details_hydrate;
mod favorite_import;
mod favorite_transfer;
mod local_favorites;
mod remote_favorites;

pub use vrcx_0_persistence::favorites::FavoriteRow;

pub use bulk_remove::{
    remove_favorites_bulk, FavoriteBulkRemoveDeps, FavoriteBulkRemoveInput, FavoriteBulkRemoveItem,
    FavoriteBulkRemoveItemResult, FavoriteBulkRemoveItemState, FavoriteBulkRemoveResult,
    FavoriteBulkRemoveSource, FAVORITE_BULK_REMOVE_MAX_ITEMS,
};
pub use cache_policy::{
    persist_favorite_cache_snapshot, FavoriteCacheKind, FavoriteCacheSnapshotInput,
};
pub use favorite_details_hydrate::{
    hydrate_favorite_details, FavoriteDetailsHydrateDeps, FavoriteDetailsHydrateInput,
    FavoriteDetailsHydrateKind, FavoriteDetailsHydrateOutput,
};
pub use favorite_import::{
    FavoriteImportItemResult, FavoriteImportItemState, FavoriteImportKind, FavoriteImportLocation,
    FavoriteImportOperation, FavoriteImportRuntime, FavoriteImportStartInput, FavoriteImportState,
    FavoriteImportStatus, FavoriteImportTarget, FAVORITE_IMPORT_MAX_ITEMS,
};
pub use favorite_transfer::{
    favorite_transfer_plan_for_item, transfer_favorites, FavoriteTransferDeps,
    FavoriteTransferInput, FavoriteTransferItem, FavoriteTransferItemResult,
    FavoriteTransferItemStatus, FavoriteTransferLocation, FavoriteTransferMode,
    FavoriteTransferResult, FavoriteTransferSource, FavoriteTransferStage, FavoriteTransferTarget,
};
pub use local_favorites::{
    add_local_favorite, create_local_favorite_group, delete_local_favorite_entries,
    delete_local_favorite_group, list_local_favorites, remove_local_favorite,
    rename_local_favorite_entries, rename_local_favorite_group, LocalFavoriteGroupWrite,
};
pub use remote_favorites::{
    add_remote_favorite, clear_remote_favorite_group, delete_remote_favorite,
    save_remote_favorite_group, FavoriteRemoteAddInput, FavoriteRemoteDeleteInput,
    FavoriteRemoteGroupClearInput, FavoriteRemoteGroupSaveInput, FavoriteRemoteMutationDeps,
};
