import {
    CircleCheckIcon,
    InfoIcon,
    OctagonXIcon,
    TriangleAlertIcon
} from 'lucide-react';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { useShellStore } from '@/state/shellStore.js';
import { Toaster } from '@/ui/shadcn/sonner';
import { Spinner } from '@/ui/shadcn/spinner';

const TITLE_BAR_TOAST_OFFSET = { top: 'calc(2rem + 32px)' };
let sonnerErrorToastPatched = false;

function patchSonnerErrorToast() {
    if (sonnerErrorToastPatched || typeof toast.error !== 'function') {
        return;
    }
    sonnerErrorToastPatched = true;

    const originalErrorToast = toast.error.bind(toast);
    try {
        toast.error = (message, options) =>
            originalErrorToast(
                typeof message === 'string' || message instanceof Error
                    ? userFacingErrorMessage(message, 'Action failed.')
                    : message,
                options
            );
    } catch {
        sonnerErrorToastPatched = false;
    }
}

patchSonnerErrorToast();

function resolveSonnerTheme(themeMode) {
    if (themeMode === 'dark') {
        return 'dark';
    }
    if (themeMode === 'light') {
        return 'light';
    }

    const documentTheme =
        typeof document !== 'undefined'
            ? document.documentElement.dataset.theme
            : '';
    const resolvedTheme = documentTheme || 'system';

    if (resolvedTheme === 'dark') {
        return 'dark';
    }
    if (resolvedTheme === 'light') {
        return 'light';
    }
    return 'system';
}

export function AppToaster(props) {
    const themeMode = useShellStore((state) => state.themeMode);
    const theme = resolveSonnerTheme(themeMode);

    return (
        <Toaster
            theme={theme}
            richColors
            position="top-center"
            offset={TITLE_BAR_TOAST_OFFSET}
            icons={{
                success: <CircleCheckIcon className="size-4" />,
                info: <InfoIcon className="size-4" />,
                warning: <TriangleAlertIcon className="size-4" />,
                error: <OctagonXIcon className="size-4" />,
                loading: <Spinner />
            }}
            style={{
                '--normal-bg': 'var(--popover)',
                '--normal-text': 'var(--popover-foreground)',
                '--normal-border': 'var(--border)',
                '--border-radius': 'var(--radius)'
            }}
            {...props}
        />
    );
}
