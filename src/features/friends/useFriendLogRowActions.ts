import { useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useStableCommands } from '@/lib/useStableCommands';
import friendLogHistoryRepository from '@/repositories/friendLogHistoryRepository';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    getFriendLogRowKey,
    normalizeUserId,
    type FriendLogRow
} from './friendLogRows';

type DeleteFriendLogRowOptions = {
    skipConfirm?: boolean;
};

export function useFriendLogRowActions({
    currentUserId,
    loadStatus,
    rowsOwnerUserId,
    rowsOwnerUserIdRef,
    setDetail,
    removeRow
}: {
    currentUserId: string;
    loadStatus: string;
    rowsOwnerUserId: string;
    rowsOwnerUserIdRef: MutableRefObject<string>;
    setDetail(value: string): void;
    removeRow(row: FriendLogRow): void;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const [deletingRowKey, setDeletingRowKey] = useState('');

    async function handleDeleteRow(
        row: FriendLogRow,
        { skipConfirm = false }: DeleteFriendLogRowOptions = {}
    ) {
        const ownerUserId = normalizeUserId(currentUserId);
        if (
            !ownerUserId ||
            !row ||
            rowsOwnerUserId !== ownerUserId ||
            loadStatus === 'running'
        ) {
            return;
        }
        const rowKey = getFriendLogRowKey(row, ownerUserId);

        const result = skipConfirm
            ? { ok: true }
            : await confirm({
                  title: t('common.actions.confirm'),
                  description: t('confirm.delete_log'),
                  confirmText: t('common.actions.delete'),
                  cancelText: t('common.actions.cancel'),
                  destructive: true
              });

        if (!result.ok) {
            return;
        }

        if (
            normalizeUserId(useRuntimeStore.getState().auth.currentUserId) !==
                ownerUserId ||
            rowsOwnerUserIdRef.current !== ownerUserId
        ) {
            setDetail(
                'Friend history owner changed before delete; refresh and try again.'
            );
            return;
        }

        setDeletingRowKey(rowKey);
        try {
            const affectedRows = Number(
                await friendLogHistoryRepository.deleteFriendLogHistory(
                    ownerUserId,
                    row
                )
            );
            if (
                normalizeUserId(
                    useRuntimeStore.getState().auth.currentUserId
                ) !== ownerUserId ||
                rowsOwnerUserIdRef.current !== ownerUserId
            ) {
                return;
            }
            if (!Number.isFinite(affectedRows) || affectedRows <= 0) {
                setDetail(
                    'No matching friend history row was deleted; refresh and try again.'
                );
                return;
            }
            removeRow(row);
            setDetail('Deleted one friend history row.');
        } catch (error) {
            setDetail(
                error instanceof Error
                    ? error.message
                    : 'Failed to delete the friend history row.'
            );
        } finally {
            setDeletingRowKey('');
        }
    }

    const stableCommands = useStableCommands({ handleDeleteRow });

    return {
        deletingRowKey,
        handleDeleteRow: stableCommands.handleDeleteRow
    };
}
