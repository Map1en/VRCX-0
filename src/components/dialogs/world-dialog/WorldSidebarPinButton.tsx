import { PinIcon, PinOffIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from '@/services/toastService';
import {
    hydrateSidebarTabLayout,
    pinWorldRoomsTab,
    unpinWorldRoomsTab,
    useSidebarTabStore
} from '@/state/sidebarTabStore';
import { Button } from '@/ui/shadcn/button';

export function WorldSidebarPinButton({
    worldId,
    name
}: {
    worldId: string;
    name: string;
}) {
    const { t } = useTranslation();
    const hydrated = useSidebarTabStore((state) => state.tabLayoutHydrated);
    const pinned = useSidebarTabStore((state) =>
        state.tabLayout.some(
            (item) =>
                item.type === 'worldRooms' &&
                item.worldId === worldId &&
                item.visible
        )
    );

    useEffect(() => {
        hydrateSidebarTabLayout().catch(() => {});
    }, []);

    function toggle() {
        const [action, successKey, failureKey] = pinned
            ? [
                  () => unpinWorldRoomsTab(worldId),
                  'dialog.world.instances.unpinned_from_sidebar',
                  'dialog.world.instances.unpin_from_sidebar_failed'
              ]
            : [
                  () => pinWorldRoomsTab({ worldId, name }),
                  'dialog.world.instances.pinned_to_sidebar',
                  'dialog.world.instances.pin_to_sidebar_failed'
              ];
        action()
            .then(() => toast.add({ type: 'success', title: t(successKey) }))
            .catch(() => toast.add({ type: 'error', title: t(failureKey) }));
    }

    return (
        <Button
            type="button"
            variant="outline"
            data-vrcx-0-control="toolbar"
            className="vrcx-0-toolbar-control ml-auto"
            disabled={!worldId || !hydrated}
            onClick={toggle}
        >
            {pinned ? (
                <PinOffIcon data-icon="inline-start" />
            ) : (
                <PinIcon data-icon="inline-start" />
            )}
            {pinned
                ? t('dialog.world.instances.unpin_from_sidebar')
                : t('dialog.world.instances.pin_to_sidebar')}
        </Button>
    );
}
