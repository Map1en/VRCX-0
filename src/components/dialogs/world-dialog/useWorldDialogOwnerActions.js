import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { worldProfileRepository } from '@/repositories/index.js';

export function useWorldDialogOwnerActions({
    actionStatusRef,
    canManageWorld,
    closeDialog,
    confirm,
    currentEndpoint,
    currentUserId,
    isCurrentWorldTarget,
    prompt,
    setActionStatus,
    setHasPersistData,
    setOwnerEditor,
    setWorld,
    world
}) {
    const { t } = useTranslation();
    const worldNameOrId = world?.name || world?.id || '';

    async function saveWorldPatch(patch, { successMessage, errorMessage }) {
        if (!world?.id || !canManageWorld || actionStatusRef.current !== 'idle') {
            return false;
        }

        const targetWorldId = world.id;
        const targetEndpoint = currentEndpoint;
        actionStatusRef.current = 'save-world';
        setActionStatus('save-world');
        try {
            const response = await worldProfileRepository.saveWorld({
                worldId: targetWorldId,
                endpoint: targetEndpoint,
                params: {
                    id: targetWorldId,
                    ...patch
                }
            });
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return false;
            }
            setWorld((currentWorld) =>
                currentWorld
                    ? worldProfileRepository.normalize(
                          response.json && typeof response.json === 'object'
                              ? response.json
                              : { ...currentWorld, ...patch }
                      )
                    : currentWorld
            );
            toast.success(successMessage);
            return true;
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return false;
            }
            toast.error(userFacingErrorMessage(error, errorMessage));
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function renameWorld() {
        const result = await prompt({
            title: t('dialog.world.generated_modal.rename_world'),
            description: worldNameOrId,
            inputValue: world?.name || '',
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (result.ok) {
            await saveWorldPatch(
                { name: result.value },
                {
                    successMessage: 'World renamed.',
                    errorMessage: 'Failed to rename world.'
                }
            );
        }
    }

    async function changeWorldDescription() {
        const result = await prompt({
            title: t('dialog.world.generated_modal.change_world_description'),
            description: worldNameOrId,
            inputValue: world?.description || '',
            multiline: true,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (result.ok) {
            await saveWorldPatch(
                { description: result.value },
                {
                    successMessage: 'World description updated.',
                    errorMessage: 'Failed to update world description.'
                }
            );
        }
    }

    async function changeWorldCapacity(field, label) {
        const result = await prompt({
            title: t('dialog.world.generated_dynamic.change_value', { value: label }),
            description: worldNameOrId,
            inputValue: String(world?.[field] || ''),
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        const value = Number.parseInt(result.value, 10);
        if (!Number.isFinite(value) || value < 1) {
            toast.error(t('dialog.world.generated_dynamic.value_must_be_a_positive_number', { value: label }));
            return;
        }
        await saveWorldPatch(
            { [field]: value },
            {
                successMessage: `${label} updated.`,
                errorMessage: `Failed to update ${label}.`
            }
        );
    }

    async function changeWorldYouTubePreview() {
        const result = await prompt({
            title: t('dialog.world.generated_modal.change_youtube_preview'),
            description: worldNameOrId,
            inputValue: world?.previewYoutubeId || '',
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        let processedValue = String(result.value || '').trim();
        if (processedValue.length > 11) {
            try {
                const url = new URL(processedValue);
                const pathId = url.pathname.startsWith('/')
                    ? url.pathname.slice(1)
                    : url.pathname;
                const queryId = url.searchParams.get('v') || '';
                if (queryId.length === 11) {
                    processedValue = queryId;
                } else if (pathId.length === 11) {
                    processedValue = pathId;
                }
            } catch {
                toast.error(t('dialog.world.generated.youtube_preview_must_be_a_video_id_or_valid_url'));
                return;
            }
        }

        await saveWorldPatch(
            { previewYoutubeId: processedValue },
            {
                successMessage: 'YouTube preview updated.',
                errorMessage: 'Failed to update YouTube preview.'
            }
        );
    }

    function changeWorldTags() {
        setOwnerEditor('tags');
    }

    async function saveWorldTags(tags) {
        const saved = await saveWorldPatch(
            { tags },
            {
                successMessage: 'World tags updated.',
                errorMessage: 'Failed to update world tags.'
            }
        );
        if (saved) {
            setOwnerEditor('');
        }
    }

    function changeWorldAllowedDomains() {
        setOwnerEditor('allowed-domains');
    }

    async function saveWorldAllowedDomains(urlList) {
        const saved = await saveWorldPatch(
            { urlList },
            {
                successMessage: 'Allowed domains updated.',
                errorMessage: 'Failed to update allowed domains.'
            }
        );
        if (saved) {
            setOwnerEditor('');
        }
    }

    async function updateWorldPublication(nextPublished) {
        if (!world?.id || !canManageWorld || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: nextPublished ? 'Publish world?' : 'Unpublish world?',
            description: worldNameOrId,
            confirmText: nextPublished ? 'Publish' : 'Unpublish',
            cancelText: t('common.actions.cancel'),
            destructive: !nextPublished
        });
        if (!result.ok) {
            return;
        }

        const targetWorldId = world.id;
        const targetEndpoint = currentEndpoint;
        actionStatusRef.current = 'publish-world';
        setActionStatus('publish-world');
        try {
            const response = nextPublished
                ? await worldProfileRepository.publishWorld({
                      worldId: targetWorldId,
                      endpoint: targetEndpoint
                  })
                : await worldProfileRepository.unpublishWorld({
                      worldId: targetWorldId,
                      endpoint: targetEndpoint
                  });
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            setWorld((currentWorld) =>
                currentWorld
                    ? worldProfileRepository.normalize(
                          response.json && typeof response.json === 'object'
                              ? response.json
                              : currentWorld
                      )
                    : currentWorld
            );
            toast.success(
                nextPublished ? t('dialog.world.generated_toast.world_published') : t('dialog.world.generated_toast.world_unpublished')
            );
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_update_world_publication')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function deleteWorldPersistentData() {
        if (!currentUserId || !world?.id || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: t('dialog.world.generated_modal.delete_persistent_data'),
            description: worldNameOrId,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        const targetWorldId = world.id;
        const targetEndpoint = currentEndpoint;
        actionStatusRef.current = 'persistent-data';
        setActionStatus('persistent-data');
        try {
            await worldProfileRepository.deleteWorldPersistentData({
                userId: currentUserId,
                worldId: targetWorldId,
                endpoint: targetEndpoint
            });
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            setWorld((currentWorld) =>
                currentWorld
                    ? { ...currentWorld, hasPersistData: false }
                    : currentWorld
            );
            setHasPersistData(false);
            toast.success(t('dialog.world.generated.world_persistent_data_deleted'));
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_delete_world_persistent_data')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function deleteWorld() {
        if (!world?.id || !canManageWorld || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: t('dialog.world.generated_modal.delete_world'),
            description: worldNameOrId,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'delete';
        setActionStatus('delete');
        try {
            await worldProfileRepository.deleteWorld({
                worldId: world.id,
                endpoint: currentEndpoint
            });
            toast.success(t('dialog.world.generated.world_deleted'));
            closeDialog();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_delete_world')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        changeWorldAllowedDomains,
        changeWorldCapacity,
        changeWorldDescription,
        changeWorldTags,
        changeWorldYouTubePreview,
        deleteWorld,
        deleteWorldPersistentData,
        renameWorld,
        saveWorldAllowedDomains,
        saveWorldTags,
        updateWorldPublication
    };
}
