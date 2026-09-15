export const PROFILE_DECORATION_ITEM_TYPES = [
    'iconFrame',
    'profileEffect',
    'nameplateEffect'
] as const;

type ProfileDecorationItemType = (typeof PROFILE_DECORATION_ITEM_TYPES)[number];

export interface ProfileDecorationMutation {
    action: 'equip' | 'unequip';
    equipSlot: ProfileDecorationItemType;
    inventoryId: string;
}

interface InventoryAssetRecord {
    type?: string;
    url?: string;
}

export interface InventoryDisplayRecord {
    archived?: boolean;
    description?: string;
    displayName?: string;
    equipSlot?: string;
    equipSlots?: string[];
    flags?: string[];
    holderId?: string;
    id?: string;
    imageUrl?: string;
    isArchived?: boolean;
    item?: InventoryDisplayRecord | null;
    itemType?: string;
    last_equipped?: Record<string, string> | null;
    metadata?: {
        assets?: InventoryAssetRecord[];
        imageUrl?: string;
    } | null;
    name?: string;
    template?: InventoryDisplayRecord | null;
    thumbnailUrl?: string;
    type?: string;
}

const PROFILE_DECORATION_TYPE_LABEL_KEYS: Record<
    ProfileDecorationItemType,
    string
> = {
    iconFrame: 'dialog.inventory.icon_frame',
    profileEffect: 'dialog.inventory.profile_effect',
    nameplateEffect: 'dialog.inventory.nameplate_effect'
};

const PROFILE_DECORATION_PREVIEW_ASSET_TYPES = [
    'mainAnimation',
    'introAnimation',
    'base'
] as const;

function isProfileDecorationItemType(
    value: unknown
): value is ProfileDecorationItemType {
    return (
        typeof value === 'string' &&
        PROFILE_DECORATION_ITEM_TYPES.some((itemType) => itemType === value)
    );
}

export function resolveInventoryImageUrl(item: InventoryDisplayRecord) {
    return String(
        item.imageUrl ||
            item.thumbnailUrl ||
            item.item?.imageUrl ||
            item.item?.thumbnailUrl ||
            item.template?.imageUrl ||
            item.template?.thumbnailUrl ||
            item.metadata?.imageUrl ||
            ''
    );
}

export function resolveInventoryName(item: InventoryDisplayRecord) {
    return String(
        item.name ||
            item.item?.name ||
            item.template?.name ||
            item.displayName ||
            item.id ||
            ''
    );
}

export function resolveInventoryDescription(item: InventoryDisplayRecord) {
    return String(
        item.description ||
            item.item?.description ||
            item.template?.description ||
            ''
    );
}

export function resolveInventoryType(item: InventoryDisplayRecord) {
    return String(item.itemType || item.type || item.item?.type || '');
}

export function resolveProfileDecorationTypeLabelKey(
    itemType: unknown
): string | null {
    if (!isProfileDecorationItemType(itemType)) {
        return null;
    }
    return PROFILE_DECORATION_TYPE_LABEL_KEYS[itemType];
}

export function isEquippedProfileDecoration(
    item: InventoryDisplayRecord
): boolean {
    return (
        isProfileDecorationItemType(item.itemType) &&
        item.equipSlot === item.itemType
    );
}

export function isArchivedInventoryItem(item: InventoryDisplayRecord) {
    return Boolean(item.isArchived || item.archived);
}

export function resolveProfileDecorationMutation(
    item: InventoryDisplayRecord,
    currentUserId: string | null
): ProfileDecorationMutation | null {
    const inventoryId = item.id?.trim() ?? '';
    const normalizedCurrentUserId = currentUserId?.trim() ?? '';
    const holderId = item.holderId?.trim() ?? '';
    if (
        !inventoryId.startsWith('inv_') ||
        !normalizedCurrentUserId ||
        !isProfileDecorationItemType(item.itemType) ||
        !item.equipSlots?.includes(item.itemType) ||
        !item.flags?.includes('equippable') ||
        isArchivedInventoryItem(item) ||
        (holderId && holderId !== normalizedCurrentUserId)
    ) {
        return null;
    }

    return {
        action: item.equipSlot === item.itemType ? 'unequip' : 'equip',
        equipSlot: item.itemType,
        inventoryId
    };
}

export function resolveProfileDecorationPreviewUrl(
    item: InventoryDisplayRecord
): string {
    const assets = Array.isArray(item.metadata?.assets)
        ? item.metadata.assets
        : [];
    for (const assetType of PROFILE_DECORATION_PREVIEW_ASSET_TYPES) {
        const asset = assets.find(
            (candidate) =>
                candidate.type === assetType &&
                typeof candidate.url === 'string' &&
                candidate.url.trim()
        );
        const url = typeof asset?.url === 'string' ? asset.url.trim() : '';
        if (url) {
            return url;
        }
    }
    return resolveInventoryImageUrl(item);
}
