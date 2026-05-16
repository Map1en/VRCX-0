// @ts-nocheck
import {
    BellIcon,
    CompassIcon,
    CopyIcon,
    MinusIcon,
    PanelLeftIcon,
    PanelLeftOpenIcon,
    PanelRightIcon,
    PanelRightOpenIcon,
    SearchIcon,
    SquareIcon,
    XIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { QuickSearchDialog } from '@/components/sidebar/QuickSearchDialog';
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
import { Kbd, KbdGroup } from '@/ui/shadcn/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { AppMenuBar } from './AppMenuBar';
import { useDirectAccessAction } from './useDirectAccessAction.js';
import { useRightSidePanelVisibility } from './useRightSidePanelVisibility.js';

function TitleBarButton({
    label,
    className,
    children,
    onClick,
    size = 'icon-sm',
    ...props
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size={size}
                    aria-label={label}
                    className={cn(
                        'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
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

function TitleBarWindowButton({ className, ...props }) {
    return (
        <TitleBarButton
            className={cn(
                'text-foreground h-full w-9 rounded-none border-0',
                className
            )}
            {...props}
        />
    );
}

function TitleBarShortcut({ modifierKey, actionKey, className }) {
    return (
        <KbdGroup className={cn('gap-0.5', className)}>
            <Kbd className="bg-background/45 h-3.5 min-w-3.5 rounded-[3px] px-1 text-[9px] leading-3.5 shadow-none">
                {modifierKey}
            </Kbd>
            <Kbd className="bg-background/45 h-3.5 min-w-3.5 rounded-[3px] px-1 text-[9px] leading-3.5 shadow-none">
                {actionKey}
            </Kbd>
        </KbdGroup>
    );
}

function getTitleBarShortcut(isMacHost, actionKey) {
    const modifierKey = isMacHost ? '\u2318' : 'Ctrl';
    const label = isMacHost
        ? `${modifierKey}${actionKey}`
        : `${modifierKey}+${actionKey}`;
    return { modifierKey, actionKey, label };
}

function formatTitleBarShortcutLabel(value, shortcutLabel) {
    return `${value} ${shortcutLabel}`;
}

function TitleBarCommandGroup({
    quickSearchLabel,
    quickSearchShortcut,
    directAccessLabel,
    directAccessShortcut,
    onOpenQuickSearch,
    onOpenDirectAccess
}) {
    return (
        <div className="flex min-w-0 shrink items-center gap-1">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-label={formatTitleBarShortcutLabel(
                            quickSearchLabel,
                            quickSearchShortcut.label
                        )}
                        className="bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground h-6 min-w-7 justify-start rounded-md border-0 px-2 shadow-none min-[640px]:w-44 min-[960px]:w-56"
                        onClick={onOpenQuickSearch}
                    >
                        <SearchIcon data-icon="inline-start" />
                        <span className="hidden min-w-0 truncate min-[640px]:block">
                            {quickSearchLabel}
                        </span>
                        <TitleBarShortcut
                            {...quickSearchShortcut}
                            className="ml-auto hidden min-[760px]:inline-flex"
                        />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    {formatTitleBarShortcutLabel(
                        quickSearchLabel,
                        quickSearchShortcut.label
                    )}
                </TooltipContent>
            </Tooltip>
            <TitleBarButton
                label={formatTitleBarShortcutLabel(
                    directAccessLabel,
                    directAccessShortcut.label
                )}
                className="size-7 min-w-7 rounded-md px-0"
                onClick={onOpenDirectAccess}
            >
                <CompassIcon data-icon="icon" />
            </TitleBarButton>
        </div>
    );
}

export function AppTitleBar() {
    const { t } = useTranslation();
    const location = useLocation();
    const [isMaximized, setIsMaximized] = useState(false);
    const [quickSearchOpen, setQuickSearchOpen] = useState(false);
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
    const hasAvailableUpdate = useRuntimeStore((state) =>
        Boolean(state.updateLoop.hasAvailableUpdate)
    );
    const sidebarOpen = useShellStore((state) => state.sidebarOpen);
    const {
        sidePanelOpen: rightSidebarOpen,
        toggleSidePanelOpen: toggleRightSidebar
    } = useRightSidePanelVisibility(location.pathname);

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
    const leftSidebarLabel = sidebarOpen
        ? t('nav_tooltip.collapse_menu')
        : t('nav_tooltip.expand_menu');
    const rightSidebarLabel = rightSidebarOpen
        ? t('app_menu.hide_side_panel')
        : t('app_menu.show_side_panel');
    const isMacHost = hostPlatform === 'macos';
    const quickSearchShortcut = getTitleBarShortcut(isMacHost, 'K');
    const directAccessShortcut = getTitleBarShortcut(isMacHost, 'D');
    const quickSearchLabel = t('app_menu.quick_search');
    const directAccessLabel = t('prompt.direct_access_omni.header');

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
                          'component.app_title_bar.toast.failed_to_mark_notifications_as_seen'
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
            className="relative size-7 min-w-7 rounded-md px-0"
            onClick={toggleVrcNotificationCenter}
            onContextMenu={
                vrcUnseenNotificationCount > 0
                    ? undefined
                    : (event) => {
                          event.preventDefault();
                          toast.info(
                              t(
                                  'side_panel.notification_center.no_unseen_notifications'
                              )
                          );
                      }
            }
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
                        {t('app.title')}
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
                                rightSidebarOpen={rightSidebarOpen}
                                onOpenQuickSearch={() =>
                                    setQuickSearchOpen(true)
                                }
                                onOpenDirectAccess={() =>
                                    void openDirectAccessFromClipboard()
                                }
                                onOpenNotificationCenter={() =>
                                    openVrcNotificationCenter()
                                }
                                onToggleRightSidebar={toggleRightSidebar}
                            />
                        </div>
                    ) : null}
                    <div
                        data-tauri-drag-region
                        className="h-full min-w-0 flex-1"
                    />
                </div>
                {titleBarActionsVisible ? (
                    <div className="flex h-full min-w-0 shrink-0 items-center gap-1 px-1">
                        {hasAvailableUpdate ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="h-6 gap-1.5 rounded-md px-2 text-xs shadow-none"
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
                        <TitleBarCommandGroup
                            quickSearchLabel={quickSearchLabel}
                            quickSearchShortcut={quickSearchShortcut}
                            directAccessLabel={directAccessLabel}
                            directAccessShortcut={directAccessShortcut}
                            onOpenQuickSearch={() => setQuickSearchOpen(true)}
                            onOpenDirectAccess={() =>
                                void openDirectAccessFromClipboard()
                            }
                        />
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
                                notificationButton
                            )
                        ) : null}
                        <TitleBarButton
                            label={leftSidebarLabel}
                            className="size-7 min-w-7 rounded-md px-0"
                            onClick={() =>
                                void setSidebarCollapsedPreference(sidebarOpen)
                            }
                        >
                            {sidebarOpen ? (
                                <PanelLeftIcon data-icon="icon" />
                            ) : (
                                <PanelLeftOpenIcon data-icon="icon" />
                            )}
                        </TitleBarButton>
                        <TitleBarButton
                            label={rightSidebarLabel}
                            className="size-7 min-w-7 rounded-md px-0"
                            onClick={toggleRightSidebar}
                        >
                            {rightSidebarOpen ? (
                                <PanelRightIcon data-icon="icon" />
                            ) : (
                                <PanelRightOpenIcon data-icon="icon" />
                            )}
                        </TitleBarButton>
                    </div>
                ) : null}
                <div className="flex h-full shrink-0 items-center">
                    <TitleBarWindowButton
                        label={t('app_menu.label.minimize_window')}
                        onClick={() =>
                            void runWindowAction(
                                backend.webview.minimizeWindow,
                                false
                            )
                        }
                    >
                        <MinusIcon data-icon="inline-start" />
                    </TitleBarWindowButton>
                    <TitleBarWindowButton
                        label={maximizeLabel}
                        onClick={() =>
                            void runWindowAction(
                                backend.webview.toggleMaximizeWindow
                            )
                        }
                    >
                        <MaximizeIcon data-icon="inline-start" />
                    </TitleBarWindowButton>
                    <TitleBarWindowButton
                        label={t('app_menu.action.close_window')}
                        className="hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() =>
                            void runWindowAction(
                                backend.webview.closeWindow,
                                false
                            )
                        }
                    >
                        <XIcon data-icon="inline-start" />
                    </TitleBarWindowButton>
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
