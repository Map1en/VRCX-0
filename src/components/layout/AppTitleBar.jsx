import {
    BellIcon,
    CompassIcon,
    CopyIcon,
    MinusIcon,
    PanelLeftCloseIcon,
    PanelLeftOpenIcon,
    PanelRightCloseIcon,
    PanelRightOpenIcon,
    SearchIcon,
    SquareIcon,
    XIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { QuickSearchDialog } from '@/components/sidebar/QuickSearchDialog.jsx';
import { cn } from '@/lib/utils.js';
import { backend } from '@/platform/index.js';
import { setSidebarCollapsedPreference } from '@/services/preferencesService.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { useShellStore } from '@/state/shellStore.js';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { AppMenuBar } from './AppMenuBar.jsx';
import { shouldShowSidePanel } from './sidePanelRoutes.js';
import { useDirectAccessAction } from './useDirectAccessAction.js';

const UPDATE_EXE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_EXE_CHECK_RETRY_MS = 5 * 60 * 1000;

function TitleBarButton({ label, className, children, onClick, ...props }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={label}
                    className={cn(
                        'h-full w-9 rounded-none border-0',
                        className
                    )}
                    onClick={onClick}
                    {...props}
                >
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function TitleBarShortcutKey({ children }) {
    return (
        <kbd className="text-muted-foreground rounded border px-1 font-sans text-[10px] leading-4">
            {children}
        </kbd>
    );
}

export function AppTitleBar() {
    const { t } = useTranslation();
    const location = useLocation();
    const [isMaximized, setIsMaximized] = useState(false);
    const [quickSearchOpen, setQuickSearchOpen] = useState(false);
    const [hasPendingUpdate, setHasPendingUpdate] = useState(false);
    const { openDirectAccessFromClipboard } = useDirectAccessAction();
    const isSessionReady = useSessionStore(
        (state) => state.sessionPhase === 'ready'
    );
    const notificationLayout = usePreferencesStore(
        (state) => state.notificationLayout
    );
    const vrcUnseenNotificationCount = useVrcNotificationStore(
        (state) => state.unseenCount
    );
    const isVrcNotificationCenterOpen = useVrcNotificationStore(
        (state) => state.isCenterOpen
    );
    const openVrcNotificationCenter = useVrcNotificationStore(
        (state) => state.openCenter
    );
    const setVrcNotificationCenterOpen = useVrcNotificationStore(
        (state) => state.setCenterOpen
    );
    const markAllVrcNotificationsSeen = useVrcNotificationStore(
        (state) => state.markAllSeen
    );
    const removeNavNotification = useShellStore((state) => state.removeNotify);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const sidebarOpen = useShellStore((state) => state.sidebarOpen);
    const rightSidebarOpen = useShellStore((state) => state.rightSidebarOpen);
    const toggleRightSidebar = useShellStore(
        (state) => state.toggleRightSidebar
    );

    async function syncMaximizedState() {
        try {
            setIsMaximized(Boolean(await backend.webview.isWindowMaximized()));
        } catch {
            setIsMaximized(false);
        }
    }

    useEffect(() => {
        void syncMaximizedState();
        window.addEventListener('resize', syncMaximizedState);
        return () => {
            window.removeEventListener('resize', syncMaximizedState);
        };
    }, []);

    useEffect(() => {
        if (!isSessionReady) {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }

            const key = event.key.toLowerCase();
            if (key === 'k') {
                event.preventDefault();
                setQuickSearchOpen(true);
                return;
            }
            if (key === 'd') {
                event.preventDefault();
                void openDirectAccessFromClipboard();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSessionReady, openDirectAccessFromClipboard]);

    useEffect(() => {
        if (!isSessionReady || hostPlatform !== 'windows') {
            setHasPendingUpdate(false);
            return undefined;
        }

        let active = true;
        let checking = false;
        let lastPendingUpdateCheckAt = 0;
        let lastPendingUpdateFailureAt = 0;
        const refreshPendingUpdate = ({ force = false } = {}) => {
            const now = Date.now();
            if (
                checking ||
                (!force &&
                    (now - lastPendingUpdateCheckAt <
                        UPDATE_EXE_CHECK_INTERVAL_MS ||
                        now - lastPendingUpdateFailureAt <
                            UPDATE_EXE_CHECK_RETRY_MS))
            ) {
                return;
            }

            checking = true;
            backend.app
                .CheckForUpdateExe()
                .then((value) => {
                    lastPendingUpdateCheckAt = Date.now();
                    lastPendingUpdateFailureAt = 0;
                    if (active) {
                        setHasPendingUpdate(Boolean(value));
                    }
                })
                .catch(() => {
                    lastPendingUpdateFailureAt = Date.now();
                })
                .finally(() => {
                    checking = false;
                });
        };

        refreshPendingUpdate({ force: true });
        const intervalId = window.setInterval(
            refreshPendingUpdate,
            UPDATE_EXE_CHECK_INTERVAL_MS
        );
        window.addEventListener('focus', refreshPendingUpdate);
        return () => {
            active = false;
            window.clearInterval(intervalId);
            window.removeEventListener('focus', refreshPendingUpdate);
        };
    }, [hostPlatform, isSessionReady]);

    async function runWindowAction(action, shouldSync = true) {
        try {
            await action();
            if (shouldSync) {
                await syncMaximizedState();
            }
        } catch (error) {
            console.warn('Window control action failed:', error);
        }
    }

    const MaximizeIcon = isMaximized ? CopyIcon : SquareIcon;
    const maximizeLabel = isMaximized ? 'Restore window' : 'Maximize window';
    const titleBarActionsVisible = isSessionReady;
    const notificationActionVisible =
        titleBarActionsVisible && notificationLayout !== 'table';
    const rightSidebarActionVisible =
        titleBarActionsVisible && shouldShowSidePanel(location.pathname);
    const RightSidebarIcon = rightSidebarOpen
        ? PanelRightCloseIcon
        : PanelRightOpenIcon;
    const LeftSidebarIcon = sidebarOpen
        ? PanelLeftCloseIcon
        : PanelLeftOpenIcon;
    const leftSidebarLabel = sidebarOpen
        ? t('nav_tooltip.collapse_menu')
        : t('nav_tooltip.expand_menu');
    const rightSidebarLabel = rightSidebarOpen
        ? 'Collapse right sidebar'
        : 'Expand right sidebar';

    async function markAllNotificationsRead() {
        const store = useVrcNotificationStore.getState();
        if (!store.unseenCount) {
            removeNavNotification('notification');
            return;
        }

        try {
            await markAllVrcNotificationsSeen();
            removeNavNotification('notification');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'component.app_title_bar.generated_toast.failed_to_mark_notifications_as_seen'
                      )
            );
        }
    }

    function toggleVrcNotificationCenter() {
        setVrcNotificationCenterOpen(!isVrcNotificationCenterOpen);
    }

    const notificationButton = (
        <TitleBarButton
            label={t('side_panel.notification_center.title')}
            className="relative h-full w-9 rounded-none"
            onClick={toggleVrcNotificationCenter}
        >
            <BellIcon data-icon="icon" />
            {vrcUnseenNotificationCount > 0 ? (
                <Badge className="absolute top-0.5 right-1 h-3 min-w-3 rounded-full px-0.5 py-0 text-[7px] leading-none">
                    {vrcUnseenNotificationCount > 99
                        ? '99+'
                        : vrcUnseenNotificationCount}
                </Badge>
            ) : null}
        </TitleBarButton>
    );

    return (
        <>
            <header
                data-app-titlebar="true"
                className="bg-background text-foreground pointer-events-auto relative z-[60] flex h-8 shrink-0 items-center border-b select-none"
            >
                <div
                    data-tauri-drag-region
                    className="flex h-full min-w-0 flex-1 items-center gap-2 px-3"
                >
                    <span
                        data-tauri-drag-region
                        className="text-foreground shrink-0 text-xs font-semibold"
                    >
                        {t(
                            'view.settings.advanced.advanced.vrcx_settings.header'
                        )}
                    </span>
                    {titleBarActionsVisible ? (
                        <div
                            data-titlebar-interactive="true"
                            className="h-full shrink-0"
                            onMouseDown={(event) => {
                                event.stopPropagation();
                            }}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                            }}
                        >
                            <AppMenuBar
                                rightSidebarVisible={rightSidebarActionVisible}
                                rightSidebarOpen={rightSidebarOpen}
                                onOpenQuickSearch={() =>
                                    setQuickSearchOpen(true)
                                }
                                onOpenNotificationCenter={() =>
                                    openVrcNotificationCenter()
                                }
                                onToggleRightSidebar={() =>
                                    toggleRightSidebar()
                                }
                            />
                        </div>
                    ) : null}
                    <div
                        data-tauri-drag-region
                        className="h-full min-w-0 flex-1"
                    />
                </div>
                {titleBarActionsVisible ? (
                    <div className="flex h-full shrink-0 items-center">
                        {hasPendingUpdate ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="mx-1 h-6 gap-1.5 rounded-sm px-2 text-xs"
                                        onClick={() =>
                                            setSystemHostOpen(
                                                'updaterOpen',
                                                true
                                            )
                                        }
                                    >
                                        {t('nav_menu.update')}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {t('nav_menu.update')}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                        <TitleBarButton
                            label={t(
                                'component.app_title_bar.generated_dynamic.value_ctrl_k',
                                { value: t('side_panel.search_placeholder') }
                            )}
                            className="w-auto gap-1.5 px-2"
                            onClick={() => setQuickSearchOpen(true)}
                        >
                            <SearchIcon data-icon="inline-start" />
                            <TitleBarShortcutKey>Ctrl</TitleBarShortcutKey>
                            <TitleBarShortcutKey>K</TitleBarShortcutKey>
                        </TitleBarButton>
                        <TitleBarButton
                            label={t(
                                'component.app_title_bar.generated_dynamic.value_ctrl_d',
                                { value: t('prompt.direct_access_omni.header') }
                            )}
                            className="w-auto gap-1.5 px-2"
                            onClick={() => void openDirectAccessFromClipboard()}
                        >
                            <CompassIcon data-icon="inline-start" />
                            <TitleBarShortcutKey>Ctrl</TitleBarShortcutKey>
                            <TitleBarShortcutKey>D</TitleBarShortcutKey>
                        </TitleBarButton>
                        {notificationActionVisible ? (
                            vrcUnseenNotificationCount > 0 ? (
                                <ContextMenu>
                                    <ContextMenuTrigger asChild>
                                        {notificationButton}
                                    </ContextMenuTrigger>
                                    <ContextMenuContent className="w-48">
                                        <ContextMenuGroup>
                                            <ContextMenuItem
                                                onSelect={() =>
                                                    void markAllNotificationsRead()
                                                }
                                            >
                                                {t('nav_menu.mark_all_read')}
                                            </ContextMenuItem>
                                        </ContextMenuGroup>
                                    </ContextMenuContent>
                                </ContextMenu>
                            ) : (
                                <div
                                    className="h-full"
                                    onContextMenu={(event) => {
                                        event.preventDefault();
                                        toast.info(
                                            t(
                                                'side_panel.notification_center.no_unseen_notifications'
                                            )
                                        );
                                    }}
                                >
                                    {notificationButton}
                                </div>
                            )
                        ) : null}
                        {rightSidebarActionVisible ? (
                            <TitleBarButton
                                label={leftSidebarLabel}
                                onClick={() =>
                                    void setSidebarCollapsedPreference(
                                        sidebarOpen
                                    )
                                }
                            >
                                <LeftSidebarIcon data-icon="icon" />
                            </TitleBarButton>
                        ) : null}
                        {rightSidebarActionVisible ? (
                            <TitleBarButton
                                label={rightSidebarLabel}
                                onClick={() => toggleRightSidebar()}
                            >
                                <RightSidebarIcon data-icon="icon" />
                            </TitleBarButton>
                        ) : null}
                    </div>
                ) : null}
                <div className="flex h-full shrink-0 items-center">
                    <TitleBarButton
                        label={t('app_menu.generated.minimize_window')}
                        onClick={() =>
                            void runWindowAction(
                                backend.webview.minimizeWindow,
                                false
                            )
                        }
                    >
                        <MinusIcon data-icon="inline-start" />
                    </TitleBarButton>
                    <TitleBarButton
                        label={maximizeLabel}
                        onClick={() =>
                            void runWindowAction(
                                backend.webview.toggleMaximizeWindow
                            )
                        }
                    >
                        <MaximizeIcon data-icon="inline-start" />
                    </TitleBarButton>
                    <TitleBarButton
                        label={t('app_menu.generated.close_window')}
                        className="hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() =>
                            void runWindowAction(
                                backend.webview.closeWindow,
                                false
                            )
                        }
                    >
                        <XIcon data-icon="inline-start" />
                    </TitleBarButton>
                </div>
            </header>
            {titleBarActionsVisible ? (
                <QuickSearchDialog
                    open={quickSearchOpen}
                    onOpenChange={setQuickSearchOpen}
                />
            ) : null}
        </>
    );
}
