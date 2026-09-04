import { MonitorIcon, RectangleGogglesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { launchVrchat } from '@/services/launchService';
import { ContextMenuGroup, ContextMenuItem } from '@/ui/shadcn/context-menu';

export function LaunchModeContextMenuGroup({
    disabled,
    errorMessage,
    location,
    shortName = ''
}: {
    disabled: boolean;
    errorMessage: string;
    location: string;
    shortName?: string;
}) {
    const { t } = useTranslation();

    async function launch(desktopMode: boolean) {
        try {
            await launchVrchat(location, shortName, desktopMode);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : errorMessage);
        }
    }

    return (
        <ContextMenuGroup className="grid grid-cols-2 gap-0.5">
            <ContextMenuItem
                className="justify-center"
                disabled={disabled}
                onClick={() => {
                    void launch(false);
                }}
            >
                <RectangleGogglesIcon />
                {t('dialog.launch.tile.vr')}
            </ContextMenuItem>
            <ContextMenuItem
                className="justify-center"
                disabled={disabled}
                onClick={() => {
                    void launch(true);
                }}
            >
                <MonitorIcon />
                {t('dialog.launch.tile.desktop')}
            </ContextMenuItem>
        </ContextMenuGroup>
    );
}
