import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import gameLogRepository from '@/repositories/gameLogRepository';
import { parseLocation } from '@/shared/utils/location';

import { normalizeFeedId as normalizeId } from './feedRows';
import type {
    FeedLocationActionPayload,
    FeedPreviousInstanceRow
} from './feedTypes';

export function useFeedPreviousInstancesDialog() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<FeedPreviousInstanceRow[]>([]);
    const [title, setTitle] = useState('Instance History');
    const [loadingKey, setLoadingKey] = useState('');

    const openPreviousInstancesForLocation = useCallback(
        async ({
            location = '',
            worldId = '',
            worldName = '',
            groupName = ''
        }: FeedLocationActionPayload = {}) => {
            const normalizedLocation = normalizeId(location);
            const normalizedWorldId =
                normalizeId(worldId) ||
                parseLocation(normalizedLocation).worldId;
            if (!normalizedWorldId || loadingKey) {
                return;
            }
            setLoadingKey(normalizedLocation || normalizedWorldId);
            try {
                const instances =
                    await gameLogRepository.getPreviousInstancesByWorldId({
                        worldId: normalizedWorldId
                    });
                const sortedInstances = [...instances].sort((left, right) => {
                    if (normalizedLocation) {
                        if (
                            normalizeId(left?.location) === normalizedLocation
                        ) {
                            return -1;
                        }
                        if (
                            normalizeId(right?.location) === normalizedLocation
                        ) {
                            return 1;
                        }
                    }
                    return (
                        Date.parse(
                            String(right?.created_at || right?.createdAt || 0)
                        ) -
                        Date.parse(
                            String(left?.created_at || left?.createdAt || 0)
                        )
                    );
                });
                setRows(sortedInstances);
                setTitle(
                    `${t('dialog.previous_instances.header')} - ${
                        [worldName || 'World', groupName]
                            .filter(Boolean)
                            .join(' / ') || 'World'
                    }`
                );
                setOpen(true);
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.feed.toast.failed_to_load_instance_history')
                );
            } finally {
                setLoadingKey('');
            }
        },
        [loadingKey, t]
    );

    return {
        loadingKey,
        open,
        openPreviousInstancesForLocation,
        rows,
        setOpen,
        setRows,
        title
    };
}
