import { SearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useShellStore } from '@/state/shellStore';

import {
    TitleBarBuildBadge,
    TitleBarButton,
    useTitleBarActions
} from './useTitleBarActions';

export function MacOverlayTitleBar() {
    const { t } = useTranslation();
    const sidebarWindowMode = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const {
        actions,
        isSessionReady,
        openQuickSearch,
        quickSearchDialog,
        sidebarWindowModeButton,
        notificationAction,
        themeToggleAction
    } = useTitleBarActions('px-2');

    return (
        <>
            <header
                data-app-titlebar="true"
                data-window-sidebar-mode={sidebarWindowMode || undefined}
                data-vrcx-0-surface="mac-titlebar"
                className="vrcx-0-titlebar text-foreground pointer-events-auto relative z-[60] flex h-8 shrink-0 items-center border-b select-none"
            >
                <div
                    data-tauri-drag-region
                    className="flex h-full min-w-0 flex-1 items-center gap-2 pr-2 pl-[76px]"
                >
                    {sidebarWindowMode ? null : <TitleBarBuildBadge />}
                    <div
                        data-tauri-drag-region
                        className="h-full min-w-0 flex-1"
                    />
                </div>
                {sidebarWindowMode ? (
                    <div className="flex h-full shrink-0 items-center gap-1 px-2">
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
            </header>
            {quickSearchDialog}
        </>
    );
}
