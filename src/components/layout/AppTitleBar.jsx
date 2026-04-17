import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
    BellIcon,
    CopyIcon,
    MinusIcon,
    PanelRightCloseIcon,
    PanelRightOpenIcon,
    SearchIcon,
    SquareIcon,
    XIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { QuickSearchDialog } from '@/components/sidebar/QuickSearchDialog.jsx';
import { backend } from '@/platform/index.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
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
import { cn } from '@/lib/utils.js';
import { AppMenuBar } from './AppMenuBar.jsx';
import { shouldShowSidePanel } from './sidePanelRoutes.js';

const TITLE_BAR_INTERACTIVE_SELECTOR = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[data-titlebar-interactive="true"]'
].join(',');

function TitleBarButton({ label, className, children, onClick, ...props }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            title={label}
            className={cn('h-7 w-9 rounded-none border-0', className)}
            onClick={onClick}
            {...props}>
            {children}
        </Button>
    );
}

export function AppTitleBar() {
    const { t } = useI18n();
    const location = useLocation();
    const [isMaximized, setIsMaximized] = useState(false);
    const [quickSearchOpen, setQuickSearchOpen] = useState(false);
    const isSessionReady = useSessionStore((state) => state.sessionPhase === 'ready');
    const notificationLayout = usePreferencesStore((state) => state.notificationLayout);
    const vrcUnseenNotificationCount = useVrcNotificationStore((state) => state.unseenCount);
    const openVrcNotificationCenter = useVrcNotificationStore((state) => state.openCenter);
    const markAllVrcNotificationsSeen = useVrcNotificationStore((state) => state.markAllSeen);
    const removeNavNotification = useShellStore((state) => state.removeNotify);
    const rightSidebarOpen = useShellStore((state) => state.rightSidebarOpen);
    const toggleRightSidebar = useShellStore((state) => state.toggleRightSidebar);

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
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
                return;
            }
            event.preventDefault();
            setQuickSearchOpen(true);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSessionReady]);

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

    function isTitleBarDragTarget(event) {
        if (event.defaultPrevented || event.button !== 0) {
            return false;
        }

        return !event.target.closest(TITLE_BAR_INTERACTIVE_SELECTOR);
    }

    function handleTitleBarMouseDown(event) {
        if (!isTitleBarDragTarget(event) || event.detail > 1) {
            return;
        }

        void backend.webview.startDraggingWindow().catch((error) => {
            console.warn('Window drag action failed:', error);
        });
    }

    function handleTitleBarDoubleClick(event) {
        if (!isTitleBarDragTarget(event)) {
            return;
        }

        void runWindowAction(backend.webview.toggleMaximizeWindow);
    }

    const MaximizeIcon = isMaximized ? CopyIcon : SquareIcon;
    const maximizeLabel = isMaximized ? 'Restore window' : 'Maximize window';
    const titleBarActionsVisible = isSessionReady;
    const notificationActionVisible = titleBarActionsVisible && notificationLayout !== 'table';
    const rightSidebarActionVisible = titleBarActionsVisible && shouldShowSidePanel(location.pathname);
    const RightSidebarIcon = rightSidebarOpen ? PanelRightCloseIcon : PanelRightOpenIcon;
    const rightSidebarLabel = rightSidebarOpen ? 'Collapse right sidebar' : 'Expand right sidebar';

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
            toast.error(error instanceof Error ? error.message : 'Failed to mark notifications as seen.');
        }
    }

    const notificationButton = (
        <TitleBarButton
            label={t('side_panel.notification_center.title')}
            className="relative rounded-none"
            onClick={() => openVrcNotificationCenter()}>
            <BellIcon data-icon="inline-start" />
            {vrcUnseenNotificationCount > 0 ? (
                <Badge className="absolute right-1 top-0.5 h-3 min-w-3 rounded-full px-0.5 py-0 text-[7px] leading-none">
                    {vrcUnseenNotificationCount > 99 ? '99+' : vrcUnseenNotificationCount}
                </Badge>
            ) : null}
        </TitleBarButton>
    );

    return (
        <>
            <header
                className="relative z-[60] flex h-8 shrink-0 select-none items-center border-b bg-background text-foreground">
                <div
                    className="flex h-full min-w-0 flex-1 items-center gap-2 px-3"
                    onMouseDown={handleTitleBarMouseDown}
                    onDoubleClick={handleTitleBarDoubleClick}>
                    <span className="shrink-0 text-xs font-semibold text-foreground">
                        VRCX-0
                    </span>
                    {titleBarActionsVisible ? (
                        <div data-titlebar-interactive="true" className="shrink-0">
                            <AppMenuBar
                                rightSidebarVisible={rightSidebarActionVisible}
                                rightSidebarOpen={rightSidebarOpen}
                                onOpenQuickSearch={() => setQuickSearchOpen(true)}
                                onOpenNotificationCenter={() => openVrcNotificationCenter()}
                                onToggleRightSidebar={() => toggleRightSidebar()}
                            />
                        </div>
                    ) : null}
                    <div className="h-full min-w-0 flex-1" />
                </div>
                {titleBarActionsVisible ? (
                    <div className="flex h-full shrink-0 items-center">
                        <TitleBarButton
                            label={`${t('side_panel.search_placeholder')} Ctrl+K`}
                            className="w-auto gap-1.5 px-2"
                            onClick={() => setQuickSearchOpen(true)}>
                            <SearchIcon data-icon="inline-start" />
                            <span className="rounded border px-1 text-[10px] leading-4 text-muted-foreground">Ctrl</span>
                            <span className="rounded border px-1 text-[10px] leading-4 text-muted-foreground">K</span>
                        </TitleBarButton>
                        {notificationActionVisible ? (
                            vrcUnseenNotificationCount > 0 ? (
                                <ContextMenu>
                                    <ContextMenuTrigger asChild>
                                        {notificationButton}
                                    </ContextMenuTrigger>
                                    <ContextMenuContent className="w-48">
                                        <ContextMenuGroup>
                                            <ContextMenuItem onSelect={() => void markAllNotificationsRead()}>
                                                {t('nav_menu.mark_all_read')}
                                            </ContextMenuItem>
                                        </ContextMenuGroup>
                                    </ContextMenuContent>
                                </ContextMenu>
                            ) : (
                                <div
                                    onContextMenu={(event) => {
                                        event.preventDefault();
                                        toast.info(t('side_panel.notification_center.no_unseen_notifications'));
                                    }}>
                                    {notificationButton}
                                </div>
                            )
                        ) : null}
                        {rightSidebarActionVisible ? (
                            <TitleBarButton
                                label={rightSidebarLabel}
                                onClick={() => toggleRightSidebar()}>
                                <RightSidebarIcon data-icon="inline-start" />
                            </TitleBarButton>
                        ) : null}
                    </div>
                ) : null}
                <div className="flex h-full shrink-0 items-center">
                    <TitleBarButton
                        label="Minimize window"
                        onClick={() => void runWindowAction(backend.webview.minimizeWindow, false)}>
                        <MinusIcon data-icon="inline-start" />
                    </TitleBarButton>
                    <TitleBarButton
                        label={maximizeLabel}
                        onClick={() => void runWindowAction(backend.webview.toggleMaximizeWindow)}>
                        <MaximizeIcon data-icon="inline-start" />
                    </TitleBarButton>
                    <TitleBarButton
                        label="Close window"
                        className="hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => void runWindowAction(backend.webview.closeWindow, false)}>
                        <XIcon data-icon="inline-start" />
                    </TitleBarButton>
                </div>
            </header>
            {titleBarActionsVisible ? (
                <QuickSearchDialog open={quickSearchOpen} onOpenChange={setQuickSearchOpen} />
            ) : null}
        </>
    );
}
