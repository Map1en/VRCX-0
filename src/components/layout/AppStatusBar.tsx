import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { STATUS_BAR_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import { loadPreferenceSnapshot } from '@/services/preferencesService';
import { proxySettingsErrorMessage } from '@/services/proxySettingsService';
import { toast } from '@/services/toastService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { ContextMenu, ContextMenuTrigger } from '@/ui/shadcn/context-menu';

import { MutualGraphRunToasts } from './status-bar/BackgroundTaskSegments';
import {
    createDefaultClocks,
    parseClockOffset
} from './status-bar/statusBarClocks';
import { StatusBarContextMenuContent } from './status-bar/StatusBarContextMenuContent';
import { StatusBarFooter } from './status-bar/StatusBarFooter';
import type {
    StatusBarVisibility,
    StatusBarVisibilityKey
} from './status-bar/statusBarTypes';
import { ZoomLevelQueueSync } from './status-bar/ZoomSegment';

const DEFAULT_VISIBILITY: StatusBarVisibility = {
    vrchat: true,
    steamvr: true,
    proxy: true,
    ws: true,
    instanceQueue: true,
    nowPlaying: true,
    uptime: false,
    zoom: true,
    clocks: true,
    servers: true
};

export function AppStatusBar({
    className,
    sidebarWindowMode = false
}: {
    className?: string;
    sidebarWindowMode?: boolean;
}) {
    const { t } = useTranslation();
    const [appStartedAt] = useState(Date.now);
    const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
    const [clocks, setClocks] = useState(() => createDefaultClocks());
    const [clockCount, setClockCount] = useState(1);
    const [proxyEditorOpen, setProxyEditorOpen] = useState(false);
    const visibleClocks = clocks.slice(
        0,
        Math.max(0, Math.min(3, Number(clockCount) || 0))
    );

    useEffect(() => {
        let active = true;

        Promise.all([
            configRepository.getString(STATUS_BAR_CONFIG_KEYS.visibility, null),
            configRepository.getString(STATUS_BAR_CONFIG_KEYS.clocks, null),
            configRepository.getString(STATUS_BAR_CONFIG_KEYS.clockCount, null)
        ])
            .then(([savedVisibility, savedClocks, savedClockCount]) => {
                if (!active) {
                    return;
                }

                if (savedVisibility) {
                    try {
                        setVisibility({
                            ...DEFAULT_VISIBILITY,
                            ...JSON.parse(savedVisibility)
                        });
                    } catch {
                        setVisibility(DEFAULT_VISIBILITY);
                    }
                }

                if (savedClocks) {
                    try {
                        const parsed = JSON.parse(savedClocks);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            const defaults = createDefaultClocks();
                            const nextClocks = defaults.map(
                                (defaultClock, index) => {
                                    const entry = parsed[index];
                                    return entry
                                        ? { offset: parseClockOffset(entry) }
                                        : defaultClock;
                                }
                            );
                            setClocks(nextClocks);
                        }
                    } catch {
                        // no-op
                    }
                }

                if (savedClockCount !== null) {
                    const parsedClockCount = Number(savedClockCount);
                    if (parsedClockCount >= 0 && parsedClockCount <= 3) {
                        setClockCount(parsedClockCount);
                    }
                }
            })
            .catch(() => {});

        return () => {
            active = false;
        };
    }, []);

    function persistVisibility(nextVisibility: StatusBarVisibility) {
        setVisibility(nextVisibility);
        configRepository
            .setString(
                STATUS_BAR_CONFIG_KEYS.visibility,
                JSON.stringify(nextVisibility)
            )
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'component.app_status_bar.toast.failed_to_save_status_bar_visibility'
                              )
                });
            });
    }

    function toggleVisibility(key: StatusBarVisibilityKey, checked: boolean) {
        const nextVisibility: StatusBarVisibility = {
            ...visibility,
            [key]: Boolean(checked)
        };
        persistVisibility(nextVisibility);
    }

    function setClockCountValue(nextValue: number) {
        const parsed = Math.max(0, Math.min(3, Number(nextValue) || 0));
        setClockCount(parsed);
        if (parsed > 0 && !visibility.clocks) {
            persistVisibility({
                ...visibility,
                clocks: true
            });
        }
        configRepository
            .setString(STATUS_BAR_CONFIG_KEYS.clockCount, String(parsed))
            .catch((error: unknown) => {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : t(
                                  'component.app_status_bar.toast.failed_to_save_clock_count'
                              )
                });
            });
    }

    function updateClockTimezone(index: number, offsetValue: string | null) {
        setClocks((current) => {
            const defaults = createDefaultClocks();
            const nextClocks = defaults.map(
                (defaultClock, clockIndex) =>
                    current[clockIndex] ?? defaultClock
            );
            nextClocks[index] = { offset: parseClockOffset(offsetValue) };
            configRepository
                .setString(
                    STATUS_BAR_CONFIG_KEYS.clocks,
                    JSON.stringify(nextClocks)
                )
                .catch((error: unknown) => {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : t(
                                      'component.app_status_bar.toast.failed_to_save_status_bar_clocks'
                                  )
                    });
                });
            return nextClocks;
        });
    }

    async function openProxyEditor() {
        if (!usePreferencesStore.getState().preferencesHydrated) {
            await loadPreferenceSnapshot();
        }
        setProxyEditorOpen(true);
    }

    function openProxyEditorWithToast() {
        openProxyEditor().catch((error: unknown) => {
            toast.add({
                type: 'error',
                title:
                    proxySettingsErrorMessage(error) ||
                    t(
                        'component.app_status_bar.toast.failed_to_update_proxy_settings'
                    )
            });
        });
    }

    function setProxyEditorOpenValue(open: boolean) {
        if (!open) {
            setProxyEditorOpen(false);
            return;
        }
        openProxyEditorWithToast();
    }

    const footerProps = {
        appStartedAt,
        className,
        clocks: visibleClocks,
        proxyEditorOpen,
        visibility,
        onProxyEditorOpenChange: setProxyEditorOpenValue,
        onUpdateClockTimezone: updateClockTimezone
    };

    if (sidebarWindowMode) {
        return (
            <>
                <StatusBarFooter {...footerProps} sidebarWindowMode />
                <MutualGraphRunToasts />
                <ZoomLevelQueueSync />
            </>
        );
    }

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger
                    render={<StatusBarFooter {...footerProps} />}
                />
                <StatusBarContextMenuContent
                    clockCount={clockCount}
                    onOpenProxySettings={openProxyEditorWithToast}
                    onSetClockCountValue={setClockCountValue}
                    onToggleVisibility={toggleVisibility}
                    visibility={visibility}
                />
            </ContextMenu>
            <MutualGraphRunToasts />
            <ZoomLevelQueueSync />
        </>
    );
}
