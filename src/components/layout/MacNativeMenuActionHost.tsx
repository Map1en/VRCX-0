import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { AboutVrcxDialog } from '@/components/about/AboutDialog';
import { useDirectAccessAction } from '@/components/layout/directAccessAction';
import { useRightSidePanelVisibility } from '@/components/layout/useRightSidePanelVisibility';
import { QuickSearchDialog } from '@/components/sidebar/QuickSearchDialog';
import { OpenSourceNoticeDialog } from '@/features/settings/components/OpenSourceNoticeDialog';
import { commands } from '@/platform/tauri/bindings';
import { tauriEvents } from '@/platform/tauri/events';
import { logoutFromReactShell } from '@/services/authExecutionService';
import { startBackgroundModeForCurrentSession } from '@/services/backgroundModeService';
import { openExternalLink } from '@/services/entityMediaService';
import {
    setNavbarCollapsedPreference,
    setZoomLevelPreference
} from '@/services/preferencesService';
import {
    exitApplication,
    restartApplication
} from '@/services/shellIntegrationService';
import { normalizeZoomLevel } from '@/services/themeService';
import { links } from '@/shared/constants/link';
import { publishNavCustomizeRequested } from '@/shared/events/navLayoutEvents';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';

const MAC_NATIVE_MENU_ACTION_EVENT = 'macNativeMenuAction';
const ZOOM_STEP = 10;

function readMenuAction(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const action = (payload as { action?: unknown }).action;
    return typeof action === 'string' ? action : '';
}

export function MacNativeMenuActionHost() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const [quickSearchOpen, setQuickSearchOpen] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    const [openSourceNoticeOpen, setOpenSourceNoticeOpen] = useState(false);
    const { openDirectAccessFromClipboard } = useDirectAccessAction();
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const sessionReady = useSessionStore(
        (state) => state.sessionPhase === 'ready'
    );
    const notificationLayout = usePreferencesStore(
        (state) => state.notificationLayout
    );
    const openVrcNotificationCenter = useVrcNotificationStore(
        (state) => state.openCenter
    );
    const navbarOpen = useShellStore((state) => state.sidebarOpen);
    const zoomLevel = useShellStore((state) => state.zoomLevel);
    const { toggleSidePanelOpen: toggleFriendsSidebar } =
        useRightSidePanelVisibility(location.pathname);
    const currentZoom = normalizeZoomLevel(zoomLevel);

    const applyZoomLevel = useCallback(
        async (nextZoom: number) => {
            try {
                await setZoomLevelPreference(nextZoom);
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('app_menu.messages.zoom_failed')
                );
            }
        },
        [t]
    );

    const runRestartApplication = useCallback(async () => {
        try {
            await restartApplication();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.restart_failed')
            );
        }
    }, [t]);

    const runStartBackgroundMode = useCallback(async () => {
        try {
            await startBackgroundModeForCurrentSession();
        } catch {
            toast.error(
                t(
                    'component.app_status_bar.toast.failed_to_start_background_mode'
                )
            );
        }
    }, [t]);

    const runLogout = useCallback(async () => {
        try {
            await logoutFromReactShell();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.logout_failed')
            );
        }
    }, [t]);

    const runOpenDevtools = useCallback(async () => {
        try {
            await commands.appOpenDevtools();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('app_menu.messages.open_devtools_failed')
            );
        }
    }, [t]);

    const openNotificationSurface = useCallback(() => {
        if (notificationLayout === 'table') {
            navigate('/notification');
            return;
        }
        openVrcNotificationCenter();
    }, [navigate, notificationLayout, openVrcNotificationCenter]);

    const handleMenuAction = useCallback(
        (payload: unknown) => {
            const action = readMenuAction(payload);
            const protectedAction =
                action !== 'quit' &&
                action !== 'restart' &&
                action !== 'github' &&
                action !== 'report-issue' &&
                action !== 'discord' &&
                action !== 'qq-group' &&
                action !== 'changelog' &&
                action !== 'keyboard-shortcuts' &&
                action !== 'about' &&
                action !== 'open-devtools';

            if (protectedAction && !sessionReady) {
                return;
            }

            switch (action) {
                case 'settings':
                    navigate('/settings');
                    break;
                case 'check-updates':
                    setSystemHostOpen('updaterOpen', true);
                    break;
                case 'restart':
                    runRestartApplication();
                    break;
                case 'start-background-mode':
                    runStartBackgroundMode();
                    break;
                case 'logout':
                    runLogout();
                    break;
                case 'quit':
                    exitApplication();
                    break;
                case 'notification-center':
                    openNotificationSurface();
                    break;
                case 'quick-search':
                    setQuickSearchOpen(true);
                    break;
                case 'direct-access':
                    openDirectAccessFromClipboard();
                    break;
                case 'toggle-nav':
                    setNavbarCollapsedPreference(navbarOpen);
                    break;
                case 'toggle-friends-sidebar':
                    toggleFriendsSidebar();
                    break;
                case 'custom-nav':
                    publishNavCustomizeRequested();
                    break;
                case 'themes':
                    navigate('/themes');
                    break;
                case 'zoom-in':
                    applyZoomLevel(currentZoom + ZOOM_STEP);
                    break;
                case 'zoom-out':
                    applyZoomLevel(currentZoom - ZOOM_STEP);
                    break;
                case 'reset-zoom':
                    applyZoomLevel(100);
                    break;
                case 'tools':
                    navigate('/tools');
                    break;
                case 'github':
                    openExternalLink(links.github);
                    break;
                case 'report-issue':
                    openExternalLink(links.issues);
                    break;
                case 'discord':
                    openExternalLink(links.discord);
                    break;
                case 'qq-group':
                    openExternalLink(links.qqGroup);
                    break;
                case 'changelog':
                    openExternalLink(links.releases);
                    break;
                case 'keyboard-shortcuts':
                    setSystemHostOpen('keyboardShortcutsOpen', true);
                    break;
                case 'open-devtools':
                    runOpenDevtools();
                    break;
                case 'about':
                    setAboutOpen(true);
                    break;
                default:
                    break;
            }
        },
        [
            applyZoomLevel,
            currentZoom,
            navigate,
            openDirectAccessFromClipboard,
            openNotificationSurface,
            runLogout,
            runOpenDevtools,
            runRestartApplication,
            runStartBackgroundMode,
            sessionReady,
            setSystemHostOpen,
            navbarOpen,
            toggleFriendsSidebar
        ]
    );

    useEffect(() => {
        if (hostPlatform !== 'macos') {
            return undefined;
        }

        let disposed = false;
        let cleanup: (() => void) | null = null;
        tauriEvents
            .on(MAC_NATIVE_MENU_ACTION_EVENT, handleMenuAction)
            .then((unlisten) => {
                if (disposed) {
                    unlisten();
                    return;
                }
                cleanup = unlisten;
            })
            .catch((error) => {
                console.warn(
                    'Unable to subscribe to macOS native menu:',
                    error
                );
            });

        return () => {
            disposed = true;
            cleanup?.();
        };
    }, [handleMenuAction, hostPlatform]);

    if (hostPlatform !== 'macos') {
        return null;
    }

    return (
        <>
            {sessionReady ? (
                <QuickSearchDialog
                    open={quickSearchOpen}
                    onOpenChange={setQuickSearchOpen}
                />
            ) : null}
            <OpenSourceNoticeDialog
                open={openSourceNoticeOpen}
                onOpenChange={setOpenSourceNoticeOpen}
            />
            <AboutVrcxDialog
                open={aboutOpen}
                onOpenChange={setAboutOpen}
                onOpenLicenses={() => {
                    setAboutOpen(false);
                    setOpenSourceNoticeOpen(true);
                }}
            />
        </>
    );
}
