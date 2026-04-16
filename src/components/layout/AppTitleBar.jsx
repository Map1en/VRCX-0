import { useEffect, useState } from 'react';
import {
    AppWindowIcon,
    MinusIcon,
    SquareIcon,
    SquareStackIcon,
    XIcon
} from 'lucide-react';

import { backend } from '@/platform/index.js';
import { Button } from '@/ui/shadcn/button';
import { cn } from '@/lib/utils.js';

function TitleBarButton({ label, className, children, onClick }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            className={cn('h-7 w-9 rounded-none border-0', className)}
            onClick={onClick}>
            {children}
        </Button>
    );
}

export function AppTitleBar({ title = '' }) {
    const [isMaximized, setIsMaximized] = useState(false);

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

    return (
        <header
            className="flex h-8 shrink-0 select-none items-center border-b bg-background text-foreground">
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
    );
}
