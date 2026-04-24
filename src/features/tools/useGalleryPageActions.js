import { useGalleryAssetActions } from './useGalleryAssetActions.js';
import { useGalleryInventoryActions } from './useGalleryInventoryActions.js';
export function useGalleryPageActions(deps) {
    const assetActions = useGalleryAssetActions(deps);
    const inventoryActions = useGalleryInventoryActions({
        ...deps,
        ...assetActions
    });
    return {
        ...assetActions,
        ...inventoryActions
    };
}
