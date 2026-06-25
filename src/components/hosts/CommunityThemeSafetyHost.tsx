import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { tauriClient } from '@/platform/tauri/client';
import {
    disableInstalledCommunityTheme,
    stopLocalCommunityThemePreview
} from '@/services/communityThemeService';

export function CommunityThemeSafetyHost(): null {
    const { t } = useTranslation();

    useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | null = null;

        async function disableThemeFromTray() {
            try {
                await disableInstalledCommunityTheme();
                await stopLocalCommunityThemePreview();
                toast.success(t('view.community_themes.toast.theme_disabled'));
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.community_themes.toast.disable_failed')
                );
            }
        }

        tauriClient.events
            .subscribe('communityThemeDisableRequested', () => {
                void disableThemeFromTray();
            })
            .then((unsubscribe: any) => {
                if (disposed) {
                    unsubscribe();
                    return;
                }
                unlisten = unsubscribe;
            })
            .catch((error: any) => {
                console.warn(
                    'Unable to subscribe community theme tray event:',
                    error
                );
            });

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [t]);

    return null;
}
