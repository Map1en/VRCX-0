import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import gameLogRepository from '@/repositories/gameLogRepository';

import {
    getGameLogRowKey,
    normalizeGameLogId as normalizeId,
    resolveGameLogWorldId as resolveWorldId
} from './gameLogRows';
import type { GameLogPreviousInstanceRow, GameLogRow } from './gameLogTypes';

export function useGameLogPreviousInstancesDialog() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<GameLogPreviousInstanceRow[]>([]);
    const [title, setTitle] = useState('Instance History');
    const [loadingKey, setLoadingKey] = useState('');

    const openPreviousInstancesForRow = useCallback(
        async (row: GameLogRow) => {
            const rowKey = getGameLogRowKey(row);
            const worldId = resolveWorldId(row);
            if (!worldId || loadingKey) {
                return;
            }
            setLoadingKey(rowKey || worldId);
            try {
                const instances =
                    await gameLogRepository.getPreviousInstancesByWorldId({
                        worldId
                    });
                const currentLocation = normalizeId(row?.location);
                const sortedInstances = [...instances].sort((left, right) => {
                    if (currentLocation) {
                        if (normalizeId(left?.location) === currentLocation) {
                            return -1;
                        }
                        if (normalizeId(right?.location) === currentLocation) {
                            return 1;
                        }
                    }
                    return (
                        Date.parse(String(right?.created_at || 0)) -
                        Date.parse(String(left?.created_at || 0))
                    );
                });
                setRows(sortedInstances);
                setTitle(`Instance History - ${row?.worldName || 'World'}`);
                setOpen(true);
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.game_log.toast.failed_to_load_instance_history'
                          )
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
        openPreviousInstancesForRow,
        rows,
        setOpen,
        setRows,
        title
    };
}
