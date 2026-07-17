import {
    DEFAULT_NAV_ICON_KEY,
    normalizeNavIconKey
} from '@/shared/constants/navIcons';

const SYSTEM_TAB_FRIENDS = 'friends';
const SYSTEM_TAB_GROUPS = 'groups';

export const SIDEBAR_TAB_DISPLAY_MODES = [
    'auto',
    'iconText',
    'iconOnly'
] as const;

export type SidebarTabDisplayMode = (typeof SIDEBAR_TAB_DISPLAY_MODES)[number];

export type SidebarSystemTabId =
    | typeof SYSTEM_TAB_FRIENDS
    | typeof SYSTEM_TAB_GROUPS;

export interface SidebarSystemTabLayoutItem {
    id: SidebarSystemTabId;
    type: 'system';
    systemTab: SidebarSystemTabId;
    icon: string;
    visible: boolean;
}

export interface SidebarFavoriteCollectionTabLayoutItem {
    id: string;
    type: 'favoriteCollection';
    name: string;
    icon: string;
    visible: boolean;
    sourceGroupKeys: string[];
}

export type SidebarTabLayoutItem =
    | SidebarSystemTabLayoutItem
    | SidebarFavoriteCollectionTabLayoutItem;

export type SidebarTabLayout = SidebarTabLayoutItem[];

export interface FavoriteGroupItem {
    key: string;
    label: string;
    source: 'remote' | 'local';
}

function isSidebarSystemTabLayoutItem(
    item: SidebarTabLayoutItem
): item is SidebarSystemTabLayoutItem {
    return item.type === 'system';
}

export const DEFAULT_SIDEBAR_TAB_LAYOUT: SidebarTabLayout = [
    {
        id: SYSTEM_TAB_FRIENDS,
        type: 'system',
        systemTab: SYSTEM_TAB_FRIENDS,
        icon: 'lucide:UserRound',
        visible: true
    },
    {
        id: SYSTEM_TAB_GROUPS,
        type: 'system',
        systemTab: SYSTEM_TAB_GROUPS,
        icon: 'lucide:Users',
        visible: true
    }
];

function normalizeText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function uniqueStrings(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }
    return Array.from(
        new Set(values.map((value) => normalizeText(value)).filter(Boolean))
    );
}

function parseLayoutValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return [];
    }
    try {
        return JSON.parse(value);
    } catch {
        return [];
    }
}

function normalizeSystemTab(
    systemTab: SidebarSystemTabId,
    source?: Partial<SidebarSystemTabLayoutItem>
): SidebarSystemTabLayoutItem {
    const fallback = DEFAULT_SIDEBAR_TAB_LAYOUT.find(
        (item): item is SidebarSystemTabLayoutItem =>
            isSidebarSystemTabLayoutItem(item) && item.systemTab === systemTab
    );
    const visible =
        systemTab === SYSTEM_TAB_FRIENDS ? true : source?.visible !== false;
    return {
        id: systemTab,
        type: 'system',
        systemTab,
        icon: normalizeNavIconKey(source?.icon, fallback?.icon),
        visible
    };
}

function normalizeFavoriteCollectionTab(
    item: Record<string, unknown>,
    seenIds: Set<string>
): SidebarFavoriteCollectionTabLayoutItem | null {
    const id = normalizeText(item.id);
    if (!id || seenIds.has(id)) {
        return null;
    }
    seenIds.add(id);
    const name = normalizeText(item.name) || 'Favorite Collection';
    return {
        id,
        type: 'favoriteCollection',
        name,
        icon: normalizeNavIconKey(item.icon, 'lucide:UserStar'),
        visible: item.visible !== false,
        sourceGroupKeys: uniqueStrings(item.sourceGroupKeys)
    };
}

export function normalizeSidebarTabLayout(value: unknown): SidebarTabLayout {
    const parsed = parseLayoutValue(value);
    const sourceItems = Array.isArray(parsed) ? parsed : [];
    const nextLayout: SidebarTabLayout = [];
    const seenSystemTabs = new Set<SidebarSystemTabId>();
    const seenCustomIds = new Set<string>();

    for (const rawItem of sourceItems) {
        if (!rawItem || typeof rawItem !== 'object') {
            continue;
        }
        const item = rawItem as Record<string, unknown>;
        if (item.type === 'system') {
            const systemTab = normalizeText(item.systemTab || item.id);
            if (
                (systemTab === SYSTEM_TAB_FRIENDS ||
                    systemTab === SYSTEM_TAB_GROUPS) &&
                !seenSystemTabs.has(systemTab)
            ) {
                nextLayout.push(
                    normalizeSystemTab(
                        systemTab,
                        item as Partial<SidebarSystemTabLayoutItem>
                    )
                );
                seenSystemTabs.add(systemTab);
            }
            continue;
        }

        if (item.type === 'favoriteCollection') {
            const customTab = normalizeFavoriteCollectionTab(
                item,
                seenCustomIds
            );
            if (customTab) {
                nextLayout.push(customTab);
            }
        }
    }

    if (!seenSystemTabs.has(SYSTEM_TAB_FRIENDS)) {
        nextLayout.unshift(normalizeSystemTab(SYSTEM_TAB_FRIENDS));
    }
    if (!seenSystemTabs.has(SYSTEM_TAB_GROUPS)) {
        nextLayout.push(normalizeSystemTab(SYSTEM_TAB_GROUPS));
    }

    return nextLayout;
}

export function serializeSidebarTabLayout(layout: SidebarTabLayout): string {
    return JSON.stringify(normalizeSidebarTabLayout(layout));
}

export function normalizeSidebarTabDisplayMode(
    value: unknown
): SidebarTabDisplayMode {
    return SIDEBAR_TAB_DISPLAY_MODES.includes(value as SidebarTabDisplayMode)
        ? (value as SidebarTabDisplayMode)
        : 'auto';
}

export function createFavoriteCollectionTab(
    existingLayout: SidebarTabLayout,
    label = 'Favorite Collection'
): SidebarFavoriteCollectionTabLayoutItem {
    const existingIds = new Set(existingLayout.map((item) => item.id));
    let index = existingLayout.filter(
        (item) => item.type === 'favoriteCollection'
    ).length;
    let id = '';
    do {
        index += 1;
        id = `favorite-collection-${Date.now()}-${index}`;
    } while (existingIds.has(id));

    return {
        id,
        type: 'favoriteCollection',
        name: label,
        icon: 'lucide:UserStar',
        visible: true,
        sourceGroupKeys: []
    };
}

export function getVisibleSidebarTabs(
    layout: SidebarTabLayout
): SidebarTabLayout {
    return normalizeSidebarTabLayout(layout).filter((item) => item.visible);
}

export function getVisibleFavoriteCollectionSourceGroupKeys(
    layout: SidebarTabLayout
): string[] {
    return Array.from(
        new Set(
            normalizeSidebarTabLayout(layout)
                .filter(
                    (item): item is SidebarFavoriteCollectionTabLayoutItem =>
                        item.type === 'favoriteCollection' && item.visible
                )
                .flatMap((item) => item.sourceGroupKeys)
                .filter(Boolean)
        )
    );
}

export function moveSidebarTab(
    layout: SidebarTabLayout,
    fromIndex: number,
    toIndex: number
): SidebarTabLayout {
    if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= layout.length ||
        toIndex >= layout.length
    ) {
        return layout;
    }
    const nextLayout = [...layout];
    const [item] = nextLayout.splice(fromIndex, 1);
    nextLayout.splice(toIndex, 0, item);
    return nextLayout;
}

export function sidebarTabFallbackIcon(item: SidebarTabLayoutItem): string {
    if (item.type === 'favoriteCollection') {
        return 'lucide:UserStar';
    }
    if (item.systemTab === SYSTEM_TAB_GROUPS) {
        return 'lucide:Users';
    }
    if (item.systemTab === SYSTEM_TAB_FRIENDS) {
        return 'lucide:UserRound';
    }
    return DEFAULT_NAV_ICON_KEY;
}
