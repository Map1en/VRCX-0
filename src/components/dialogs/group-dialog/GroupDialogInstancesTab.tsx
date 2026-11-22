import { EyeOffIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    ToolbarActions,
    ToolbarRefreshButton,
    ToolbarStatus
} from '@/components/layout/ToolbarControls';
import type { GroupDialogInstanceRow } from '@/domain/entities/group';
import { Toggle } from '@/ui/shadcn/toggle';

import { GroupInstanceRows, isGroupInstanceFull } from './GroupInstanceRows';

export function GroupDialogInstancesTab({
    instances,
    currentUserId,
    onRefresh
}: {
    instances: GroupDialogInstanceRow[];
    currentUserId: string | null;
    onRefresh: () => void;
}) {
    const { t } = useTranslation();
    const [hideFull, setHideFull] = useState(false);
    const rows = useMemo(() => {
        const joinableFirst = [...instances].sort(
            (left, right) =>
                Number(isGroupInstanceFull(left)) -
                Number(isGroupInstanceFull(right))
        );
        return hideFull
            ? joinableFirst.filter((instance) => !isGroupInstanceFull(instance))
            : joinableFirst;
    }, [hideFull, instances]);

    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Toggle
                    pressed={hideFull}
                    onPressedChange={setHideFull}
                    className="text-muted-foreground hover:text-foreground data-pressed:text-foreground px-2.5 data-pressed:bg-(--state-pressed-surface)"
                >
                    <EyeOffIcon />
                    {t('dialog.world.instances.filter_hide_unavailable')}
                </Toggle>
                <ToolbarStatus className="mr-auto tabular-nums">
                    {hideFull ? `${rows.length}/${instances.length}` : null}
                </ToolbarStatus>
                <ToolbarActions>
                    <ToolbarRefreshButton onRefresh={onRefresh} />
                </ToolbarActions>
            </div>
            <GroupInstanceRows instances={rows} currentUserId={currentUserId} />
        </div>
    );
}
