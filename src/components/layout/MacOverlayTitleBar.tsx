import {
    BellIcon,
    CompassIcon,
    PanelLeftIcon,
    PanelLeftOpenIcon,
    PanelRightIcon,
    PanelRightOpenIcon,
    SearchIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { QuickSearchDialog } from '@/components/sidebar/QuickSearchDialog';
import { cn } from '@/lib/utils';
import { setSidebarCollapsedPreference } from '@/services/preferencesService';
import { getBuildBadgeLabel } from '@/shared/buildLabel';
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

import { TitleBarUpdateButton } from './TitleBarUpdateButton';
import { useDirectAccessAction } from './directAccessAction';
import { useRightSidePanelVisibility } from './useRightSidePanelVisibility';

function MacTitleBarButton({
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

function MacShortcut({ actionKey }: { actionKey: string }) {
    return (
        <KbdGroup className="ml-auto hidden gap-0.5 min-[760px]:inline-flex">
            <Kbd className="bg-background/45 h-3.5 min-w-3.5 rounded-[3px] px-1 text-[9px] leading-3.5 shadow-none">
                {'\u2318'}
            </Kbd>
            <Kbd className="bg-background/45 h-3.5 min-w-3.5 rounded-[3px] px-1 text-[9px] leading-3.5 shadow-none">
                {actionKey}
            </Kbd>
        </KbdGroup>
    );
}

export function MacOverlayTitleBar() {
    const { t } = useTranslation();
    const location = useLocation();
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
    const hasAvailableUpdate = useRuntimeStore((state: any) =>
        Boolean(state.updateLoop.hasAvailableUpdate)
    );
    const sidebarOpen = useShellStore((state: any) => state.sidebarOpen);
    const {
        sidePanelOpen: rightSidebarOpen,
        toggleSidePanelOpen: toggleRightSidebar
    } = useRightSidePanelVisibility(location.pathname);
    const buildBadgeLabel = getBuildBadgeLabel(t);
    const notificationActionVisible =
        isSessionReady && notificationLayout !== 'table';
    const leftSidebarLabel = sidebarOpen
        ? t('nav_tooltip.collapse_menu')
        : t('nav_tooltip.expand_menu');
    const rightSidebarLabel = rightSidebarOpen
        ? t('app_menu.hide_side_panel')
        : t('app_menu.show_side_panel');
    const quickSearchLabel = t('app_menu.quick_search');
    const directAccessLabel = t('prompt.direct_access_omni.header');

    useEffect(() => {
        if (!isSessionReady) {
            return undefined;
        }

        const handleKeyDown = (event: any) => {
            if (!event.metaKey) {
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
        <MacTitleBarButton
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
        </MacTitleBarButton>
    );

    return (
        <>
            <header
                data-app-titlebar="true"
                data-vrcx-0-surface="mac-titlebar"
                className="vrcx-0-titlebar text-foreground pointer-events-auto relative z-[60] flex h-8 shrink-0 items-center border-b select-none"
            >
                <div
                    data-tauri-drag-region
                    className="flex h-full min-w-0 flex-1 items-center gap-2 pr-2 pl-[76px]"
                >
                    {buildBadgeLabel ? (
                        <Badge
                            data-tauri-drag-region
                            variant="secondary"
                            className="h-5 shrink-0 rounded-md px-1.5 text-[10px] leading-none shadow-none"
                        >
                            {buildBadgeLabel}
                        </Badge>
                    ) : null}
                    <div data-tauri-drag-region className="h-full min-w-0 flex-1" />
                </div>
                {isSessionReady ? (
                    <div className="flex h-full min-w-0 shrink-0 items-center gap-1 px-2">
                        {hasAvailableUpdate ? (
                            <TitleBarUpdateButton
                                onClick={() =>
                                    setSystemHostOpen('updaterOpen', true)
                                }
                            />
                        ) : null}
                        <div className="flex min-w-0 shrink items-center gap-1">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="xs"
                                        aria-label={`${quickSearchLabel} \u2318K`}
                                        className="bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground h-6 min-w-7 justify-start rounded-md border-0 px-2 shadow-none min-[640px]:w-44 min-[960px]:w-56"
                                        onClick={() => setQuickSearchOpen(true)}
                                    >
                                        <SearchIcon data-icon="inline-start" />
                                        <span className="hidden min-w-0 truncate min-[640px]:block">
                                            {quickSearchLabel}
                                        </span>
                                        <MacShortcut actionKey="K" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {quickSearchLabel} {'\u2318'}K
                                </TooltipContent>
                            </Tooltip>
                            <MacTitleBarButton
                                label={`${directAccessLabel} \u2318D`}
                                className="size-7 min-w-7 rounded-md px-0"
                                onClick={openDirectAccessFromClipboard}
                            >
                                <CompassIcon data-icon="icon" />
                            </MacTitleBarButton>
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
                        <MacTitleBarButton
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
                        </MacTitleBarButton>
                        <MacTitleBarButton
                            label={rightSidebarLabel}
                            className="size-7 min-w-7 rounded-md px-0"
                            onClick={toggleRightSidebar}
                        >
                            {rightSidebarOpen ? (
                                <PanelRightIcon data-icon="icon" />
                            ) : (
                                <PanelRightOpenIcon data-icon="icon" />
                            )}
                        </MacTitleBarButton>
                    </div>
                ) : null}
            </header>
            {isSessionReady ? (
                <QuickSearchDialog
                    open={quickSearchOpen}
                    onOpenChange={setQuickSearchOpen}
                />
            ) : null}
        </>
    );
}
