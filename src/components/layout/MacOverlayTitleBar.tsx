import { TitleBarBuildBadge, useTitleBarActions } from './useTitleBarActions';

export function MacOverlayTitleBar() {
    const { actions, quickSearchDialog } = useTitleBarActions('px-2');

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
                    <TitleBarBuildBadge />
                    <div
                        data-tauri-drag-region
                        className="h-full min-w-0 flex-1"
                    />
                </div>
                {actions}
            </header>
            {quickSearchDialog}
        </>
    );
}
