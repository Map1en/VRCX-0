import { useFavoritesBulkActions } from './useFavoritesBulkActions.js';
import { useFavoritesCollectionActions } from './useFavoritesCollectionActions.js';
import { useFavoritesItemActions } from './useFavoritesItemActions.js';
export function useFavoritesPageActions(deps) {
    const collectionActions = useFavoritesCollectionActions(deps);
    const itemActions = useFavoritesItemActions({
        ...deps,
        ...collectionActions
    });
    const bulkActions = useFavoritesBulkActions({
        ...deps,
        ...collectionActions,
        ...itemActions
    });
    return {
        ...collectionActions,
        ...itemActions,
        ...bulkActions
    };
}
