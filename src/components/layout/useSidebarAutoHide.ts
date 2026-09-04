import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    initializeSidebarAutoHide,
    observeSidebarAutoHideInteractions,
    subscribeSidebarAutoHideState,
    syncSidebarAutoHideContext
} from '@/services/sidebarAutoHideService';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { useSidebarAutoHideStore } from '@/state/sidebarAutoHideStore';

export function useSidebarAutoHide(): void {
    const { t } = useTranslation();
    const platform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const enabled = useSidebarAutoHideStore((state) => state.enabled);
    const failed = useSidebarAutoHideStore((state) => state.failed);
    const sidebar = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const reducedMotion = usePreferencesStore(
        (state) => state.reducedMotionAndBlur
    );
    const supported = platform === 'windows' || platform === 'macos';

    useEffect(() => {
        if (!supported) {
            return;
        }
        let disposed = false;
        let unsubscribe: (() => void) | undefined;
        void subscribeSidebarAutoHideState()
            .then(async (unlisten) => {
                if (disposed) {
                    unlisten();
                    return;
                }
                unsubscribe = unlisten;
                await initializeSidebarAutoHide();
            })
            .catch((error: unknown) =>
                console.warn('Failed to load sidebar auto-hide:', error)
            );
        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, [supported]);

    useEffect(() => {
        if (failed) {
            toast.error(t('side_panel.settings.auto_hide.paused'), {
                id: 'sidebar-auto-hide-paused'
            });
        }
    }, [failed, t]);

    useEffect(() => {
        if (!supported) {
            return;
        }
        const update = (blocked?: boolean) => {
            void syncSidebarAutoHideContext(blocked).catch((error: unknown) =>
                console.warn('Failed to update sidebar auto-hide:', error)
            );
        };
        if (!enabled || !sidebar) {
            update(false);
            return;
        }
        const dispose = observeSidebarAutoHideInteractions(update);
        const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const updateMotion = () => update();
        motion?.addEventListener('change', updateMotion);
        return () => {
            dispose();
            motion?.removeEventListener('change', updateMotion);
        };
    }, [supported, enabled, sidebar, reducedMotion]);
}
