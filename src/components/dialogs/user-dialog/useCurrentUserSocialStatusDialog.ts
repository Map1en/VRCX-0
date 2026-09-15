import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { UserStatus } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';

import {
    normalizeSelfStatusInput,
    normalizeStatusHistoryRows,
    selfStatusBaseOptions
} from './userProfileFields';
import {
    useSelfStatusPresets,
    type SocialStatusDraft
} from './useSelfStatusPresets';
import type { UserDialogProfileRecord } from './useUserDialogProfileResource';

type SocialStatusPatch = {
    status: UserStatus;
    statusDescription: string;
};

type UseCurrentUserSocialStatusDialogProps = {
    profile: UserDialogProfileRecord | null;
    currentUserSnapshot?: UserDialogProfileRecord | null;
    busy?: boolean;
    onSave: (patch: SocialStatusPatch) => Promise<boolean>;
};

export function useCurrentUserSocialStatusDialog({
    profile,
    currentUserSnapshot = null,
    busy: externalBusy = false,
    onSave
}: UseCurrentUserSocialStatusDialogProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [draft, setDraft] = useState<SocialStatusDraft>({
        status: 'active',
        statusDescription: ''
    });
    const busy = externalBusy || saving;
    const statusOptions = useMemo<
        Array<{ value: UserStatus; label: string }>
    >(() => {
        const baseOptions = selfStatusBaseOptions.map((option) => ({
            value: option.value,
            label: t(option.labelKey)
        }));
        return profile?.$isModerator
            ? [
                  ...baseOptions,
                  {
                      value: 'offline',
                      label: t('dialog.user.status.offline')
                  }
              ]
            : baseOptions;
    }, [profile?.$isModerator, t]);
    const statusHistoryRows = useMemo(
        () => normalizeStatusHistoryRows(profile, currentUserSnapshot),
        [currentUserSnapshot, profile]
    );
    const statusLabelByValue = useMemo(
        () =>
            new Map(
                statusOptions.map((option) => [option.value, option.label])
            ),
        [statusOptions]
    );
    const { onRemovePreset, onSavePreset, statusPresets } =
        useSelfStatusPresets({ socialStatusDraft: draft });

    function openDialog() {
        if (busy || !profile) {
            return;
        }
        setDraft({
            status: normalizeSelfStatusInput(profile.status) || 'active',
            statusDescription: String(profile.statusDescription || '').slice(
                0,
                32
            )
        });
        setOpen(true);
    }

    function handleOpenChange(nextOpen: boolean) {
        if (nextOpen || !busy) {
            setOpen(nextOpen);
        }
    }

    async function save() {
        if (busy) {
            return;
        }
        const nextStatus = normalizeSelfStatusInput(draft.status);
        if (
            !nextStatus ||
            (!profile?.$isModerator && nextStatus === 'offline')
        ) {
            toast.add({
                type: 'warning',
                title: t(
                    'dialog.user.label.please_choose_a_valid_social_status'
                )
            });
            return;
        }

        setSaving(true);
        try {
            const saved = await onSave({
                status: nextStatus,
                statusDescription: String(draft.statusDescription || '').slice(
                    0,
                    32
                )
            });
            if (saved) {
                setOpen(false);
            }
        } finally {
            setSaving(false);
        }
    }

    return {
        dialog: {
            open,
            busy,
            draft,
            setDraft,
            statusHistoryRows,
            statusOptions,
            statusPresets,
            statusLabelByValue,
            onOpenChange: handleOpenChange,
            onSavePreset,
            onRemovePreset,
            onCancel: () => setOpen(false),
            onSave: save
        },
        openDialog
    };
}
