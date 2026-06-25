import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openUserDialog } from '@/services/dialogService';
import {
    refreshModerationSync,
    updateModerationSync
} from '@/services/moderationSyncService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    getModerationRowKey,
    isSameModerationRow
} from './moderationPageState';
import type {
    DeleteModerationOptions,
    ModerationRow,
    ModerationUserTarget
} from './moderationPageTypes';

type ModerationRowActionsOptions = {
    rows: ModerationRow[];
    setDetail: Dispatch<SetStateAction<string>>;
    setRows: Dispatch<SetStateAction<ModerationRow[]>>;
};

export function useModerationRowActions({
    rows,
    setDetail,
    setRows
}: ModerationRowActionsOptions) {
    const { t } = useTranslation();
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const confirm = useModalStore((state: any) => state.confirm);
    const [deletingModerationKey, setDeletingModerationKey] = useState('');

    const handleDeleteModeration = async (
        row: ModerationRow,
        { skipConfirm = false }: DeleteModerationOptions = {}
    ) => {
        const ownerUserId = currentUserId;
        if (!ownerUserId || row?.sourceUserId !== ownerUserId) {
            return;
        }
        const result = skipConfirm
            ? {
                  ok: true
              }
            : await confirm({
                  title: t('common.actions.confirm'),
                  description: `Continue? Moderation ${row.type || ''}`.trim(),
                  destructive: true,
                  confirmText: t('common.actions.delete'),
                  cancelText: t('common.actions.cancel')
              });
        if (
            !result.ok ||
            useRuntimeStore.getState().auth.currentUserId !== ownerUserId
        ) {
            return;
        }
        const { targetUserId, type } = row;
        if (!targetUserId || !type) {
            return;
        }
        const rowKey = getModerationRowKey(row);
        setDeletingModerationKey(rowKey);
        try {
            await updateModerationSync({
                ownerUserId,
                endpoint: currentEndpoint,
                targetUserId,
                targetDisplayName: row.targetDisplayName || targetUserId,
                type,
                enabled: false
            });
            if (useRuntimeStore.getState().auth.currentUserId !== ownerUserId) {
                return;
            }
            const response = await refreshModerationSync({
                userId: ownerUserId,
                endpoint: currentEndpoint
            });
            const nextRows = Array.isArray(response?.rows)
                ? response.rows
                : rows.filter((entry) => !isSameModerationRow(entry, row));
            setRows(nextRows);
            setDetail(
                t('view.moderation.dynamic.deleted_value_for_value', {
                    value: row.type || 'moderation',
                    value2: row.targetDisplayName || row.targetUserId
                })
            );
        } catch (error) {
            setDetail(
                error instanceof Error
                    ? error.message
                    : 'Failed to delete moderation.'
            );
        } finally {
            setDeletingModerationKey((currentKey) =>
                currentKey === rowKey ? '' : currentKey
            );
        }
    };

    function openModerationUser({ userId, title }: ModerationUserTarget) {
        if (!userId) {
            return;
        }
        openUserDialog({
            userId,
            title
        });
    }

    return {
        deletingModerationKey,
        handleDeleteModeration,
        openModerationUser
    };
}
