import {
    ChevronDownIcon,
    DownloadIcon,
    FolderOpenIcon,
    ImageIcon,
    MoreHorizontalIcon,
    PinIcon,
    PinOffIcon,
    UsersIcon,
    WrenchIcon
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import {
    loadNavMenuModel,
    NAV_LAYOUT_UPDATED_EVENT,
    saveNavMenuModel
} from '@/components/layout/navMenuModel.js';
import { cn } from '@/lib/utils.js';
import { configRepository } from '@/repositories/index.js';
import { triggerToolByKey } from '@/services/toolActionService.js';
import { getNavIconComponent } from '@/shared/constants/navIcons.js';
import {
    getToolsByCategory,
    toolCategories
} from '@/shared/constants/tools.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { Button } from '@/ui/shadcn/button';

const collapsibleCategories = toolCategories.map((category) => category.key);
const configKey = 'VRCX_toolsCategoryCollapsed';
const defaultCollapsedState = {
    group: false,
    image: false,
    shortcuts: false,
    system: false,
    user: false,
    other: false
};
const toolsPageCategories = toolCategories
    .filter((category) => collapsibleCategories.includes(category.key))
    .map((category) => ({
        ...category,
        tools: getToolsByCategory(category.key)
    }));

const categoryIconByKey = {
    image: ImageIcon,
    shortcuts: FolderOpenIcon,
    group: UsersIcon,
    system: WrenchIcon,
    user: DownloadIcon,
    other: MoreHorizontalIcon
};

function ToolItem({
    icon: Icon,
    title,
    description,
    pinLabel,
    unpinLabel,
    navEligible,
    isPinned,
    onClick,
    onPin,
    onUnpin
}) {
    const PinStateIcon = isPinned ? PinOffIcon : PinIcon;

    return (
        <div className="relative h-full">
            <Button
                type="button"
                variant="outline"
                className="h-full w-full min-w-0 items-start justify-start gap-2.5 p-3 pr-10 text-left font-normal whitespace-normal"
                onClick={onClick}
            >
                <div className="bg-muted/40 text-muted-foreground flex size-8 flex-none items-center justify-center rounded-md">
                    <Icon aria-hidden="true" data-icon="inline-start" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{title}</div>
                    <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
                        {description}
                    </div>
                </div>
            </Button>
            {navEligible ? (
                <Button
                    type="button"
                    size="icon-xs"
                    variant={isPinned ? 'secondary' : 'ghost'}
                    className={cn(
                        'absolute top-2 right-2 size-7',
                        !isPinned && 'text-muted-foreground'
                    )}
                    title={isPinned ? unpinLabel : pinLabel}
                    aria-label={isPinned ? unpinLabel : pinLabel}
                    onClick={() => {
                        if (isPinned) {
                            onUnpin?.();
                        } else {
                            onPin?.();
                        }
                    }}
                >
                    <PinStateIcon data-icon="inline-start" />
                </Button>
            ) : null}
        </div>
    );
}

function collectLayoutKeys(layout) {
    const keys = new Set();
    for (const entry of layout || []) {
        if (entry.type === 'item' && entry.key) {
            keys.add(entry.key);
        } else if (entry.type === 'folder') {
            for (const item of entry.items || []) {
                const key = typeof item === 'string' ? item : item?.key;
                if (key) {
                    keys.add(key);
                }
            }
        }
    }
    return keys;
}

function insertToolNavItem(layout, navKey) {
    const nextLayout = Array.isArray(layout) ? [...layout] : [];
    if (collectLayoutKeys(nextLayout).has(navKey)) {
        return nextLayout;
    }
    const insertIndex = nextLayout.findIndex(
        (entry) =>
            entry.type === 'item' &&
            (entry.key === 'tools' || entry.key === 'direct-access')
    );
    if (insertIndex >= 0) {
        nextLayout.splice(insertIndex, 0, { type: 'item', key: navKey });
        return nextLayout;
    }
    return [...nextLayout, { type: 'item', key: navKey }];
}

function removeToolNavItem(layout, navKey) {
    return (layout || [])
        .map((entry) => {
            if (entry.type === 'item') {
                return entry.key === navKey ? null : entry;
            }
            if (entry.type === 'folder') {
                const nextItems = (entry.items || []).filter(
                    (item) =>
                        (typeof item === 'string' ? item : item?.key) !== navKey
                );
                return nextItems.length ? { ...entry, items: nextItems } : null;
            }
            return entry;
        })
        .filter(Boolean);
}

function useToolsCollapsedState() {
    const [collapsed, setCollapsed] = useState({
        ...defaultCollapsedState
    });

    useEffect(() => {
        let active = true;
        configRepository
            .getString(configKey, '{}')
            .then((value) => {
                if (!active) {
                    return;
                }
                const parsed = JSON.parse(value || '{}');
                setCollapsed((current) => ({
                    ...current,
                    ...Object.fromEntries(
                        Object.keys(defaultCollapsedState).map((key) => [
                            key,
                            Boolean(parsed[key])
                        ])
                    )
                }));
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    function toggleCategoryCollapsed(categoryKey) {
        setCollapsed((current) => {
            const nextState = {
                ...current,
                [categoryKey]: !current[categoryKey]
            };
            void configRepository.setString(
                configKey,
                JSON.stringify(nextState)
            );
            return nextState;
        });
    }

    return { collapsed, toggleCategoryCollapsed };
}

export function ToolsPage() {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const dashboards = useDashboardStore((state) => state.dashboards);
    const ensureDashboardsLoaded = useDashboardStore(
        (state) => state.ensureLoaded
    );
    const categories = toolsPageCategories;
    const { collapsed, toggleCategoryCollapsed } = useToolsCollapsedState();
    const [navLayout, setNavLayout] = useState([]);
    const [navHiddenKeys, setNavHiddenKeys] = useState([]);
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const notificationLayout = usePreferencesStore(
        (state) => state.notificationLayout
    );
    const translateWithFallback = (key) => {
        const localized = t(key);
        if (localized !== key) {
            return localized;
        }

        const english = i18n?.getFixedT
            ? i18n.getFixedT('en')(key)
            : t(key, { lng: 'en' });
        return english !== key ? english : key;
    };
    const pinnedToolKeys = useMemo(() => {
        const keys = collectLayoutKeys(navLayout);
        return new Set(
            Array.from(keys)
                .filter((key) => String(key).startsWith('tool-'))
                .map((key) => String(key).replace(/^tool-/, ''))
        );
    }, [navLayout]);

    useEffect(() => {
        void ensureDashboardsLoaded().catch(() => {});
    }, [ensureDashboardsLoaded]);

    useEffect(() => {
        if (!preferencesHydrated) {
            return undefined;
        }
        let active = true;
        async function loadModel() {
            const model = await loadNavMenuModel({
                dashboards: useDashboardStore.getState().dashboards,
                notificationLayout,
                t: translateWithFallback
            });
            if (!active) {
                return;
            }
            setNavLayout(model.layout);
            setNavHiddenKeys(model.hiddenKeys);
        }

        void loadModel().catch(() => {});
        const handleNavLayoutUpdated = () => {
            void loadModel().catch(() => {});
        };
        window.addEventListener(
            NAV_LAYOUT_UPDATED_EVENT,
            handleNavLayoutUpdated
        );
        return () => {
            active = false;
            window.removeEventListener(
                NAV_LAYOUT_UPDATED_EVENT,
                handleNavLayoutUpdated
            );
        };
    }, [dashboards, notificationLayout, preferencesHydrated, t]);

    async function triggerTool(tool) {
        await triggerToolByKey(tool?.key, {
            navigate,
            t: translateWithFallback
        });
    }

    async function pinToolToNav(tool) {
        if (!tool?.navEligible) {
            return;
        }
        const navKey = `tool-${tool.key}`;
        try {
            const model = await saveNavMenuModel({
                layout: insertToolNavItem(navLayout, navKey),
                hiddenKeys: navHiddenKeys.filter((key) => key !== navKey),
                dashboards: useDashboardStore.getState().dashboards,
                notificationLayout,
                t: translateWithFallback
            });
            setNavLayout(model.layout);
            setNavHiddenKeys(model.hiddenKeys);
            toast.success(translateWithFallback('nav_menu.custom_nav.pinned'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.generated_toast.failed_to_pin_tool_to_navigation')
            );
        }
    }

    async function unpinToolFromNav(tool) {
        if (!tool?.navEligible) {
            return;
        }
        const navKey = `tool-${tool.key}`;
        try {
            const model = await saveNavMenuModel({
                layout: removeToolNavItem(navLayout, navKey),
                hiddenKeys: navHiddenKeys,
                dashboards: useDashboardStore.getState().dashboards,
                notificationLayout,
                t: translateWithFallback
            });
            setNavLayout(model.layout);
            setNavHiddenKeys(model.hiddenKeys);
            toast.success(
                translateWithFallback('nav_menu.custom_nav.unpinned')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('view.tools.generated_toast.failed_to_unpin_tool_from_navigation')
            );
        }
    }

    return (
        <div
            id="chart"
            className="x-container flex h-full min-h-0 flex-1 flex-col overflow-y-auto p-4"
        >
            <div className="options-container">
                <span className="header">
                    {translateWithFallback('view.tools.header')}
                </span>

                <div className="mt-4 px-3">
                    {categories.map((category) => (
                        <div key={category.key} className="mb-4">
                            {(() => {
                                const CategoryIcon =
                                    categoryIconByKey[category.key] ||
                                    WrenchIcon;

                                return (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="mb-2 h-auto justify-start gap-2 px-2.5 py-1.5 text-left"
                                        onClick={() =>
                                            toggleCategoryCollapsed(
                                                category.key
                                            )
                                        }
                                    >
                                        <ChevronDownIcon
                                            aria-hidden="true"
                                            className={cn(
                                                'transition-transform duration-300',
                                                collapsed[category.key]
                                                    ? '-rotate-90'
                                                    : ''
                                            )}
                                        />
                                        <CategoryIcon
                                            aria-hidden="true"
                                            className="text-muted-foreground"
                                        />
                                        <span className="text-sm font-semibold">
                                            {translateWithFallback(
                                                category.labelKey
                                            )}
                                        </span>
                                    </Button>
                                );
                            })()}

                            {!collapsed[category.key] ? (
                                <div className="grid grid-cols-1 gap-2.5 pl-4 lg:grid-cols-2 xl:grid-cols-3">
                                    {category.tools.map((tool) => (
                                        <ToolItem
                                            key={tool.key}
                                            icon={getNavIconComponent(
                                                tool.navIcon,
                                                'lucide:Wrench'
                                            )}
                                            title={translateWithFallback(
                                                tool.titleKey
                                            )}
                                            description={translateWithFallback(
                                                tool.descriptionKey
                                            )}
                                            navEligible={tool.navEligible}
                                            isPinned={pinnedToolKeys.has(
                                                tool.key
                                            )}
                                            pinLabel={translateWithFallback(
                                                'nav_menu.custom_nav.pin_to_nav'
                                            )}
                                            unpinLabel={translateWithFallback(
                                                'nav_menu.custom_nav.unpin_from_nav'
                                            )}
                                            onClick={() => {
                                                void triggerTool(tool);
                                            }}
                                            onPin={() => {
                                                void pinToolToNav(tool);
                                            }}
                                            onUnpin={() => {
                                                void unpinToolFromNav(tool);
                                            }}
                                        />
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
