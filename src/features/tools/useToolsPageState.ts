import {
    type DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
    loadNavMenuModel,
    NAV_LAYOUT_UPDATED_EVENT,
    saveNavMenuModel,
    type NavLayoutEntry
} from '@/components/layout/navMenuModel';
import configRepository from '@/repositories/configRepository';
import { toast } from '@/services/toastService';
import {
    isToolCapabilityAvailable,
    triggerToolByKey
} from '@/services/toolActionService';
import { getRecentToolKeys } from '@/services/toolRecentService';
import {
    publishToolsQuickAccessUpdated,
    type ToolDefinition
} from '@/shared/constants/tools';
import { useDashboardStore } from '@/state/dashboardStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    collectLayoutKeys,
    getEquivalentToolNavKeys,
    insertToolNavItem,
    knownToolKeys,
    normalizePinnedToolKey,
    normalizeQuickAccessToolKeys,
    parseQuickAccessToolKeys,
    quickAccessConfigKey,
    quickAccessDropId,
    removeToolNavItem,
    toolCatalogDropId,
    toolsPageCategories
} from './toolsPageHelpers';
import { useToolStatusSummaries } from './useToolStatusSummaries';

function useToolsQuickAccessState() {
    const [quickAccessKeys, setQuickAccessKeysState] = useState<string[]>([]);

    useEffect(() => {
        let active = true;
        configRepository
            .getString(quickAccessConfigKey, '[]')
            .then((value) => {
                if (active) {
                    setQuickAccessKeysState(parseQuickAccessToolKeys(value));
                }
            })
            .catch(() => {
                if (active) {
                    setQuickAccessKeysState([]);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    function setQuickAccessKeys(updater: SetStateAction<string[]>) {
        setQuickAccessKeysState((current) => {
            const value =
                typeof updater === 'function' ? updater(current) : updater;
            const nextKeys = normalizeQuickAccessToolKeys(value);
            configRepository
                .setString(quickAccessConfigKey, JSON.stringify(nextKeys))
                .then(() => publishToolsQuickAccessUpdated())
                .catch(() => {});
            return nextKeys;
        });
    }

    return { quickAccessKeys, setQuickAccessKeys };
}

function useRecentTools(availableToolMap: Map<string, ToolDefinition>) {
    const [recentToolKeys, setRecentToolKeys] = useState<string[]>([]);

    useEffect(() => {
        let active = true;
        let requestRevision = 0;
        const loadRecentTools = () => {
            const expectedRevision = ++requestRevision;
            getRecentToolKeys()
                .then((keys) => {
                    if (active && expectedRevision === requestRevision) {
                        setRecentToolKeys(keys);
                    }
                })
                .catch(() => {
                    if (active && expectedRevision === requestRevision) {
                        setRecentToolKeys([]);
                    }
                });
        };
        loadRecentTools();
        return () => {
            active = false;
        };
    }, []);

    return useMemo(
        () =>
            recentToolKeys
                .map((key) => availableToolMap.get(key))
                .filter((tool): tool is ToolDefinition => Boolean(tool)),
        [availableToolMap, recentToolKeys]
    );
}

export function useToolsPageState() {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const hostCapabilities = useRuntimeStore((state) => state.hostCapabilities);
    const dashboards = useDashboardStore((state) => state.dashboards);
    const ensureDashboardsLoaded = useDashboardStore(
        (state) => state.ensureLoaded
    );
    const preferencesHydrated = usePreferencesStore(
        (state) => state.preferencesHydrated
    );
    const notificationLayout = usePreferencesStore(
        (state) => state.notificationLayout
    );
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 6
            }
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    );
    const categories = useMemo(
        () =>
            toolsPageCategories
                .map((category) => ({
                    ...category,
                    tools: category.tools.filter((tool) =>
                        isToolCapabilityAvailable(tool, hostCapabilities)
                    )
                }))
                .filter((category) => category.tools.length > 0),
        [hostCapabilities]
    );
    const availableToolMap = useMemo(
        () =>
            new Map<string, ToolDefinition>(
                categories
                    .flatMap((category) => category.tools)
                    .map((tool) => [tool.key, tool])
            ),
        [categories]
    );
    const { quickAccessKeys, setQuickAccessKeys } = useToolsQuickAccessState();
    const [isQuickAccessEditing, setIsQuickAccessEditing] = useState(false);
    const [navLayout, setNavLayout] = useState<NavLayoutEntry[]>([]);
    const [navHiddenKeys, setNavHiddenKeys] = useState<string[]>([]);
    const pinnedToolKeys = useMemo(() => {
        const keys = collectLayoutKeys(navLayout);
        return new Set(
            Array.from(keys)
                .filter((key) => key.startsWith('tool-'))
                .map((key) => normalizePinnedToolKey(key.replace(/^tool-/, '')))
        );
    }, [navLayout]);
    const quickAccessKeySet = useMemo(
        () => new Set(quickAccessKeys),
        [quickAccessKeys]
    );
    const quickAccessTools = useMemo(
        () =>
            quickAccessKeys
                .map((key) => availableToolMap.get(key))
                .filter((tool): tool is ToolDefinition => Boolean(tool)),
        [availableToolMap, quickAccessKeys]
    );
    const shouldShowQuickAccess =
        isQuickAccessEditing || quickAccessTools.length > 0;
    const recentToolCandidates = useRecentTools(availableToolMap);
    const recentTools = useMemo(
        () =>
            recentToolCandidates.filter(
                (tool) => !quickAccessKeySet.has(tool.key)
            ),
        [quickAccessKeySet, recentToolCandidates]
    );
    const statusByToolKey = useToolStatusSummaries();

    const translateWithFallback = useCallback(
        (key: string) => {
            const localized = t(key);
            if (localized !== key) {
                return localized;
            }

            const english = i18n?.getFixedT
                ? i18n.getFixedT('en')(key)
                : t(key, { lng: 'en' });
            return english !== key ? english : key;
        },
        [i18n, t]
    );

    useEffect(() => {
        ensureDashboardsLoaded().catch(() => {});
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

        loadModel().catch(() => {});
        const handleNavLayoutUpdated = () => {
            loadModel().catch(() => {});
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
    }, [
        dashboards,
        notificationLayout,
        preferencesHydrated,
        translateWithFallback
    ]);

    function addQuickAccessToolByKey(
        toolKey: string,
        beforeToolKey: string = ''
    ) {
        const normalizedToolKey = normalizePinnedToolKey(toolKey);
        const normalizedBeforeToolKey = normalizePinnedToolKey(beforeToolKey);
        setQuickAccessKeys((current) => {
            if (current.includes(normalizedToolKey)) {
                return current;
            }
            const nextKeys = [...current];
            const insertIndex = nextKeys.indexOf(normalizedBeforeToolKey);
            if (insertIndex >= 0) {
                nextKeys.splice(insertIndex, 0, normalizedToolKey);
            } else {
                nextKeys.push(normalizedToolKey);
            }
            return nextKeys;
        });
    }

    function addQuickAccessToolByKeyWithFeedback(toolKey: string) {
        const normalizedToolKey = normalizePinnedToolKey(toolKey);
        if (quickAccessKeySet.has(normalizedToolKey)) {
            toast.add({
                type: 'info',
                title: translateWithFallback(
                    'view.tools.quick_access.already_added'
                )
            });
            return;
        }
        addQuickAccessToolByKey(normalizedToolKey);
    }

    function removeQuickAccessToolByKey(toolKey: string) {
        const normalizedToolKey = normalizePinnedToolKey(toolKey);
        setQuickAccessKeys((current) =>
            current.filter((key) => key !== normalizedToolKey)
        );
    }

    function reorderQuickAccessTool(
        activeToolKey: string,
        overToolKey: string
    ) {
        const normalizedActiveToolKey = normalizePinnedToolKey(activeToolKey);
        const normalizedOverToolKey = normalizePinnedToolKey(overToolKey);
        if (
            !normalizedOverToolKey ||
            normalizedActiveToolKey === normalizedOverToolKey
        ) {
            return;
        }
        setQuickAccessKeys((current) => {
            const oldIndex = current.indexOf(normalizedActiveToolKey);
            const newIndex = current.indexOf(normalizedOverToolKey);
            if (oldIndex < 0 || newIndex < 0) {
                return current;
            }
            return arrayMove(current, oldIndex, newIndex);
        });
    }

    function handleQuickAccessDragEnd({ active, over }: DragEndEvent) {
        const activeData = active?.data?.current;
        const overData = over?.data?.current;
        const activeToolKey = normalizePinnedToolKey(activeData?.toolKey);
        const overToolKey = normalizePinnedToolKey(overData?.toolKey);
        if (!activeToolKey || !knownToolKeys.has(activeToolKey)) {
            return;
        }

        if (
            activeData?.source === 'quick-access' &&
            over?.id === toolCatalogDropId
        ) {
            removeQuickAccessToolByKey(activeToolKey);
            return;
        }

        if (
            over?.id === quickAccessDropId ||
            overData?.source === 'quick-access' ||
            overData?.target === 'quick-access'
        ) {
            if (activeData?.source === 'catalog') {
                addQuickAccessToolByKey(activeToolKey, overToolKey);
                return;
            }
            if (activeData?.source === 'quick-access') {
                reorderQuickAccessTool(activeToolKey, overToolKey);
            }
        }
    }

    async function triggerTool(tool: ToolDefinition) {
        await triggerToolByKey(tool?.key, {
            navigate,
            t: translateWithFallback
        });
    }

    async function pinToolToNav(tool: ToolDefinition) {
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
            toast.add({
                type: 'success',
                title: translateWithFallback('nav_menu.custom_nav.pinned')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_pin_tool_to_navigation')
            });
        }
    }

    async function unpinToolFromNav(tool: ToolDefinition) {
        if (!tool?.navEligible) {
            return;
        }
        const navKey = getEquivalentToolNavKeys(tool.key);
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
            toast.add({
                type: 'success',
                title: translateWithFallback('nav_menu.custom_nav.unpinned')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.tools.toast.failed_to_unpin_tool_from_navigation'
                          )
            });
        }
    }

    return {
        addQuickAccessToolByKeyWithFeedback,
        categories,
        handleQuickAccessDragEnd,
        isQuickAccessEditing,
        pinToolToNav,
        pinnedToolKeys,
        quickAccessKeySet,
        quickAccessTools,
        recentTools,
        removeQuickAccessToolByKey,
        sensors,
        setIsQuickAccessEditing,
        shouldShowQuickAccess,
        statusByToolKey,
        triggerTool,
        unpinToolFromNav
    };
}
