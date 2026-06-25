import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import gameLogRepository from '@/repositories/gameLogRepository';
import { copyTextToClipboard } from '@/services/entityMediaService';
import { useModalStore } from '@/state/modalStore';

import {
    canDeleteGameLogRow,
    describeGameLogDetail,
    getGameLogCopyTarget,
    getGameLogRowKey,
    normalizeGameLogId as normalizeId
} from './gameLogRows';
import type { GameLogRow } from './gameLogTypes';

type DeleteOptions = {
    skipConfirm?: boolean;
};

type UseGameLogRowActionsOptions = {
    removeRowByKey(rowKey: string): void;
};

export function useGameLogRowActions({
    removeRowByKey
}: UseGameLogRowActionsOptions) {
    const { t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const [deletingGameLogKey, setDeletingGameLogKey] = useState('');

    const deleteGameLogRow = useCallback(
        async (
            row: GameLogRow,
            { skipConfirm = false }: DeleteOptions = {}
        ) => {
            if (!canDeleteGameLogRow(row)) {
                return;
            }
            const rowKey = getGameLogRowKey(row);
            if (!rowKey || deletingGameLogKey) {
                return;
            }
            if (!skipConfirm) {
                const detailValue = describeGameLogDetail(row);
                const result = await confirm({
                    title: t('view.game_log.modal.delete_game_log_row'),
                    description:
                        detailValue.primary ||
                        normalizeId(row.type) ||
                        normalizeId(row.created_at),
                    confirmText: t('common.actions.delete'),
                    cancelText: t('common.actions.cancel'),
                    destructive: true
                });
                if (!result.ok) {
                    return;
                }
            }
            setDeletingGameLogKey(rowKey);
            try {
                await gameLogRepository.deleteGameLogEntry(row);
                removeRowByKey(rowKey);
                toast.success(t('view.game_log.success.game_log_row_deleted'));
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.game_log.toast.failed_to_delete_game_log_row')
                );
            } finally {
                setDeletingGameLogKey('');
            }
        },
        [confirm, deletingGameLogKey, removeRowByKey, t]
    );

    const copyGameLogDetail = useCallback(
        async (row: GameLogRow) => {
            const text = getGameLogCopyTarget(row);
            if (!text) {
                return;
            }
            await copyTextToClipboard(text);
            toast.success(t('view.game_log.success.copied_game_log_detail'));
        },
        [t]
    );

    return useMemo(
        () => ({
            deletingGameLogKey,
            copyGameLogDetail,
            deleteGameLogRow
        }),
        [copyGameLogDetail, deleteGameLogRow, deletingGameLogKey]
    );
}
