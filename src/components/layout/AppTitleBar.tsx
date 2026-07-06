import { CopyIcon, MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import {
    closeWindow,
    isWindowMaximized,
    minimizeWindow,
    toggleMaximizeWindow
} from '@/services/shellIntegrationService';

import { AppMenuBar } from './AppMenuBar';
import {
    TitleBarBuildBadge,
    TitleBarButton,
    useTitleBarActions
} from './useTitleBarActions';

function TitleBarWindowButton({ className, ...props }: any) {
    return (
        <TitleBarButton
            className={cn(
                'text-muted-foreground hover:text-foreground h-full w-9 rounded-none border-0',
                className
            )}
            {...props}
        />
    );
}

export function AppTitleBar() {
    const { t } = useTranslation();
    const [isMaximized, setIsMaximized] = useState(false);
    const {
        isSessionReady,
        actions,
        quickSearchDialog,
        openQuickSearch,
        openDirectAccessFromClipboard,
        openNotificationCenter,
        toggleRightSidebar,
        rightSidebarOpen
    } = useTitleBarActions('px-1');

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
                    {isSessionReady ? (
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
                                onOpenQuickSearch={openQuickSearch}
                                onOpenDirectAccess={
                                    openDirectAccessFromClipboard
                                }
                                onOpenNotificationCenter={
                                    openNotificationCenter
                                }
                                onToggleRightSidebar={toggleRightSidebar}
                            />
                        </div>
                    ) : null}
                    <TitleBarBuildBadge />
                    <div
                        data-tauri-drag-region
                        className="h-full min-w-0 flex-1"
                    />
                </div>
                {actions}
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
                        className="hover:bg-destructive! hover:text-destructive-foreground!"
                        onClick={() => {
                            runWindowAction(closeWindow, false);
                        }}
                    >
                        <XIcon data-icon="inline-start" />
                    </TitleBarWindowButton>
                </div>
            </header>
            {quickSearchDialog}
        </>
    );
}
