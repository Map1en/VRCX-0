import {
    CircleCheckIcon,
    InfoIcon,
    OctagonXIcon,
    TriangleAlertIcon
} from 'lucide-react';

import { useShellStore } from '@/state/shellStore.js';
import { Toaster } from '@/ui/shadcn/sonner';
import { Spinner } from '@/ui/shadcn/spinner';

function resolveSonnerTheme(themeMode) {
    if (themeMode === 'dark') {
        return 'dark';
    }
    if (themeMode === 'light') {
        return 'light';
    }

    const documentTheme = typeof document !== 'undefined'
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
