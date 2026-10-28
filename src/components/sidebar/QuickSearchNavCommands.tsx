import { SettingsIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ShortcutKey } from '@/components/keyboard/ShortcutHintPanel';
import { getNavIconComponent } from '@/components/layout/navIconRegistry';
import {
    getNavShortcutEntries,
    getPathForNavEntry,
    loadNavMenuModel
} from '@/components/layout/navMenuModel';
import {
    getSettingsCard,
    getSettingsTabLabelKey,
    type SettingsManifestEntry
} from '@/shared/constants/settingsManifest';
import { isToolNavKey, toolDefinitions } from '@/shared/constants/tools';
import { navDefinitions } from '@/shared/constants/ui';
import { useDashboardStore } from '@/state/dashboardStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { CommandGroup, CommandItem } from '@/ui/shadcn/command';

const NAV_RESULT_LIMIT = 6;

export type QuickSearchNavCommand = {
    key: string;
    label: string;
    icon: string;
    keywords: string;
    target: { type: 'path'; path: string } | { type: 'tool'; toolKey: string };
};

function isNavCommand(
    command: QuickSearchNavCommand | null
): command is QuickSearchNavCommand {
    return Boolean(command);
}

export function useNavCommands(normalizedQuery: string) {
    const { t } = useTranslation();

    const allCommands = useMemo(() => {
        const pageCommands = navDefinitions
            .filter((definition) => !isToolNavKey(definition.key))
            .map((definition): QuickSearchNavCommand | null => {
                const path = getPathForNavEntry(definition);
                if (!path) {
                    return null;
                }
                const label = t(definition.labelKey);
                const keywords =
                    `${label} ${definition.key} ${path}`.toLowerCase();
                return {
                    key: definition.key,
                    label,
                    icon: definition.icon,
                    keywords,
                    target: { type: 'path', path }
                };
            })
            .filter(isNavCommand);
        const toolCommands = toolDefinitions.map(
            (tool): QuickSearchNavCommand => {
                const label = t(tool.titleKey);
                const description = t(tool.descriptionKey);
                return {
                    key: `tool-${tool.key}`,
                    label,
                    icon: tool.navIcon,
                    keywords:
                        `${label} ${description} ${tool.key} ${tool.category}`.toLowerCase(),
                    target: { type: 'tool', toolKey: tool.key }
                };
            }
        );
        return [...pageCommands, ...toolCommands];
    }, [t]);

    return useMemo(() => {
        if (!normalizedQuery) {
            return [];
        }
        return allCommands
            .filter((command) => command.keywords.includes(normalizedQuery))
            .slice(0, NAV_RESULT_LIMIT);
    }, [allCommands, normalizedQuery]);
}

export function useNavShortcutPositions(
    open: boolean
): ReadonlyMap<string, number> {
    const { t } = useTranslation();
    const dashboards = useDashboardStore((state) => state.dashboards);
    const notificationLayout = usePreferencesStore(
        (state) => state.notificationLayout
    );
    const [positions, setPositions] = useState<ReadonlyMap<string, number>>(
        () => new Map()
    );

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        let active = true;
        loadNavMenuModel({ dashboards, notificationLayout, t })
            .then((model) => {
                if (!active || !model) {
                    return;
                }
                setPositions(
                    new Map(
                        getNavShortcutEntries(model.menuItems).map(
                            ({ entry, position }) => [entry.index, position]
                        )
                    )
                );
            })
            .catch((error: unknown) => {
                console.warn('Failed to load navigation shortcuts:', error);
            });
        return () => {
            active = false;
        };
    }, [dashboards, notificationLayout, open, t]);

    return positions;
}

export function NavResultGroup({
    title,
    items,
    shortcutPositions,
    onSelect
}: {
    title: string;
    items: readonly QuickSearchNavCommand[];
    shortcutPositions?: ReadonlyMap<string, number>;
    onSelect: (item: QuickSearchNavCommand) => void;
}) {
    const isMacHost = useRuntimeStore(
        (state) => state.hostCapabilities.platform === 'macos'
    );
    if (!items.length) {
        return null;
    }
    return (
        <CommandGroup heading={title}>
            {items.map((item) => {
                const Icon = getNavIconComponent(item.icon);
                const shortcutPosition = shortcutPositions?.get(item.key);
                return (
                    <CommandItem
                        key={`nav:${item.key}`}
                        value={item.keywords}
                        className="gap-3"
                        onSelect={() => onSelect(item)}
                    >
                        <Icon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                            {item.label}
                        </span>
                        {shortcutPosition === undefined ? null : (
                            <ShortcutKey
                                keys={[
                                    isMacHost ? '⌘' : 'Ctrl',
                                    String(shortcutPosition)
                                ]}
                            />
                        )}
                    </CommandItem>
                );
            })}
        </CommandGroup>
    );
}

export function SettingsResultGroup({
    title,
    items,
    onSelect
}: {
    title: string;
    items: readonly SettingsManifestEntry[];
    onSelect: (item: SettingsManifestEntry) => void;
}) {
    const { t } = useTranslation();
    if (!items.length) {
        return null;
    }
    return (
        <CommandGroup heading={title}>
            {items.map((item) => {
                const tabLabelKey = getSettingsTabLabelKey(item.tab);
                const cardTitleKey = getSettingsCard(item.cardId)?.titleKey;
                return (
                    <CommandItem
                        key={`setting:${item.id}`}
                        value={`setting:${item.id}`}
                        className="gap-3"
                        onSelect={() => onSelect(item)}
                    >
                        <SettingsIcon className="size-4 shrink-0" />
                        <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{t(item.labelKey)}</span>
                            <span className="text-muted-foreground truncate text-xs">
                                {[tabLabelKey, cardTitleKey]
                                    .filter((key): key is string =>
                                        Boolean(key)
                                    )
                                    .map((key) => t(key))
                                    .join(' · ')}
                            </span>
                        </div>
                    </CommandItem>
                );
            })}
        </CommandGroup>
    );
}
