import { DASHBOARD_NAV_KEY_PREFIX } from '@/shared/constants/dashboard';
import { isToolNavKey } from '@/shared/constants/tools';

import {
    getPathForNavEntry,
    type NavFolderItem,
    type NavLayoutEntry,
    type NavMenuItem
} from '../navMenuModel';

type Translate = (key: string) => string;

function labelForEntry(entry: NavMenuItem | null | undefined, t: Translate) {
    if (!entry) {
        return '';
    }
    if (entry.titleIsCustom) {
        return (
            entry.title ||
            entry.label ||
            entry.labelKey ||
            entry.key ||
            entry.index ||
            ''
        );
    }
    return t(
        entry.title ||
            entry.label ||
            entry.labelKey ||
            entry.tooltip ||
            entry.key ||
            ''
    );
}

function isEntryActive(
    entry: NavMenuItem | null | undefined,
    pathname: string
) {
    const path = getPathForNavEntry(entry ?? null);
    if (!path) {
        return false;
    }
    if (entry?.routeName === 'tools') {
        return pathname === '/tools';
    }
    return pathname === path || pathname.startsWith(`${path}/`);
}

function isDashboardEntry(entry: NavMenuItem | null | undefined) {
    return String(entry?.index || '').startsWith(DASHBOARD_NAV_KEY_PREFIX);
}

function isToolEntry(entry: NavMenuItem | null | undefined) {
    return isToolNavKey(entry?.index || entry?.key);
}

function isEntryNotified(
    entry: NavMenuItem | null | undefined,
    notifiedKeys: ReadonlySet<string>
) {
    if (!entry || !notifiedKeys?.size) {
        return false;
    }
    const targets = [entry.index, entry.key, entry.routeName].filter(
        (key): key is string => typeof key === 'string' && Boolean(key)
    );
    if (entry.path) {
        const lastSegment = String(entry.path).split('/').filter(Boolean).pop();
        if (lastSegment) {
            targets.push(lastSegment);
        }
    }
    return targets.some((key) => notifiedKeys.has(key));
}

function isNavItemNotified(
    entry: NavMenuItem,
    notifiedKeys: ReadonlySet<string>
) {
    if (isEntryNotified(entry, notifiedKeys)) {
        return true;
    }
    return Boolean(
        entry.children?.some((child) => isEntryNotified(child, notifiedKeys))
    );
}

function getFolderItemKey(item: NavFolderItem) {
    return typeof item === 'string' ? item : item?.key;
}

function removeNavKeyFromLayout(
    layout: NavLayoutEntry[],
    navKey: string
): NavLayoutEntry[] {
    return layout
        .map((entry): NavLayoutEntry | null => {
            if (entry.type === 'item') {
                return entry.key === navKey ? null : entry;
            }
            if (entry.type === 'folder') {
                const nextItems = (entry.items || []).filter(
                    (item) => getFolderItemKey(item) !== navKey
                );
                return nextItems.length
                    ? {
                          ...entry,
                          items: nextItems
                      }
                    : null;
            }
            return entry;
        })
        .filter((entry): entry is NavLayoutEntry => entry !== null);
}

export {
    isDashboardEntry,
    isEntryActive,
    isEntryNotified,
    isNavItemNotified,
    isToolEntry,
    labelForEntry,
    removeNavKeyFromLayout
};
