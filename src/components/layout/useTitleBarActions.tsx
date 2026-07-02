import {
    BellIcon,
    CompassIcon,
    PanelLeftIcon,
    PanelLeftOpenIcon,
    PanelRightIcon,
    PanelRightOpenIcon,
    SearchIcon,
    SparklesIcon
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { KeyboardShortcut } from '@/components/keyboard/KeyboardShortcut';
import { QuickSearchDialog } from '@/components/sidebar/QuickSearchDialog';
import { cn } from '@/lib/utils';
import { setNavbarCollapsedPreference } from '@/services/preferencesService';
import { openOrInstallLatestAvailableUpdate } from '@/services/updateInstallService';
import { getBuildBadgeLabel } from '@/shared/buildLabel';
import { useAssistantChatStore } from '@/state/assistantChatStore';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { useDirectAccessAction } from './directAccessAction';
import { TitleBarUpdateButton } from './TitleBarUpdateButton';
import { useRightSidePanelVisibility } from './useRightSidePanelVisibility';

export function TitleBarButton({
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

export function TitleBarBuildBadge() {
    const { t } = useTranslation();
    const buildBadgeLabel = getBuildBadgeLabel(t);
    if (!buildBadgeLabel) {
        return null;
    }
    return (
        <Badge
            data-tauri-drag-region
            variant="secondary"
            className="h-5 shrink-0 rounded-md px-1.5 text-[10px] leading-none shadow-none"
        >
            {buildBadgeLabel}
        </Badge>
    );
}

const SHORTCUT_KBD_CLASS =
    'bg-background/45 h-3.5 min-w-3.5 rounded-[3px] px-1 text-[9px] leading-3.5 shadow-none';

function getTitleBarShortcutLabel(isMacHost: any, actionKey: any) {
    const modifierKey = isMacHost ? '⌘' : 'Ctrl';
    return isMacHost
        ? `${modifierKey}${actionKey}`
        : `${modifierKey}+${actionKey}`;
}

function formatTitleBarShortcutLabel(value: any, shortcutLabel: any) {
    return `${value} ${shortcutLabel}`;
}

interface TitleBarActionsResult {
    isSessionReady: boolean;
    actions: ReactNode;
    quickSearchDialog: ReactNode;
    openQuickSearch: () => void;
    openDirectAccessFromClipboard: () => void;
    openNotificationCenter: () => void;
    toggleRightSidebar: () => void;
    rightSidebarOpen: boolean;
}

export function useTitleBarActions(
    actionsClassName?: string
): TitleBarActionsResult {
    const { t } = useTranslation();
    const location = useLocation();
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
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const hasAvailableUpdate = useRuntimeStore((state) =>
        Boolean(state.updateLoop.hasAvailableUpdate)
    );
    const navbarOpen = useShellStore((state) => state.sidebarOpen);
    const {
        sidePanelOpen: rightSidebarOpen,
        toggleSidePanelOpen: toggleRightSidebar
    } = useRightSidePanelVisibility(location.pathname);

    const isMacHost = hostPlatform === 'macos';
    const notificationActionVisible =
        isSessionReady && notificationLayout !== 'table';
    const leftSidebarLabel = navbarOpen
        ? t('nav_tooltip.collapse_nav')
        : t('nav_tooltip.expand_nav');
    const rightSidebarLabel = rightSidebarOpen
        ? t('app_menu.hide_friends_sidebar')
        : t('app_menu.show_friends_sidebar');
    const quickSearchShortcutLabel = getTitleBarShortcutLabel(isMacHost, 'K');
    const directAccessShortcutLabel = getTitleBarShortcutLabel(isMacHost, 'D');
    const quickSearchLabel = t('app_menu.quick_search');
    const directAccessLabel = t('prompt.direct_access_omni.header');

    const openQuickSearch = useCallback(() => {
        setQuickSearchOpen(true);
    }, []);

    useEffect(() => {
        if (!isSessionReady) {
            return undefined;
        }

        const handleKeyDown = (event: any) => {
            const hasModifier = isMacHost
                ? event.metaKey
                : event.ctrlKey || event.metaKey;
            if (!hasModifier) {
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
    }, [isSessionReady, isMacHost, openDirectAccessFromClipboard]);

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

    const actions = isSessionReady ? (
        <div
            className={cn(
                'flex h-full min-w-0 shrink-0 items-center gap-1',
                actionsClassName
            )}
        >
            {hasAvailableUpdate ? (
                <TitleBarUpdateButton
                    onClick={() => {
                        void openOrInstallLatestAvailableUpdate();
                    }}
                />
            ) : null}
            <div className="flex min-w-0 shrink items-center gap-1">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            aria-label={formatTitleBarShortcutLabel(
                                quickSearchLabel,
                                quickSearchShortcutLabel
                            )}
                            className="bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground h-6 min-w-7 justify-start rounded-md border-0 px-2 shadow-none min-[640px]:w-44 min-[960px]:w-56"
                            onClick={openQuickSearch}
                        >
                            <SearchIcon data-icon="inline-start" />
                            <span className="hidden min-w-0 truncate min-[640px]:block">
                                {quickSearchLabel}
                            </span>
                            <KeyboardShortcut
                                keys={[isMacHost ? 'Meta' : 'Mod', 'K']}
                                kbdClassName={SHORTCUT_KBD_CLASS}
                                className="ml-auto hidden gap-0.5 min-[760px]:inline-flex"
                            />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        {formatTitleBarShortcutLabel(
                            quickSearchLabel,
                            quickSearchShortcutLabel
                        )}
                    </TooltipContent>
                </Tooltip>
                <TitleBarButton
                    label={formatTitleBarShortcutLabel(
                        directAccessLabel,
                        directAccessShortcutLabel
                    )}
                    className="size-7 min-w-7 rounded-md px-0"
                    onClick={openDirectAccessFromClipboard}
                >
                    <CompassIcon data-icon="icon" />
                </TitleBarButton>
            </div>
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
                label={t('assistant.title')}
                className="size-7 min-w-7 rounded-md px-0"
                onClick={() => useAssistantChatStore.getState().setOpen(true)}
            >
                <SparklesIcon data-icon="icon" />
            </TitleBarButton>
            <TitleBarButton
                label={leftSidebarLabel}
                className="size-7 min-w-7 rounded-md px-0"
                onClick={() => {
                    setNavbarCollapsedPreference(navbarOpen);
                }}
            >
                {navbarOpen ? (
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
    ) : null;

    const quickSearchDialog = isSessionReady ? (
        <QuickSearchDialog
            open={quickSearchOpen}
            onOpenChange={setQuickSearchOpen}
        />
    ) : null;

    return {
        isSessionReady,
        actions,
        quickSearchDialog,
        openQuickSearch,
        openDirectAccessFromClipboard,
        openNotificationCenter: openVrcNotificationCenter,
        toggleRightSidebar,
        rightSidebarOpen
    };
}
