import {
    CopyIcon,
    MinusIcon,
    SearchIcon,
    SquareIcon,
    XIcon
} from 'lucide-react';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import {
    closeWindow,
    minimizeWindow,
    toggleMaximizeWindow
} from '@/services/shellIntegrationService';
import { useShellStore } from '@/state/shellStore';

import { AppMenuBar } from './AppMenuBar';
import { TitleBarButton, useTitleBarActions } from './useTitleBarActions';
import { useWindowChromeState } from './useWindowChromeState';

async function runWindowAction(action: () => Promise<void>) {
    try {
        await action();
    } catch (error) {
        console.warn('Window control action failed:', error);
    }
}

function TitleBarWindowButton({
    className,
    onAction,
    ...props
}: Omit<ComponentProps<typeof TitleBarButton>, 'onClick' | 'onPointerDown'> & {
    onAction: () => void;
}) {
    return (
        <TitleBarButton
            className={cn(
                'text-muted-foreground hover:text-foreground h-full w-9 rounded-none border-0',
                className
            )}
            onPointerDown={(event: React.PointerEvent) => {
                if (event.button === 0) {
                    onAction();
                }
            }}
            onClick={(event: React.MouseEvent) => {
                if (event.detail === 0) {
                    onAction();
                }
            }}
            {...props}
        />
    );
}

export function AppTitleBar() {
    const { t } = useTranslation();
    const sidebarWindowMode = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const {
        maximized: isMaximized,
        docked: isDocked,
        focused: isFocused
    } = useWindowChromeState();
    const {
        isSessionReady,
        actions,
        quickSearchDialog,
        openQuickSearch,
        openDirectAccessFromClipboard,
        openNotificationCenter,
        sidebarWindowModeButton,
        notificationAction,
        themeToggleAction,
        toggleRightSidebar,
        rightSidebarOpen
    } = useTitleBarActions('px-1');

    const MaximizeIcon = isMaximized ? CopyIcon : SquareIcon;
    const maximizeLabel = isMaximized
        ? t('app_menu.label.restore_window')
        : t('app_menu.label.maximize_window');

    return (
        <>
            <header
                data-app-titlebar="true"
                data-window-docked={isDocked || undefined}
                data-window-blurred={!isFocused || undefined}
                data-window-sidebar-mode={sidebarWindowMode || undefined}
                data-vrcx-0-surface="titlebar"
                className="vrcx-0-titlebar text-foreground pointer-events-auto relative z-[60] flex h-8 shrink-0 items-center border-b select-none"
            >
                <div
                    data-tauri-drag-region
                    className="flex h-full min-w-0 flex-1 items-center gap-2 pr-3"
                >
                    {isSessionReady && !sidebarWindowMode ? (
                        <div
                            role="presentation"
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
                    <div
                        data-tauri-drag-region
                        className="h-full min-w-0 flex-1"
                    />
                </div>
                {sidebarWindowMode ? (
                    <div className="flex h-full shrink-0 items-center gap-1 px-1">
                        {isSessionReady ? (
                            <TitleBarButton
                                label={t('app_menu.quick_search')}
                                className="size-7 min-w-7 rounded-md px-0"
                                onClick={openQuickSearch}
                            >
                                <SearchIcon data-icon="icon" />
                            </TitleBarButton>
                        ) : null}
                        {notificationAction}
                        {themeToggleAction}
                        {sidebarWindowModeButton}
                    </div>
                ) : (
                    actions
                )}
                <div className="flex h-full shrink-0 items-center">
                    <TitleBarWindowButton
                        label={t('app_menu.label.minimize_window')}
                        onAction={() => {
                            runWindowAction(minimizeWindow);
                        }}
                    >
                        <MinusIcon data-icon="inline-start" />
                    </TitleBarWindowButton>
                    {sidebarWindowMode ? null : (
                        <TitleBarWindowButton
                            label={maximizeLabel}
                            onAction={() => {
                                runWindowAction(toggleMaximizeWindow);
                            }}
                        >
                            <MaximizeIcon
                                data-icon="inline-start"
                                className="size-3"
                            />
                        </TitleBarWindowButton>
                    )}
                    <TitleBarWindowButton
                        label={t('app_menu.action.close_window')}
                        className="hover:bg-destructive! hover:text-destructive-foreground!"
                        onAction={() => {
                            runWindowAction(closeWindow);
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
