import {
    CircleCheckIcon,
    InfoIcon,
    OctagonXIcon,
    TriangleAlertIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { useShellStore } from '@/state/shellStore';
import { Toaster } from '@/ui/shadcn/sonner';
import { Spinner } from '@/ui/shadcn/spinner';

const TITLE_BAR_TOAST_OFFSET: any = { top: 'calc(2rem + 32px)' };
const APP_TOASTER_PORTAL_ID = 'vrcx-0-toast-root';
const APP_TOASTER_Z_INDEX = 70;
const VRCHAT_API_UNAVAILABLE_TOAST_DURATION_MS = 12000;
const VRCHAT_STATUS_HOST = 'status.vrchat.com';
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
let sonnerErrorToastPatched = false;

function hasVrchatStatusUrl(message: string) {
    const urls = message.match(URL_PATTERN);
    if (!urls) {
        return false;
    }

    return urls.some((urlText) => {
        try {
            return (
                new URL(urlText).hostname.toLowerCase() === VRCHAT_STATUS_HOST
            );
        } catch {
            return false;
        }
    });
}

function isVrchatApiUnavailableMessage(message: unknown) {
    if (typeof message !== 'string') {
        return false;
    }
    return (
        hasVrchatStatusUrl(message) ||
        message.includes('VRChat API services are currently unavailable')
    );
}

function applyErrorToastDefaults(message: unknown, options: any) {
    if (
        !isVrchatApiUnavailableMessage(message) ||
        (options && typeof options === 'object' && options.duration != null)
    ) {
        return options;
    }

    return {
        ...(options && typeof options === 'object' ? options : {}),
        duration: VRCHAT_API_UNAVAILABLE_TOAST_DURATION_MS
    };
}

function patchSonnerErrorToast() {
    if (sonnerErrorToastPatched || typeof toast.error !== 'function') {
        return;
    }
    sonnerErrorToastPatched = true;

    const originalErrorToast = toast.error.bind(toast);
    try {
        toast.error = (message: any, options: any) => {
            const nextMessage =
                typeof message === 'string' || message instanceof Error
                    ? userFacingErrorMessage(message, 'Action failed.')
                    : message;
            return originalErrorToast(
                nextMessage,
                applyErrorToastDefaults(nextMessage, options)
            );
        };
    } catch {
        sonnerErrorToastPatched = false;
    }
}

patchSonnerErrorToast();

function resolveSonnerTheme(themeMode: any) {
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

function getAppToasterPortalContainer() {
    if (typeof document === 'undefined') {
        return null;
    }

    let container = document.getElementById(APP_TOASTER_PORTAL_ID);
    if (!container) {
        container = document.createElement('div');
        container.id = APP_TOASTER_PORTAL_ID;
        document.body.appendChild(container);
    }
    return container;
}

export function AppToaster(props: any) {
    const themeMode = useShellStore((state: any) => state.themeMode);
    const theme = resolveSonnerTheme(themeMode);
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
        null
    );

    useEffect(() => {
        setPortalContainer(getAppToasterPortalContainer());
    }, []);

    const toaster = (
        <Toaster
            theme={theme}
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
                '--border-radius': 'var(--radius)',
                zIndex: APP_TOASTER_Z_INDEX
            }}
            {...props}
        />
    );

    if (!portalContainer) {
        return toaster;
    }

    return createPortal(toaster, portalContainer);
}
