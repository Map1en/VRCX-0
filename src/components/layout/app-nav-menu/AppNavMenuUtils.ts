import { DASHBOARD_NAV_KEY_PREFIX } from '@/shared/constants/dashboard';
import { isToolNavKey } from '@/shared/constants/tools';

import { getPathForNavEntry } from '../navMenuModel';

function labelForEntry(entry: any, t: any) {
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

function themeModeLabel(themeMode: any, t: any) {
    return t(`view.settings.appearance.appearance.theme_mode_${themeMode}`);
}

function isEntryActive(entry: any, pathname: any) {
    const path = getPathForNavEntry(entry);
    if (!path) {
        return false;
    }
    if (entry?.routeName === 'tools') {
        return pathname === '/tools';
    }
    return pathname === path || pathname.startsWith(`${path}/`);
}

function isDashboardEntry(entry: any) {
    return String(entry?.index || '').startsWith(DASHBOARD_NAV_KEY_PREFIX);
}

function isToolEntry(entry: any) {
    return isToolNavKey(entry?.index || entry?.key);
}

function isEntryNotified(entry: any, notifiedKeys: any) {
    if (!entry || !notifiedKeys?.size) {
        return false;
    }
    const targets = [entry.index, entry.key, entry.routeName].filter(Boolean);
    if (entry.path) {
        const lastSegment = String(entry.path).split('/').filter(Boolean).pop();
        if (lastSegment) {
            targets.push(lastSegment);
        }
    }
    return targets.some((key: any) => notifiedKeys.has(key));
}

function isNavItemNotified(entry: any, notifiedKeys: any) {
    if (isEntryNotified(entry, notifiedKeys)) {
        return true;
    }
    return Boolean(
        entry?.children?.some((child: any) =>
            isEntryNotified(child, notifiedKeys)
        )
    );
}

function getFolderItemKey(item: any) {
    return typeof item === 'string' ? item : item?.key;
}

function removeNavKeyFromLayout(layout: any, navKey: any) {
    return (layout || [])
        .map((entry: any) => {
            if (entry.type === 'item') {
                return entry.key === navKey ? null : entry;
            }
            if (entry.type === 'folder') {
                const nextItems = (entry.items || []).filter(
                    (item: any) => getFolderItemKey(item) !== navKey
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
        .filter(Boolean);
}

export {
    isDashboardEntry,
    isEntryActive,
    isEntryNotified,
    isNavItemNotified,
    isToolEntry,
    labelForEntry,
    removeNavKeyFromLayout,
    themeModeLabel
};
