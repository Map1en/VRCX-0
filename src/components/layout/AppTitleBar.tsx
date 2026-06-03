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
import { cn } from '@/lib/utils';
import { setSidebarCollapsedPreference } from '@/services/preferencesService';
import {
    closeWindow,
    isWindowMaximized,
    minimizeWindow,
    toggleMaximizeWindow
} from '@/services/shellIntegrationService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';
import { useShellStore } from '@/state/shellStore';
import { useVrcNotificationStore } from '@/state/vrcNotificationStore';
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
import { TitleBarUpdateButton } from './TitleBarUpdateButton';
import { useDirectAccessAction } from './directAccessAction';
import { useRightSidePanelVisibility } from './useRightSidePanelVisibility';

function TitleBarButton({
    label,
    className,
    children,
    onClick,
    size = 'icon-sm',
    ...props
}: any) {
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

function TitleBarWindowButton({ className, ...props }: any) {
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

function TitleBarShortcut({ modifierKey, actionKey, className }: any) {
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

function getTitleBarShortcut(isMacHost: any, actionKey: any) {
    const modifierKey = isMacHost ? '\u2318' : 'Ctrl';
    const label = isMacHost
        ? `${modifierKey}${actionKey}`
        : `${modifierKey}+${actionKey}`;
    return { modifierKey, actionKey, label };
}

function formatTitleBarShortcutLabel(value: any, shortcutLabel: any) {
    return `${value} ${shortcutLabel}`;
}

function TitleBarCommandGroup({
    quickSearchLabel,
    quickSearchShortcut,
    directAccessLabel,
    directAccessShortcut,
    onOpenQuickSearch,
    onOpenDirectAccess
}: any) {
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
        (state: any) => state.sessionPhase === 'ready'
    );
    const notificationLayout = usePreferencesStore(
        (state: any) => state.notificationLayout
    );
    const vrcUnseenNotificationCount = useVrcNotificationStore(
        (state: any) => state.unseenCount
    );
    const isVrcNotificationCenterOpen = useVrcNotificationStore(
        (state: any) => state.isCenterOpen
    );
    const openVrcNotificationCenter = useVrcNotificationStore(
        (state: any) => state.openCenter
    );
    const setVrcNotificationCenterOpen = useVrcNotificationStore(
        (state: any) => state.setCenterOpen
    );
    const markAllVrcNotificationsSeen = useVrcNotificationStore(
        (state: any) => state.markAllSeen
    );
    const removeNavNotification = useShellStore(
        (state: any) => state.removeNotify
    );
    const setSystemHostOpen = useRuntimeStore(
        (state: any) => state.setSystemHostOpen
    );
    const hostPlatform = useRuntimeStore(
        (state: any) => state.hostCapabilities.platform
    );
    const hasAvailableUpdate = useRuntimeStore((state: any) =>
        Boolean(state.updateLoop.hasAvailableUpdate)
    );
    const sidebarOpen = useShellStore((state: any) => state.sidebarOpen);
    const {
        sidePanelOpen: rightSidebarOpen,
        toggleSidePanelOpen: toggleRightSidebar
    } = useRightSidePanelVisibility(location.pathname);

    async function syncMaximizedState() {
        try {
            setIsMaximized(Boolean(await isWindowMaximized()));
        } catch {
            setIsMaximized(false);
        }
    }

    useEffect(() => {
        syncMaximizedState();
        window.addEventListener('resize', syncMaximizedState);
        return () => {
            window.removeEventListener('resize', syncMaximizedState);
        };
    }, []);

    useEffect(() => {
        if (!isSessionReady) {
            return undefined;
        }

        const handleKeyDown = (event: any) => {
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
                openDirectAccessFromClipboard();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSessionReady, openDirectAccessFromClipboard]);

    async function runWindowAction(action: any, shouldSync: any = true) {
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
                    : (event: any) => {
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
                data-vrcx-0-surface="titlebar"
                className="vrcx-0-titlebar text-foreground pointer-events-auto relative z-[60] flex h-8 shrink-0 items-center border-b select-none"
            >
                <div
                    data-tauri-drag-region
                    className="flex h-full min-w-0 flex-1 items-center gap-2 px-3"
                >
                    {titleBarActionsVisible ? (
                        <div
                            data-titlebar-interactive="true"
                            className="h-full shrink-0"
                            onMouseDown={(event: any) => {
                                event.stopPropagation();
                            }}
                            onDoubleClick={(event: any) => {
                                event.stopPropagation();
                            }}
                        >
                            <AppMenuBar
                                rightSidebarOpen={rightSidebarOpen}
                                onOpenQuickSearch={() =>
                                    setQuickSearchOpen(true)
                                }
                                onOpenDirectAccess={() => {
                                    openDirectAccessFromClipboard();
                                }}
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
                            <TitleBarUpdateButton
                                onClick={() =>
                                    setSystemHostOpen('updaterOpen', true)
                                }
                            />
                        ) : null}
                        <TitleBarCommandGroup
                            quickSearchLabel={quickSearchLabel}
                            quickSearchShortcut={quickSearchShortcut}
                            directAccessLabel={directAccessLabel}
                            directAccessShortcut={directAccessShortcut}
                            onOpenQuickSearch={() => setQuickSearchOpen(true)}
                            onOpenDirectAccess={() => {
                                openDirectAccessFromClipboard();
                            }}
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
                                                onSelect={() => {
                                                    markAllNotificationsRead();
                                                }}
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
                            onClick={() => {
                                setSidebarCollapsedPreference(sidebarOpen);
                            }}
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
                        onClick={() => {
                            runWindowAction(minimizeWindow, false);
                        }}
                    >
                        <MinusIcon data-icon="inline-start" />
                    </TitleBarWindowButton>
                    <TitleBarWindowButton
                        label={maximizeLabel}
                        onClick={() => {
                            runWindowAction(toggleMaximizeWindow);
                        }}
                    >
                        <MaximizeIcon data-icon="inline-start" />
                    </TitleBarWindowButton>
                    <TitleBarWindowButton
                        label={t('app_menu.action.close_window')}
                        className="hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => {
                            runWindowAction(closeWindow, false);
                        }}
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
