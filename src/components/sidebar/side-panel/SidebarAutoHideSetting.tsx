import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { setSidebarAutoHideEnabled } from '@/services/sidebarAutoHideService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useShellStore } from '@/state/shellStore';
import { useSidebarAutoHideStore } from '@/state/sidebarAutoHideStore';
import { Switch } from '@/ui/shadcn/switch';

import { SidePanelSettingRow } from './SidePanelSettingRow';

export function SidebarAutoHideSetting() {
    const { t } = useTranslation();
    const platform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const sidebar = useShellStore(
        (state) => state.windowDisplayMode === 'sidebar'
    );
    const enabled = useSidebarAutoHideStore((state) => state.enabled);
    const hydrated = useSidebarAutoHideStore((state) => state.hydrated);
    const failed = useSidebarAutoHideStore((state) => state.failed);
    const [pending, setPending] = useState(false);
    if (!sidebar || (platform !== 'windows' && platform !== 'macos')) {
        return null;
    }

    async function onChange(checked: boolean): Promise<void> {
        setPending(true);
        try {
            await setSidebarAutoHideEnabled(checked);
        } catch {
            toast.error(t('side_panel.settings.auto_hide.save_failed'));
        } finally {
            setPending(false);
        }
    }

    return (
        <SidePanelSettingRow
            id="sidebar-auto-hide"
            label={t('side_panel.settings.auto_hide.label')}
            description={t(
                failed
                    ? 'side_panel.settings.auto_hide.paused'
                    : 'side_panel.settings.auto_hide.description'
            )}
            disabled={!hydrated || pending}
        >
            <Switch
                checked={enabled}
                disabled={!hydrated || pending}
                onCheckedChange={onChange}
            />
        </SidePanelSettingRow>
    );
}
