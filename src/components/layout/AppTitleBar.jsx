import { useEffect, useState } from 'react';
import {
    AppWindowIcon,
    BellIcon,
    MinusIcon,
    SearchIcon,
    SquareIcon,
    SquareStackIcon,
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

function TitleBarButton({ label, className, children, onClick, ...props }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            className={cn('h-7 w-9 rounded-none border-0', className)}
            onClick={onClick}
            {...props}>
            {children}
        </Button>
    );
}

export function AppTitleBar({ title = '' }) {
    const { t } = useI18n();
    const [isMaximized, setIsMaximized] = useState(false);
    const [quickSearchOpen, setQuickSearchOpen] = useState(false);
    const isSessionReady = useSessionStore((state) => state.sessionPhase === 'ready');
    const notificationLayout = usePreferencesStore((state) => state.notificationLayout);
    const vrcUnseenNotificationCount = useVrcNotificationStore((state) => state.unseenCount);
    const openVrcNotificationCenter = useVrcNotificationStore((state) => state.openCenter);
    const markAllVrcNotificationsSeen = useVrcNotificationStore((state) => state.markAllSeen);
    const removeNavNotification = useShellStore((state) => state.removeNotify);

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

    const MaximizeIcon = isMaximized ? SquareStackIcon : SquareIcon;
    const maximizeLabel = isMaximized ? 'Restore window' : 'Maximize window';
    const detailTitle = title && title !== 'VRCX' ? title : '';
    const titleBarActionsVisible = isSessionReady;
    const notificationActionVisible = titleBarActionsVisible && notificationLayout !== 'table';

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
                <Badge className="absolute right-0.5 top-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] leading-4">
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
                    data-tauri-drag-region
                    className="flex min-w-0 flex-1 items-center gap-2 px-3">
                    <span
                        data-tauri-drag-region
                        className="flex size-5 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                        <AppWindowIcon className="pointer-events-none size-3.5" aria-hidden="true" />
                    </span>
                    <span
                        data-tauri-drag-region
                        className="shrink-0 text-xs font-semibold text-foreground">
                        VRCX
                    </span>
                    {detailTitle ? (
                        <span
                            data-tauri-drag-region
                            className="min-w-0 truncate text-xs text-muted-foreground">
                            {detailTitle}
                        </span>
                    ) : null}
                </div>
                {titleBarActionsVisible ? (
                    <div className="flex h-full shrink-0 items-center border-l">
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
