import { useQuery } from '@tanstack/react-query';
import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type { WorldRatingValue } from '@/platform/tauri/bindings';
import worldProfileRepository, {
    worldRatingQueryOptions
} from '@/repositories/worldProfileRepository';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { DropdownMenuCheckboxItem } from '@/ui/shadcn/dropdown-menu';

import { EntityActionSeparator } from '../EntityDialogScaffold';

const RATING_OPTIONS = [
    {
        value: 'like',
        icon: ThumbsUpIcon,
        labelKey: 'dialog.world.actions.like'
    },
    {
        value: 'dislike',
        icon: ThumbsDownIcon,
        labelKey: 'dialog.world.actions.dislike'
    }
] as const satisfies ReadonlyArray<{
    value: WorldRatingValue;
    icon: typeof ThumbsUpIcon;
    labelKey: string;
}>;

export function WorldRatingMenuItems({ worldId }: { worldId: string }) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore(
        (state) => state.auth.currentUserId || ''
    );
    const [saving, setSaving] = useState(false);
    const { data: rating = null, isPending } = useQuery({
        ...worldRatingQueryOptions(currentUserId, worldId),
        enabled: Boolean(currentUserId && worldId)
    });

    if (!currentUserId || !worldId) {
        return null;
    }

    async function changeRating(value: WorldRatingValue | null) {
        setSaving(true);
        try {
            await worldProfileRepository.setWorldRating({
                userId: currentUserId,
                worldId,
                value
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title: userFacingErrorMessage(
                    error,
                    t('dialog.world.toast.failed_to_update_rating')
                )
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <EntityActionSeparator />
            {RATING_OPTIONS.map(({ value, icon: Icon, labelKey }) => (
                <DropdownMenuCheckboxItem
                    key={value}
                    checked={rating === value}
                    disabled={isPending || saving}
                    onCheckedChange={(checked) =>
                        void changeRating(checked ? value : null)
                    }
                >
                    <Icon />
                    <span className="min-w-0 flex-1">{t(labelKey)}</span>
                </DropdownMenuCheckboxItem>
            ))}
        </>
    );
}
