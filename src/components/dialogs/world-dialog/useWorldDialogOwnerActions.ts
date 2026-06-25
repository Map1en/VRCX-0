import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import worldProfileRepository from '@/repositories/worldProfileRepository';

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
}: any) {
    const { t } = useTranslation();
    const worldNameOrId = world?.name || world?.id || '';

    async function saveWorldPatch(
        patch: any,
        { successMessage, errorMessage }: any
    ) {
        if (
            !world?.id ||
            !canManageWorld ||
            actionStatusRef.current !== 'idle'
        ) {
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
            setWorld((currentWorld: any) =>
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

    function processWorldYouTubePreview(value: any) {
        let processedValue = String(value || '').trim();
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
                toast.error(
                    t(
                        'dialog.world.label.youtube_preview_must_be_a_video_id_or_valid_url'
                    )
                );
                return null;
            }
        }
        return processedValue;
    }

    function readChangedTextField(patch: any, field: any, value: any) {
        const nextValue = String(value || '');
        if (nextValue !== String(world?.[field] || '')) {
            patch[field] = nextValue;
        }
    }

    function readChangedCapacityField(
        patch: any,
        field: any,
        value: any,
        label: any
    ) {
        const rawValue = String(value ?? '').trim();
        if (rawValue === String(world?.[field] ?? '')) {
            return true;
        }

        const parsedValue = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(parsedValue) || parsedValue < 1) {
            toast.error(
                t('dialog.world.dynamic.value_must_be_a_positive_number', {
                    value: label
                })
            );
            return false;
        }
        patch[field] = parsedValue;
        return true;
    }

    async function saveWorldDetails(draft: any) {
        const patch: any = {};
        readChangedTextField(patch, 'name', draft?.name);
        readChangedTextField(patch, 'description', draft?.description);
        if (
            !readChangedCapacityField(
                patch,
                'capacity',
                draft?.capacity,
                t('dialog.world.info.capacity')
            )
        ) {
            return false;
        }
        if (
            !readChangedCapacityField(
                patch,
                'recommendedCapacity',
                draft?.recommendedCapacity,
                t('dialog.world.label.recommended_capacity')
            )
        ) {
            return false;
        }

        const previewYoutubeId = processWorldYouTubePreview(
            draft?.previewYoutubeId
        );
        if (previewYoutubeId === null) {
            return false;
        }
        if (previewYoutubeId !== String(world?.previewYoutubeId || '')) {
            patch.previewYoutubeId = previewYoutubeId;
        }

        if (!Object.keys(patch).length) {
            setOwnerEditor('');
            return true;
        }

        const saved = await saveWorldPatch(patch, {
            successMessage: t('dialog.world.success.world_details_updated'),
            errorMessage: t('dialog.world.toast.failed_to_update_world_details')
        });
        if (saved) {
            setOwnerEditor('');
        }
        return saved;
    }

    async function renameWorld() {
        const result = await prompt({
            title: t('dialog.world.modal.rename_world'),
            description: worldNameOrId,
            inputValue: world?.name || '',
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (result.ok) {
            await saveWorldPatch(
                { name: result.value },
                {
                    successMessage: t('prompt.rename_world.message.success'),
                    errorMessage: t('dialog.world.toast.failed_to_rename_world')
                }
            );
        }
    }

    async function changeWorldDescription() {
        const result = await prompt({
            title: t('dialog.world.modal.change_world_description'),
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
                    successMessage: t(
                        'dialog.world.success.world_description_updated'
                    ),
                    errorMessage: t(
                        'dialog.world.toast.failed_to_update_world_description'
                    )
                }
            );
        }
    }

    async function changeWorldCapacity(field: any, label: any) {
        const result = await prompt({
            title: t('dialog.world.dynamic.change_value', {
                value: label
            }),
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
            toast.error(
                t('dialog.world.dynamic.value_must_be_a_positive_number', {
                    value: label
                })
            );
            return;
        }
        await saveWorldPatch(
            { [field]: value },
            {
                successMessage: t('dialog.world.dynamic.value_updated', {
                    value: label
                }),
                errorMessage: t('dialog.world.dynamic.failed_to_update_value', {
                    value: label
                })
            }
        );
    }

    async function changeWorldYouTubePreview() {
        const result = await prompt({
            title: t('dialog.world.modal.change_youtube_preview'),
            description: worldNameOrId,
            inputValue: world?.previewYoutubeId || '',
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        const processedValue = processWorldYouTubePreview(result.value);
        if (processedValue === null) {
            return;
        }

        await saveWorldPatch(
            { previewYoutubeId: processedValue },
            {
                successMessage: t(
                    'dialog.world.success.youtube_preview_updated'
                ),
                errorMessage: t(
                    'dialog.world.toast.failed_to_update_youtube_preview'
                )
            }
        );
    }

    function changeWorldTags() {
        setOwnerEditor('tags');
    }

    async function saveWorldTags(tags: any) {
        const saved = await saveWorldPatch(
            { tags },
            {
                successMessage: t('dialog.world.success.world_tags_updated'),
                errorMessage: t(
                    'dialog.world.toast.failed_to_update_world_tags'
                )
            }
        );
        if (saved) {
            setOwnerEditor('');
        }
    }

    function changeWorldAllowedDomains() {
        setOwnerEditor('allowed-domains');
    }

    async function saveWorldAllowedDomains(urlList: any) {
        const saved = await saveWorldPatch(
            { urlList },
            {
                successMessage: t(
                    'dialog.world.success.allowed_domains_updated'
                ),
                errorMessage: t(
                    'dialog.world.toast.failed_to_update_allowed_domains'
                )
            }
        );
        if (saved) {
            setOwnerEditor('');
        }
    }

    async function updateWorldPublication(nextPublished: any) {
        if (
            !world?.id ||
            !canManageWorld ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await confirm({
            title: nextPublished
                ? t('dialog.world.modal.publish_world')
                : t('dialog.world.modal.unpublish_world'),
            description: worldNameOrId,
            confirmText: nextPublished
                ? t('dialog.world.actions.publish')
                : t('dialog.world.actions.unpublish'),
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
            setWorld((currentWorld: any) =>
                currentWorld
                    ? worldProfileRepository.normalize(
                          response.json && typeof response.json === 'object'
                              ? response.json
                              : currentWorld
                      )
                    : currentWorld
            );
            toast.success(
                nextPublished
                    ? t('dialog.world.toast.world_published')
                    : t('dialog.world.toast.world_unpublished')
            );
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_update_world_publication')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function deleteWorldPersistentData() {
        if (
            !currentUserId ||
            !world?.id ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await confirm({
            title: t('dialog.world.modal.delete_persistent_data'),
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
            setWorld((currentWorld: any) =>
                currentWorld
                    ? { ...currentWorld, hasPersistData: false }
                    : currentWorld
            );
            setHasPersistData(false);
            toast.success(
                t('dialog.world.success.world_persistent_data_deleted')
            );
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.world.toast.failed_to_delete_world_persistent_data'
                      )
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function deleteWorld() {
        if (
            !world?.id ||
            !canManageWorld ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await confirm({
            title: t('dialog.world.modal.delete_world'),
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
            toast.success(t('dialog.world.success.world_deleted'));
            closeDialog();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_delete_world')
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
        saveWorldDetails,
        saveWorldAllowedDomains,
        saveWorldTags,
        updateWorldPublication
    };
}
