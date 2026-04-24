import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold.jsx';
import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';
import {
    convertFileUrlToImageUrl,
    copyTextToClipboard
} from '@/lib/entityMedia.js';
import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis.js';
import {
    defaultWorldCacheInfo,
    readWorldCacheInfo,
    resolveWorldAssetBundleArgs
} from '@/lib/worldAssetBundle.js';
import { backend } from '@/platform/tauri/index.js';
import {
    configRepository,
    gameLogRepository,
    instanceRepository,
    mediaRepository,
    memoRepository,
    userProfileRepository,
    vrchatAuthRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useLaunchStore } from '@/state/launchStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Input } from '@/ui/shadcn/input';

import { Spinner } from '@/ui/shadcn/spinner';
import { InstanceInviteDialog } from './InstanceInviteDialog.jsx';
import { resolveCreatedInstanceDetails } from './world-dialog/worldInstanceResolver.js';
import {
    normalizeEntityId,
    parseRoleIds,
    resolveInstanceLocation
} from './world-dialog/worldInstances.js';
import { WorldNewInstanceDialog } from './world-dialog/WorldNewInstanceDialog.jsx';
import { useWorldDialogOwnerActions } from './world-dialog/useWorldDialogOwnerActions.js';
import { WorldDialogTabbedView } from './WorldDialogTabbedView.jsx';
import {
    WorldAllowedDomainsDialog,
    WorldTagsDialog
} from './WorldOwnerEditDialogs.jsx';

function WorldDialogEmptyState({ title, description, loading = false }) {
    return (
        <AppEmptyState
            className="min-h-56"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        />
    );
}

function defaultWorldSideData() {
    return {
        fileAnalysis: {},
        cache: defaultWorldCacheInfo()
    };
}

export function WorldDialogContent({
    worldId,
    seedData = null,
    initialAction = '',
    initialActionNonce = 0
}) {
    const { t } = useTranslation();

    const normalizedWorldId = normalizeEntityId(worldId);
    const profileWorldId = normalizedWorldId.split(':')[0] || normalizedWorldId;
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentHomeLocation = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.homeLocation || ''
    );
    const setAuthBootstrap = useRuntimeStore((state) => state.setAuthBootstrap);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const updateEntityDialogMetadata = useDialogStore(
        (state) => state.updateEntityDialogMetadata
    );
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const [world, setWorld] = useState(() =>
        seedData ? worldProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState(
        normalizedWorldId ? 'running' : 'idle'
    );
    const [actionStatus, setActionStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [memo, setMemo] = useState('');
    const [previousInstances, setPreviousInstances] = useState([]);
    const [hasPersistData, setHasPersistData] = useState(false);
    const [worldSideData, setWorldSideData] = useState(() =>
        defaultWorldSideData()
    );
    const [newInstanceRequest, setNewInstanceRequest] = useState(null);
    const [inviteRequest, setInviteRequest] = useState(null);
    const [imageCropRequest, setImageCropRequest] = useState(null);
    const [ownerEditor, setOwnerEditor] = useState('');
    const actionStatusRef = useRef('idle');
    const memoRevisionRef = useRef(0);
    const activeWorldTargetRef = useRef({
        worldId: profileWorldId,
        endpoint: currentEndpoint
    });
    const handledInitialActionRef = useRef('');
    const imageUploadInputRef = useRef(null);
    const imageUploadWorldRef = useRef(null);

    useEffect(() => {
        setWorld(seedData ? worldProfileRepository.normalize(seedData) : null);
    }, [seedData]);

    useEffect(() => {
        activeWorldTargetRef.current = {
            worldId: profileWorldId,
            endpoint: currentEndpoint
        };
    }, [currentEndpoint, profileWorldId]);

    useEffect(() => {
        if (!world?.id || !world?.name) {
            return;
        }
        updateEntityDialogMetadata({
            kind: 'world',
            entityId: normalizedWorldId,
            title: world.name
        });
    }, [normalizedWorldId, updateEntityDialogMetadata, world?.id, world?.name]);

    useEffect(() => {
        imageUploadWorldRef.current = null;
        setImageCropRequest(null);
        setNewInstanceRequest(null);
        setOwnerEditor('');
        setWorldSideData(defaultWorldSideData());
        handledInitialActionRef.current = '';
    }, [profileWorldId]);

    useEffect(() => {
        let active = true;

        if (!world?.id) {
            setWorldSideData(defaultWorldSideData());
            return () => {
                active = false;
            };
        }

        const targetWorldId = world.id;
        const targetEndpoint = currentEndpoint;
        vrchatAuthRepository
            .getConfig({ endpoint: targetEndpoint })
            .catch(() => null)
            .then((configResponse) =>
                Promise.allSettled([
                    readWorldCacheInfo(world, targetEndpoint),
                    getFileAnalysisForUnityPackages({
                        unityPackages: world.unityPackages,
                        sdkUnityVersion: String(
                            configResponse?.json?.sdkUnityVersion || ''
                        ),
                        endpoint: targetEndpoint
                    })
                ])
            )
            .then(([cacheResult, fileAnalysisResult]) => {
                if (
                    active &&
                    isCurrentWorldTarget(targetWorldId, targetEndpoint)
                ) {
                    setWorldSideData({
                        cache:
                            cacheResult.status === 'fulfilled'
                                ? cacheResult.value
                                : defaultWorldSideData().cache,
                        fileAnalysis:
                            fileAnalysisResult.status === 'fulfilled'
                                ? fileAnalysisResult.value
                                : {}
                    });
                }
            })
            .catch(() => {
                if (
                    active &&
                    isCurrentWorldTarget(targetWorldId, targetEndpoint)
                ) {
                    setWorldSideData(defaultWorldSideData());
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, world?.id, world?.updatedAt, world?.version]);

    useEffect(() => {
        let active = true;

        if (!normalizedWorldId) {
            setWorld(null);
            setLoadStatus('error');
            setDetail('No world id was provided for this dialog.');
            return () => {
                active = false;
            };
        }

        setWorld(seedData ? worldProfileRepository.normalize(seedData) : null);
        setLoadStatus('running');
        setDetail('');

        worldProfileRepository
            .getWorldProfile({
                worldId: profileWorldId,
                endpoint: currentEndpoint,
                dialog: true
            })
            .then((nextWorld) => {
                if (!active) {
                    return;
                }

                setWorld(nextWorld);
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                if (seedData) {
                    setWorld(worldProfileRepository.normalize(seedData));
                    setLoadStatus('ready');
                    setDetail(
                        error instanceof Error
                            ? error.message
                            : 'Failed to refresh the remote world snapshot.'
                    );
                    return;
                }

                setWorld(null);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the world profile.'
                );
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedWorldId, profileWorldId, seedData]);

    useEffect(() => {
        let active = true;

        if (!profileWorldId) {
            setMemo('');
            return () => {
                active = false;
            };
        }

        setMemo('');
        const revision = memoRevisionRef.current;
        memoRepository
            .getWorldMemo(profileWorldId)
            .then((entry) => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo(entry?.memo || '');
                }
            })
            .catch(() => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo('');
                }
            });

        return () => {
            active = false;
        };
    }, [profileWorldId]);

    useEffect(() => {
        let active = true;

        if (!profileWorldId) {
            setHasPersistData(false);
            return () => {
                active = false;
            };
        }

        if (!currentUserId) {
            setHasPersistData(Boolean(world?.hasPersistData));
            return () => {
                active = false;
            };
        }

        worldProfileRepository
            .hasWorldPersistentData({
                userId: currentUserId,
                worldId: profileWorldId,
                endpoint: currentEndpoint
            })
            .then((exists) => {
                if (active) {
                    setHasPersistData(exists);
                }
            })
            .catch(() => {
                if (active) {
                    setHasPersistData(Boolean(world?.hasPersistData));
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, profileWorldId, world?.hasPersistData]);

    useEffect(() => {
        let active = true;

        if (!profileWorldId) {
            setPreviousInstances([]);
            return () => {
                active = false;
            };
        }

        gameLogRepository
            .getPreviousInstancesByWorldId({ worldId: profileWorldId })
            .then((rows) => {
                if (!active) {
                    return;
                }
                const values = Array.isArray(rows) ? rows : [];
                setPreviousInstances(values);
            })
            .catch(() => {
                if (active) {
                    setPreviousInstances([]);
                }
            });

        return () => {
            active = false;
        };
    }, [profileWorldId]);

    useEffect(() => {
        const normalizedInitialAction = normalizeEntityId(initialAction);
        const actionKey = `${profileWorldId}:${normalizedInitialAction}:${initialActionNonce}`;
        if (
            !world?.id ||
            !normalizedInitialAction ||
            handledInitialActionRef.current === actionKey
        ) {
            return;
        }

        handledInitialActionRef.current = actionKey;
        if (normalizedInitialAction === 'newInstanceSelfInvite') {
            void openNewInstanceDialog(true);
        } else if (normalizedInitialAction === 'newInstance') {
            void openNewInstanceDialog(false);
        }
    }, [initialAction, initialActionNonce, profileWorldId, world?.id]);

    const isInstanceLocation = normalizedWorldId.includes(':');
    const worldDialogShortName = isInstanceLocation
        ? parseLocation(normalizedWorldId).shortName
        : '';
    const isHomeWorld =
        normalizeEntityId(currentHomeLocation) === normalizeEntityId(world?.id);
    const canUpdateHome = Boolean(currentUserId && world?.id);
    const canManageWorld =
        normalizeEntityId(world?.authorId) === normalizeEntityId(currentUserId);

    function isCurrentWorldTarget(targetWorldId, targetEndpoint) {
        return (
            activeWorldTargetRef.current.worldId ===
                normalizeEntityId(targetWorldId) &&
            activeWorldTargetRef.current.endpoint === targetEndpoint
        );
    }

    const ownerActions = useWorldDialogOwnerActions({
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
    });

    if (loadStatus === 'running' && !world) {
        return (
            <WorldDialogEmptyState
                loading
                title={t('dialog.world.generated.loading_world_profile')}
                description={t('dialog.world.generated.fetching_the_current_vrchat_world_snapshot_for_this_dialog')}
            />
        );
    }

    if (!world) {
        return (
            <WorldDialogEmptyState
                title={t('dialog.world.generated.world_profile_unavailable')}
                description={
                    detail ||
                    'VRCX-0 could not resolve a world snapshot for this dialog.'
                }
            />
        );
    }

    const imageUrl = convertFileUrlToImageUrl(
        world.imageUrl || world.thumbnailImageUrl,
        512
    );
    const worldForView = {
        ...world,
        $isCached: worldSideData.cache.inCache,
        $cacheSize: worldSideData.cache.cacheSize,
        $cacheLocked: worldSideData.cache.cacheLocked,
        $cachePath: worldSideData.cache.cachePath,
        fileAnalysis: worldSideData.fileAnalysis
    };

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
            setWorld(nextWorld);
            toast.success(t('dialog.world.generated.world_refreshed'));
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_refresh_world')
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
                toast.success(t('dialog.world.generated.vrchat_launch_request_sent'));
                return;
            }
            toast.error(t('dialog.world.generated.unable_to_open_this_instance_in_vrchat'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_launch_vrchat_instance')
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
            title: isHomeWorld ? 'Reset home world?' : 'Make home world?',
            description: isHomeWorld
                ? 'Reset your VRChat home location.'
                : `Set ${world.name || world.id} as your VRChat home world?`,
            confirmText: isHomeWorld ? 'Reset Home' : 'Make Home',
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
                isHomeWorld ? t('dialog.world.generated_toast.home_world_reset') : t('dialog.world.generated_toast.home_world_updated')
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_update_home_world')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function saveMemo(nextValue) {
        const targetWorldId = normalizeEntityId(world.id);
        memoRevisionRef.current += 1;
        try {
            const nextEntry = await memoRepository.saveWorldMemo({
                worldId: targetWorldId,
                memo: nextValue
            });
            if (activeWorldTargetRef.current.worldId !== targetWorldId) {
                return;
            }
            const nextMemo = nextEntry.memo || '';
            setMemo(nextMemo);
            toast.success(nextMemo ? t('dialog.world.generated_toast.memo_saved') : t('dialog.world.generated_toast.memo_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : t('dialog.world.generated_toast.failed_to_save_memo')
            );
        }
    }

    async function openWorldCacheFolder() {
        const cachePath = worldSideData.cache.cachePath;
        if (!cachePath) {
            return;
        }
        try {
            await backend.app.OpenFolderAndSelectItem(cachePath, true);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_open_world_cache_folder')
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
                .catch(() => null);
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            const args = resolveWorldAssetBundleArgs(
                targetWorld,
                String(configResponse?.json?.sdkUnityVersion || '')
            );
            if (!args) {
                toast.error(t('dialog.world.generated.world_cache_location_unavailable'));
                return;
            }
            await backend.assetBundle.DeleteCache(
                args.fileId,
                args.fileVersion,
                args.variant,
                args.variantVersion
            );
            const cache = await readWorldCacheInfo(targetWorld, targetEndpoint);
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            setWorldSideData((current) => ({ ...current, cache }));
            toast.success(t('dialog.world.generated.world_cache_deleted'));
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_delete_world_cache')
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
            title: t('dialog.world.generated_modal.edit_local_memo'),
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

    async function loadNewInstanceDefaults() {
        const [
            accessType,
            region,
            groupId,
            groupAccessType,
            ageGate,
            queueEnabled
        ] = await Promise.all([
            configRepository.getString('instanceDialogAccessType', 'public'),
            configRepository.getString('instanceRegion', 'US West'),
            configRepository.getString('instanceDialogGroupId', ''),
            configRepository.getString('instanceDialogGroupAccessType', 'plus'),
            configRepository.getBool('instanceDialogAgeGate', false),
            configRepository.getBool('instanceDialogQueueEnabled', true)
        ]);
        return {
            accessType: accessType || 'public',
            region: region || 'US West',
            groupId: groupId || '',
            groupAccessType: groupAccessType || 'plus',
            queueEnabled: Boolean(queueEnabled),
            ageGate: Boolean(ageGate),
            displayName: '',
            roleIds: ''
        };
    }

    async function openNewInstanceDialog(selfInvite = false) {
        if (!world.id || actionStatusRef.current !== 'idle') {
            return;
        }
        try {
            const defaults = await loadNewInstanceDefaults();
            setNewInstanceRequest({ selfInvite, defaults });
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_load_new_instance_settings')
            );
        }
    }

    async function createWorldInstance(form) {
        if (
            !newInstanceRequest ||
            !world.id ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }
        const shouldSelfInvite = Boolean(newInstanceRequest.selfInvite);
        const targetWorldId = world.id;
        const targetEndpoint = currentEndpoint;
        if (form.accessType === 'group' && !normalizeEntityId(form.groupId)) {
            toast.error(t('dialog.world.generated.group_id_is_required_for_group_instances'));
            return;
        }

        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            await Promise.all([
                configRepository.setString(
                    'instanceDialogAccessType',
                    form.accessType || 'public'
                ),
                configRepository.setString(
                    'instanceRegion',
                    form.region || 'US West'
                ),
                configRepository.setString(
                    'instanceDialogGroupId',
                    form.groupId || ''
                ),
                configRepository.setString(
                    'instanceDialogGroupAccessType',
                    form.groupAccessType || 'plus'
                ),
                configRepository.setBool(
                    'instanceDialogAgeGate',
                    Boolean(form.ageGate)
                ),
                configRepository.setBool(
                    'instanceDialogQueueEnabled',
                    Boolean(form.queueEnabled)
                )
            ]);
            const response = await instanceRepository.createInstance({
                worldId: world.id,
                ownerId: currentUserId,
                accessType: form.accessType || 'public',
                region: form.region || 'US West',
                groupId: form.groupId || '',
                groupAccessType: form.groupAccessType || 'plus',
                queueEnabled: Boolean(form.queueEnabled),
                ageGate: Boolean(form.ageGate),
                roleIds: parseRoleIds(form.roleIds),
                displayName: normalizeEntityId(form.displayName),
                endpoint: currentEndpoint
            });
            const location = resolveInstanceLocation(world.id, response.json);
            if (!location) {
                throw new Error(
                    'The instance was created but VRChat did not return a launch location.'
                );
            }
            const created = await resolveCreatedInstanceDetails(
                location,
                response.json,
                currentEndpoint,
                {
                    accessType: form.accessType || 'public',
                    ownerId: currentUserId
                }
            );
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                toast.success(t('dialog.world.generated.instance_created'));
                return;
            }
            setNewInstanceRequest((current) => ({
                ...(current || {}),
                selfInvite: Boolean(current?.selfInvite),
                defaults: form,
                created
            }));

            if (shouldSelfInvite) {
                const parsedLocation = parseLocation(location);
                if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                    toast.error(
                        t('dialog.world.generated.instance_created_but_the_new_instance_location_is_not_invite')
                    );
                } else {
                    try {
                        await selfInviteToInstance(
                            location,
                            created.shortName ||
                                created.secureOrShortName ||
                                '',
                            currentEndpoint
                        );
                        toast.success(t('dialog.world.generated.instance_created_and_self_invite_sent'));
                    } catch (error) {
                        toast.error(
                            error instanceof Error
                                ? t('dialog.world.generated_toast.instance_created_but_self_invite_failed_value', { value: error.message })
                                : t('dialog.world.generated_toast.instance_created_but_self_invite_failed')
                        );
                    }
                }
            } else {
                toast.success(t('dialog.world.generated.instance_created'));
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_create_instance')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function copyCreatedInstance(created) {
        if (!created?.url) {
            return;
        }
        await copyTextToClipboard(created.url);
        toast.success(t('dialog.world.generated.instance_url_copied'));
    }

    async function selfInviteCreatedInstance(created) {
        const parsedLocation = parseLocation(created?.location || '');
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t('dialog.world.generated.cannot_self_invite_location_is_not_a_concrete_instance')
            );
            return;
        }
        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            await selfInviteToInstance(
                created.location,
                created.shortName || created.secureOrShortName || '',
                currentEndpoint
            );
            toast.success(t('dialog.world.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_send_self_invite')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function inviteCreatedInstance(created) {
        if (!created?.location) {
            return;
        }
        setInviteRequest({
            location: created.location,
            launchToken: created.shortName || created.secureOrShortName || '',
            worldName: world?.name || created.location
        });
    }

    function launchCreatedInstance(created) {
        if (!created?.location) {
            return;
        }
        showLaunchDialog(
            created.location,
            created.shortName || '',
            created.secureOrShortName || '',
            {
                createdInstance: created,
                worldName: world?.name || ''
            }
        );
    }

    async function openCreatedInstanceInGame(created) {
        if (!created?.location) {
            return;
        }
        const parsedLocation = parseLocation(created.location);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t('dialog.world.generated.cannot_open_in_vrchat_location_is_not_a_concrete_instance')
            );
            return;
        }
        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            const opened = await tryOpenLaunchLocation(
                created.location,
                created.shortName || created.secureOrShortName || '',
                currentEndpoint
            );
            if (!opened) {
                await selfInviteToInstance(
                    created.location,
                    created.shortName || created.secureOrShortName || '',
                    currentEndpoint
                );
                toast.warning(
                    t('dialog.world.generated.failed_open_instance_in_vrchat_falling_back_to_self_invite')
                );
                toast.success(t('dialog.world.generated.self_invite_sent'));
                return;
            }
            toast.success(t('dialog.world.generated.vrchat_launch_request_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.generated_toast.failed_to_open_instance_in_vrchat')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function beginWorldImageUpload() {
        if (!canManageWorld || actionStatusRef.current !== 'idle') {
            return;
        }
        imageUploadWorldRef.current = world;
        imageUploadInputRef.current?.click();
    }

    function onFileChangeWorldImage(event) {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        if (!file) {
            return;
        }
        const validation = validateImageUploadFile(file);
        if (!validation.ok) {
            const message =
                validation.reason === 'too_large'
                    ? 'Selected image is too large.'
                    : 'Selected file is not an image.';
            setDetail(message);
            toast.error(message);
            return;
        }
        const selectedWorld = imageUploadWorldRef.current || world;
        if (!selectedWorld?.id) {
            return;
        }
        imageUploadWorldRef.current = selectedWorld;
        setImageCropRequest({
            file,
            world: selectedWorld
        });
    }

    async function confirmWorldImageUpload(blob) {
        const request = imageCropRequest;
        const selectedWorld =
            request?.world || imageUploadWorldRef.current || world;
        const selectedWorldId = normalizeEntityId(selectedWorld?.id);
        const requestEndpoint = currentEndpoint;
        if (!blob || !selectedWorldId) {
            return;
        }

        actionStatusRef.current = 'image-upload';
        setActionStatus('image-upload');
        try {
            const base64Body = await readFileAsBase64(blob);
            const base64File =
                await mediaRepository.resizeImageToFitLimits(base64Body);
            const result = await withUploadTimeout(
                mediaRepository.uploadWorldImageLegacy({
                    worldId: selectedWorldId,
                    imageUrl:
                        selectedWorld.imageUrl ||
                        selectedWorld.thumbnailImageUrl ||
                        '',
                    base64File,
                    blob,
                    endpoint: requestEndpoint
                })
            );
            const activeTarget = activeWorldTargetRef.current;
            if (
                activeTarget.worldId !== selectedWorldId ||
                activeTarget.endpoint !== requestEndpoint
            ) {
                return;
            }
            setWorld(worldProfileRepository.normalize(result.world));
            setDetail(
                t('dialog.world.generated_dynamic.world_image_updated_for_value', { value: selectedWorld.name || selectedWorldId })
            );
            toast.success(t('dialog.world.generated.world_image_updated'));
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Failed to upload world image.';
            setDetail(message);
            toast.error(message);
        } finally {
            imageUploadWorldRef.current = null;
            setImageCropRequest(null);
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return (
        <>
            <WorldDialogTabbedView
                world={worldForView}
                memo={memo}
                detail={detail}
                imageUrl={imageUrl}
                actionStatus={actionStatus}
                normalizedWorldId={normalizedWorldId}
                isInstanceLocation={isInstanceLocation}
                worldDialogShortName={worldDialogShortName}
                isHomeWorld={isHomeWorld}
                canUpdateHome={canUpdateHome}
                canManageWorld={canManageWorld}
                onRefresh={() => void refreshWorldProfile()}
                onLaunch={() => void launchInstance()}
                onHome={() => void updateHomeLocation()}
                onEditMemo={() => void editMemo()}
                onSaveMemo={(nextMemo) => saveMemo(nextMemo)}
                onOpenCache={() => void openWorldCacheFolder()}
                onDeleteCache={() => void deleteWorldCache()}
                onRename={() => void ownerActions.renameWorld()}
                onChangeDescription={() => void ownerActions.changeWorldDescription()}
                onChangeCapacity={() =>
                    void ownerActions.changeWorldCapacity('capacity', 'Capacity')
                }
                onChangeRecommendedCapacity={() =>
                    void ownerActions.changeWorldCapacity(
                        'recommendedCapacity',
                        'Recommended Capacity'
                    )
                }
                onChangePreview={() => void ownerActions.changeWorldYouTubePreview()}
                onChangeTags={() => void ownerActions.changeWorldTags()}
                onChangeAllowedDomains={() => void ownerActions.changeWorldAllowedDomains()}
                onChangeImage={() => void beginWorldImageUpload()}
                onNewInstance={() => void openNewInstanceDialog(false)}
                onNewInstanceSelfInvite={() => void openNewInstanceDialog(true)}
                onPublication={(nextPublished) =>
                    void ownerActions.updateWorldPublication(nextPublished)
                }
                onDeletePersistentData={() => void ownerActions.deleteWorldPersistentData()}
                onDelete={() => void ownerActions.deleteWorld()}
                previousInstances={previousInstances}
                onPreviousInstancesChange={setPreviousInstances}
                hasPersistData={hasPersistData}
            />
            <WorldNewInstanceDialog
                open={Boolean(newInstanceRequest)}
                request={newInstanceRequest}
                world={world}
                currentUserId={currentUserId}
                submitting={actionStatus === 'new-instance'}
                onOpenChange={(open) => {
                    if (!open && actionStatus !== 'new-instance') {
                        setNewInstanceRequest(null);
                    }
                }}
                onSubmit={(form) => void createWorldInstance(form)}
                onCopy={(created) => void copyCreatedInstance(created)}
                onSelfInvite={(created) =>
                    void selfInviteCreatedInstance(created)
                }
                onInvite={inviteCreatedInstance}
                onLaunch={launchCreatedInstance}
                onOpenInGame={(created) =>
                    void openCreatedInstanceInGame(created)
                }
            />
            <InstanceInviteDialog
                open={Boolean(inviteRequest)}
                location={inviteRequest?.location || ''}
                launchToken={inviteRequest?.launchToken || ''}
                worldName={inviteRequest?.worldName || world?.name || ''}
                endpoint={currentEndpoint}
                onOpenChange={(open) => {
                    if (!open) {
                        setInviteRequest(null);
                    }
                }}
            />
            <Input
                ref={imageUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={onFileChangeWorldImage}
            />
            <ImageCropDialog
                open={Boolean(imageCropRequest)}
                file={imageCropRequest?.file || null}
                aspectRatio={4 / 3}
                title={t('dialog.world.generated.change_world_image')}
                onOpenChange={(open) => {
                    if (!open) {
                        setImageCropRequest(null);
                        imageUploadWorldRef.current = null;
                    }
                }}
                onConfirm={(blob) => confirmWorldImageUpload(blob)}
            />
            <WorldTagsDialog
                open={ownerEditor === 'tags'}
                onOpenChange={(open) => {
                    if (!open) {
                        setOwnerEditor('');
                    }
                }}
                world={world}
                saving={actionStatus === 'save-world'}
                onSave={(tags) => void ownerActions.saveWorldTags(tags)}
            />
            <WorldAllowedDomainsDialog
                open={ownerEditor === 'allowed-domains'}
                onOpenChange={(open) => {
                    if (!open) {
                        setOwnerEditor('');
                    }
                }}
                world={world}
                saving={actionStatus === 'save-world'}
                onSave={(urlList) => void ownerActions.saveWorldAllowedDomains(urlList)}
            />
        </>
    );
}
