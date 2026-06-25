import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    readWorldCacheInfo,
    resolveWorldAssetBundleArgs
} from '@/lib/worldAssetBundle';
import { assetBundleRepository } from '@/repositories/assetBundleRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import { copyTextToClipboard } from '@/services/entityMediaService';
import { persistFavoriteWorldDetails } from '@/services/favoriteWorldCacheService';
import { openFolderAndSelectItem } from '@/services/shellIntegrationService';

import { normalizeEntityId } from './worldInstances';

export function useWorldActions({
    world,
    setWorld,
    currentEndpoint,
    currentUserId,
    profileWorldId,
    normalizedWorldId,
    isInstanceLocation,
    worldDialogShortName,
    isHomeWorld,
    canUpdateHome,
    actionStatusRef,
    setActionStatus,
    activeWorldTargetRef,
    memoRevisionRef,
    memo,
    setMemo,
    worldSideData,
    setWorldSideData,
    isCurrentWorldTarget,
    confirm,
    prompt,
    setAuthBootstrap
}: any) {
    const { t } = useTranslation();

    async function copyUnavailableWorldId() {
        if (!profileWorldId) {
            return;
        }
        await copyTextToClipboard(profileWorldId);
        toast.success(t('message.world.id_copied'));
    }

    async function refreshWorldProfile() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }

        const targetWorldId = profileWorldId;
        const targetEndpoint = currentEndpoint;
        actionStatusRef.current = 'refresh';
        setActionStatus('refresh');
        try {
            const nextWorld = await worldProfileRepository.getWorldProfile({
                worldId: targetWorldId,
                endpoint: targetEndpoint,
                force: true
            });
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            persistFavoriteWorldDetails(nextWorld);
            setWorld(nextWorld);
            toast.success(t('dialog.world.success.world_refreshed'));
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_refresh_world')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function launchInstance() {
        if (!isInstanceLocation || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'launching';
        setActionStatus('launching');
        try {
            const opened = await tryOpenLaunchLocation(
                normalizedWorldId,
                worldDialogShortName,
                currentEndpoint
            );
            if (opened) {
                toast.success(
                    t('dialog.world.success.vrchat_launch_request_sent')
                );
                return;
            }
            toast.error(
                t('dialog.world.error.unable_to_open_this_instance_in_vrchat')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_launch_vrchat_instance')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateHomeLocation() {
        if (!canUpdateHome || actionStatusRef.current !== 'idle') {
            return;
        }

        actionStatusRef.current = 'home';
        setActionStatus('home');
        const nextHomeLocation = isHomeWorld ? '' : world.id;
        const result = await confirm({
            title: isHomeWorld
                ? t('dialog.world.modal.reset_home_world')
                : t('dialog.world.modal.make_home_world'),
            description: isHomeWorld
                ? t('dialog.world.action.reset_your_vrchat_home_location')
                : t(
                      'dialog.world.dynamic.set_value_as_your_vrchat_home_world',
                      { value: world.name || world.id }
                  ),
            confirmText: isHomeWorld
                ? t('dialog.world.actions.reset_home')
                : t('dialog.world.actions.make_home'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const nextUser = await userProfileRepository.updateCurrentUser({
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: {
                    homeLocation: nextHomeLocation
                }
            });
            if (nextUser?.id) {
                setAuthBootstrap({
                    currentUserId: nextUser.id,
                    currentUserDisplayName:
                        nextUser.displayName ||
                        nextUser.username ||
                        nextUser.id,
                    currentUserSnapshot: nextUser
                });
            }
            toast.success(
                isHomeWorld
                    ? t('dialog.world.toast.home_world_reset')
                    : t('message.world.home_updated')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_update_home_world')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function saveMemo(nextValue: any) {
        const targetWorldId = normalizeEntityId(world.id);
        memoRevisionRef.current += 1;
        try {
            const nextEntry = await memoPersistenceRepository.saveWorldMemo({
                worldId: targetWorldId,
                memo: nextValue
            });
            if (activeWorldTargetRef.current.worldId !== targetWorldId) {
                return;
            }
            const nextMemo = String(nextEntry.memo || '');
            setMemo(nextMemo);
            toast.success(
                nextMemo
                    ? t('dialog.world.toast.memo_saved')
                    : t('dialog.world.toast.memo_cleared')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_save_memo')
            );
        }
    }

    async function openWorldCacheFolder() {
        const cachePath = worldSideData.cache.cachePath;
        if (!cachePath) {
            return;
        }
        try {
            await openFolderAndSelectItem(cachePath, true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_open_world_cache_folder')
            );
        }
    }

    async function deleteWorldCache() {
        if (actionStatusRef.current !== 'idle') {
            return;
        }
        const targetWorld = world;
        const targetWorldId = targetWorld.id;
        const targetEndpoint = currentEndpoint;
        actionStatusRef.current = 'cache';
        setActionStatus('cache');
        try {
            const configResponse = await vrchatAuthRepository
                .getConfig({ endpoint: targetEndpoint })
                .catch((): null => null);
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            const args = resolveWorldAssetBundleArgs(
                targetWorld,
                String(configResponse?.json?.sdkUnityVersion || '')
            );
            if (!args) {
                toast.error(
                    t('dialog.world.error.world_cache_location_unavailable')
                );
                return;
            }
            await assetBundleRepository.deleteCache(
                args.fileId,
                args.fileVersion,
                args.variant,
                args.variantVersion
            );
            const cache = await readWorldCacheInfo(targetWorld, targetEndpoint);
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            setWorldSideData((current: any) => ({ ...current, cache }));
            toast.success(t('dialog.world.success.world_cache_deleted'));
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_delete_world_cache')
            );
        } finally {
            if (actionStatusRef.current === 'cache') {
                actionStatusRef.current = 'idle';
                setActionStatus('idle');
            }
        }
    }

    async function editMemo() {
        const result = await prompt({
            title: t('dialog.world.modal.edit_local_memo'),
            description: world.name || world.id,
            inputValue: memo,
            multiline: true,
            confirmText: t('common.actions.save'),
            cancelText: t('common.actions.cancel')
        });

        if (!result.ok) {
            return;
        }

        await saveMemo(result.value);
    }

    return {
        copyUnavailableWorldId,
        refreshWorldProfile,
        launchInstance,
        updateHomeLocation,
        saveMemo,
        editMemo,
        openWorldCacheFolder,
        deleteWorldCache
    };
}
