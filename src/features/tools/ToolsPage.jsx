import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/utils.js';
import { configRepository } from '@/repositories/index.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { useI18n } from '@/app/hooks/use-i18n.js';
import { getToolsByCategory, toolCategories } from '@/shared/constants/tools.js';
import { triggerToolByKey } from '@/services/toolActionService.js';
import { useDashboardStore } from '@/state/dashboardStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { loadNavMenuModel, NAV_LAYOUT_UPDATED_EVENT, saveNavMenuModel } from '@/components/layout/navMenuModel.js';

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

function ToolItem({ icon, title, description, pinLabel, unpinLabel, navEligible, isPinned, onClick, onPin, onUnpin }) {
    return (
        <div
            role="button"
            tabIndex={0}
            className="group flex cursor-pointer gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50"
            onClick={onClick}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) {
                    return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onClick?.();
                }
            }}>
            <div className="flex size-10 flex-none items-center justify-center bg-transparent">
                <i className={cn(icon, 'inline-flex items-center justify-center text-2xl')} />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 font-medium">{title}</div>
                    {navEligible ? (
                        <Button
                            type="button"
                            size="icon-xs"
                            variant={isPinned ? 'secondary' : 'ghost'}
                            className="opacity-0 transition-opacity group-hover:opacity-100"
                            title={isPinned ? unpinLabel : pinLabel}
                            aria-label={isPinned ? unpinLabel : pinLabel}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (isPinned) {
                                    onUnpin?.();
                                } else {
                                    onPin?.();
                                }
                            }}>
                            <span className="relative inline-flex size-4">
                                <i className="ri-side-bar-line inline-flex size-4 items-center justify-center text-base" />
                                <span className="absolute -top-1 -right-1 grid size-2.5 place-items-center rounded-full bg-background shadow-sm">
                                    <i
                                        className={cn(
                                            isPinned ? 'ri-subtract-line' : 'ri-add-line',
                                            'inline-flex size-2 items-center justify-center text-[10px]'
                                        )}
                                    />
                                </span>
                            </span>
                        </Button>
                    ) : null}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}

function collectLayoutKeys(layout) {
    const keys = new Set();
    for (const entry of layout || []) {
        if (entry.type === 'item' && entry.key) {
            keys.add(entry.key);
        } else if (entry.type === 'folder') {
            for (const key of entry.items || []) {
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
        (entry) => entry.type === 'item' && (entry.key === 'tools' || entry.key === 'direct-access')
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
                const nextItems = (entry.items || []).filter((key) => key !== navKey);
                return nextItems.length ? { ...entry, items: nextItems } : null;
            }
            return entry;
        })
        .filter(Boolean);
}

export function ToolsPage() {
    const navigate = useNavigate();
    const { t, i18n } = useI18n();
    const dashboards = useDashboardStore((state) => state.dashboards);
    const ensureDashboardsLoaded = useDashboardStore((state) => state.ensureLoaded);
    const categories = useMemo(
        () =>
            toolCategories
                .filter((category) => collapsibleCategories.includes(category.key))
                .map((category) => ({
                    ...category,
                    tools: getToolsByCategory(category.key)
                })),
        []
    );
    const [collapsed, setCollapsed] = useState({
        ...defaultCollapsedState
    });
    const [navLayout, setNavLayout] = useState([]);
    const [navHiddenKeys, setNavHiddenKeys] = useState([]);
    const preferencesHydrated = usePreferencesStore((state) => state.preferencesHydrated);
    const notificationLayout = usePreferencesStore((state) => state.notificationLayout);
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
        window.addEventListener(NAV_LAYOUT_UPDATED_EVENT, handleNavLayoutUpdated);
        return () => {
            active = false;
            window.removeEventListener(NAV_LAYOUT_UPDATED_EVENT, handleNavLayoutUpdated);
        };
    }, [dashboards, notificationLayout, preferencesHydrated, t]);

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

    function saveCollapsedState(nextState) {
        setCollapsed(nextState);
        void configRepository.setString(configKey, JSON.stringify(nextState));
    }

    async function triggerTool(tool) {
        await triggerToolByKey(tool?.key, { navigate, t: translateWithFallback });
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
            toast.error(error instanceof Error ? error.message : 'Failed to pin tool to navigation.');
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
            toast.success(translateWithFallback('nav_menu.custom_nav.unpinned'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to unpin tool from navigation.');
        }
    }

    return (
        <div id="chart" className="x-container flex flex-1 flex-col p-6">
            <div className="options-container">
                <span className="header">{translateWithFallback('view.tools.header')}</span>

                <div className="mt-5 px-5">
                    {categories.map((category) => (
                        <div key={category.key} className="mb-6">
                            <button
                                type="button"
                                className="mb-3 flex cursor-pointer items-center rounded-lg p-2 px-3 text-left transition-all duration-200 ease-in-out"
                                onClick={() =>
                                    saveCollapsedState({
                                        ...collapsed,
                                        [category.key]: !collapsed[category.key]
                                    })
                                }>
                                <i
                                    className={cn(
                                        'ri-arrow-down-s-line mr-2 text-sm transition-transform duration-300',
                                        collapsed[category.key] ? '-rotate-90' : ''
                                    )}
                                />
                                <span className="ml-1.5 text-base font-semibold">
                                    {translateWithFallback(category.labelKey)}
                                </span>
                            </button>

                            {!collapsed[category.key] ? (
                                <div className="ml-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    {category.tools.map((tool) => (
                                        <ToolItem
                                            key={tool.key}
                                            icon={tool.navIcon}
                                            title={translateWithFallback(tool.titleKey)}
                                            description={translateWithFallback(tool.descriptionKey)}
                                            navEligible={tool.navEligible}
                                            isPinned={pinnedToolKeys.has(tool.key)}
                                            pinLabel={translateWithFallback('nav_menu.custom_nav.pin_to_nav')}
                                            unpinLabel={translateWithFallback('nav_menu.custom_nav.unpin_from_nav')}
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
