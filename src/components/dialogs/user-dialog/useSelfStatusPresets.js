import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { configRepository } from '@/repositories/index.js';

import {
    maxStatusPresets,
    normalizeSelfStatusInput,
    statusPresetsConfigKey
} from './userProfileFields.js';

export function useSelfStatusPresets({ socialStatusDraft, t }) {
    const [statusPresets, setStatusPresets] = useState([]);

    useEffect(() => {
        let active = true;

        configRepository
            .getArray(statusPresetsConfigKey, [])
            .then((presets) => {
                if (active) {
                    setStatusPresets(Array.isArray(presets) ? presets : []);
                }
            })
            .catch(() => {
                if (active) {
                    setStatusPresets([]);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    async function saveSelfStatusPreset() {
        const nextStatus = normalizeSelfStatusInput(socialStatusDraft.status);
        if (!nextStatus) {
            toast.warning(
                t('dialog.user.generated.please_choose_a_valid_social_status')
            );
            return;
        }

        const nextPreset = {
            status: nextStatus,
            statusDescription: String(
                socialStatusDraft.statusDescription || ''
            ).slice(0, 32)
        };
        if (
            statusPresets.some(
                (preset) =>
                    preset?.status === nextPreset.status &&
                    String(preset?.statusDescription || '') ===
                        nextPreset.statusDescription
            )
        ) {
            toast.info(t('dialog.user.generated.status_preset_already_exists'));
            return;
        }
        if (statusPresets.length >= maxStatusPresets) {
            toast.warning(
                t(
                    'dialog.user.generated_dynamic.status_presets_are_limited_to_value',
                    { value: maxStatusPresets }
                )
            );
            return;
        }

        const previousPresets = statusPresets;
        const nextPresets = [...previousPresets, nextPreset];
        setStatusPresets(nextPresets);
        try {
            await configRepository.setArray(
                statusPresetsConfigKey,
                nextPresets
            );
            toast.success(t('dialog.user.generated.status_preset_saved'));
        } catch (error) {
            setStatusPresets(previousPresets);
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.user.generated_toast.failed_to_save_status_preset'
                      )
            );
        }
    }

    async function removeSelfStatusPreset(index) {
        const previousPresets = statusPresets;
        const nextPresets = previousPresets.filter(
            (_, presetIndex) => presetIndex !== index
        );
        setStatusPresets(nextPresets);
        try {
            await configRepository.setArray(
                statusPresetsConfigKey,
                nextPresets
            );
        } catch (error) {
            setStatusPresets(previousPresets);
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.user.generated_toast.failed_to_remove_status_preset'
                      )
            );
        }
    }

    return {
        onRemovePreset: removeSelfStatusPreset,
        onSavePreset: saveSelfStatusPreset,
        statusPresets
    };
}
