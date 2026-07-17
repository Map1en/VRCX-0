import { CopyIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold';
import { ImageCropDialog } from '@/components/media/ImageCropDialog';
import type { EntityRecord } from '@/domain/entities/profileEntities';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { IMAGE_UPLOAD_ACCEPT } from '@/shared/utils/imageUpload';
import { parseLocation } from '@/shared/utils/location';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Spinner } from '@/ui/shadcn/spinner';

import { InstanceInviteDialog } from './InstanceInviteDialog';
import { useWorldActions } from './world-dialog/useWorldActions';
import { useWorldDialogData } from './world-dialog/useWorldDialogData';
import { useWorldDialogOwnerActions } from './world-dialog/useWorldDialogOwnerActions';
import { useWorldDialogRuntimeState } from './world-dialog/useWorldDialogRuntimeState';
import { useWorldImageUpload } from './world-dialog/useWorldImageUpload';
import { useWorldInstanceActions } from './world-dialog/useWorldInstanceActions';
import { WorldDialogTabbedView } from './world-dialog/WorldDialogTabbedView';
import { normalizeEntityId } from './world-dialog/worldInstances';
import { WorldNewInstanceDialog } from './world-dialog/WorldNewInstanceDialog';
import {
    WorldAllowedDomainsDialog,
    WorldDetailsDialog,
    WorldTagsDialog
} from './WorldOwnerEditDialogs';

export interface WorldDialogWorkflowProps {
    worldId?: unknown;
    seedData?: unknown;
    initialAction?: unknown;
    openNonce?: unknown;
    initialActionNonce?: unknown;
    initialNewInstanceDefaults?: unknown;
}

type NewInstanceDialogProps = ComponentProps<typeof WorldNewInstanceDialog>;
type WorldDetailsDialogProps = ComponentProps<typeof WorldDetailsDialog>;
type WorldTagsDialogProps = ComponentProps<typeof WorldTagsDialog>;
type WorldAllowedDomainsDialogProps = ComponentProps<
    typeof WorldAllowedDomainsDialog
>;

function isRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function WorldDialogEmptyState({
    title,
    description,
    loading = false,
    children
}: Pick<
    ComponentProps<typeof AppEmptyState>,
    'title' | 'description' | 'children'
> & {
    loading?: boolean;
}) {
    return (
        <AppEmptyState
            className="min-h-56"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        >
            {children}
        </AppEmptyState>
    );
}

export function WorldDialogContentWorkflow({
    worldId,
    seedData = null,
    initialAction = '',
    openNonce = 0,
    initialActionNonce = 0,
    initialNewInstanceDefaults = null
}: WorldDialogWorkflowProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();

    const normalizedWorldId = normalizeEntityId(worldId);
    const normalizedSeedData = isRecord(seedData) ? seedData : null;
    const normalizedOpenNonce = typeof openNonce === 'number' ? openNonce : 0;
    const normalizedInitialActionNonce =
        typeof initialActionNonce === 'number' ? initialActionNonce : 0;
    const profileWorldId = normalizedWorldId.split(':')[0] || normalizedWorldId;
    const {
        closeDialog,
        confirm,
        currentEndpoint,
        currentHomeLocation,
        currentUserId,
        isGameRunning,
        prompt,
        setAuthBootstrap,
        showLaunchDialog,
        updateEntityDialogMetadata
    } = useWorldDialogRuntimeState();

    const [actionStatus, setActionStatus] = useState('idle');
    const [ownerEditor, setOwnerEditor] = useState('');
    const actionStatusRef = useRef('idle');
    const memoRevisionRef = useRef(0);
    const activeWorldTargetRef = useRef<{
        worldId: string;
        endpoint: string;
    }>({
        worldId: profileWorldId,
        endpoint: currentEndpoint
    });
    const handledInitialActionRef = useRef('');

    function isCurrentWorldTarget(
        targetWorldId: unknown,
        targetEndpoint: string
    ) {
        return (
            activeWorldTargetRef.current.worldId ===
                normalizeEntityId(targetWorldId) &&
            activeWorldTargetRef.current.endpoint === targetEndpoint
        );
    }

    const {
        world,
        setWorld,
        loadStatus,
        detail,
        setDetail,
        memo,
        setMemo,
        previousInstances,
        setPreviousInstances,
        hasPersistData,
        setHasPersistData,
        worldSideData,
        setWorldSideData,
        newInstanceGroups
    } = useWorldDialogData({
        normalizedWorldId,
        profileWorldId,
        seedData: normalizedSeedData,
        currentEndpoint,
        currentUserId,
        isCurrentWorldTarget,
        memoRevisionRef
    });

    const isInstanceLocation = normalizedWorldId.includes(':');
    const worldDialogShortName = isInstanceLocation
        ? parseLocation(normalizedWorldId).shortName
        : '';
    const isHomeWorld =
        normalizeEntityId(currentHomeLocation) === normalizeEntityId(world?.id);
    const canUpdateHome = Boolean(currentUserId && world?.id);
    const canManageWorld =
        normalizeEntityId(world?.authorId) === normalizeEntityId(currentUserId);

    const worldActions = useWorldActions({
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
    });

    const instanceActions = useWorldInstanceActions({
        world,
        currentEndpoint,
        currentUserId,
        isGameRunning,
        profileWorldId,
        newInstanceGroups,
        actionStatusRef,
        setActionStatus,
        isCurrentWorldTarget,
        showLaunchDialog
    });

    const imageUpload = useWorldImageUpload({
        world,
        canManageWorld,
        currentEndpoint,
        profileWorldId,
        actionStatusRef,
        setActionStatus,
        activeWorldTargetRef,
        setWorld,
        setDetail
    });

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
        setOwnerEditor('');
        handledInitialActionRef.current = '';
    }, [profileWorldId]);

    useEffect(() => {
        const normalizedInitialAction = normalizeEntityId(initialAction);
        const actionKey = `${profileWorldId}:${normalizedInitialAction}:${normalizedInitialActionNonce}`;
        if (
            !world?.id ||
            !normalizedInitialAction ||
            handledInitialActionRef.current === actionKey
        ) {
            return;
        }

        handledInitialActionRef.current = actionKey;
        if (normalizedInitialAction === 'newInstanceSelfInvite') {
            instanceActions.openNewInstanceDialog(
                true,
                initialNewInstanceDefaults
            );
        } else if (normalizedInitialAction === 'newInstance') {
            instanceActions.openNewInstanceDialog(
                false,
                initialNewInstanceDefaults
            );
        }
    }, [
        initialAction,
        initialActionNonce,
        initialNewInstanceDefaults,
        newInstanceGroups,
        profileWorldId,
        world?.id
    ]);

    function openScreenshotMetadata(path: string) {
        if (!path) {
            return;
        }
        const params = new URLSearchParams();
        params.set('path', path);
        closeDialog();
        navigate(`/tools/screenshot-metadata?${params.toString()}`);
    }

    if (loadStatus === 'running' && !world) {
        return (
            <WorldDialogEmptyState
                loading
                title={t('dialog.world.loading.loading_world_profile')}
                description={t(
                    'dialog.world.loading.fetching_the_current_vrchat_world_snapshot_for_this_dialog'
                )}
            />
        );
    }

    if (!world) {
        return (
            <WorldDialogEmptyState
                title={t('dialog.world.error.world_profile_unavailable')}
                description={
                    detail ||
                    t(
                        'dialog.world.description.world_snapshot_unavailable_description'
                    )
                }
            >
                {profileWorldId ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            worldActions.copyUnavailableWorldId();
                        }}
                    >
                        <CopyIcon data-icon="inline-start" />
                        {t('dialog.world.info.copy_id')}
                    </Button>
                ) : null}
            </WorldDialogEmptyState>
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

    return (
        <>
            <WorldDialogTabbedView
                world={worldForView}
                resource={{
                    memo,
                    detail,
                    imageUrl,
                    actionStatus,
                    normalizedWorldId,
                    openNonce: normalizedOpenNonce,
                    previousInstances
                }}
                permissions={{
                    isInstanceLocation,
                    worldDialogShortName,
                    isHomeWorld,
                    isGameRunning,
                    canUpdateHome,
                    canManageWorld,
                    hasPersistData
                }}
                worldControls={{
                    onRefresh: () => {
                        worldActions.refreshWorldProfile();
                    },
                    onHome: () => {
                        worldActions.updateHomeLocation();
                    },
                    onSaveMemo: (nextMemo: string) =>
                        worldActions.saveMemo(nextMemo),
                    onOpenCache: () => {
                        worldActions.openWorldCacheFolder();
                    },
                    onDeleteCache: () => {
                        worldActions.deleteWorldCache();
                    },
                    onEditDetails: () => setOwnerEditor('details'),
                    onChangeTags: () => {
                        ownerActions.changeWorldTags();
                    },
                    onChangeAllowedDomains: () => {
                        ownerActions.changeWorldAllowedDomains();
                    },
                    onChangeImage: () => {
                        imageUpload.beginWorldImageUpload();
                    },
                    onNewInstance: () => {
                        instanceActions.openNewInstanceDialog(false);
                    },
                    onNewInstanceSelfInvite: () => {
                        instanceActions.openNewInstanceDialog(true);
                    },
                    onPublication: (nextPublished: boolean) => {
                        ownerActions.updateWorldPublication(nextPublished);
                    },
                    onDeletePersistentData: () => {
                        ownerActions.deleteWorldPersistentData();
                    },
                    onDelete: () => {
                        ownerActions.deleteWorld();
                    },
                    onOpenScreenshot: openScreenshotMetadata,
                    onPreviousInstancesChange: setPreviousInstances
                }}
            />
            <WorldNewInstanceDialog
                open={Boolean(instanceActions.newInstanceRequest)}
                request={instanceActions.newInstanceRequest}
                world={world}
                currentUserId={currentUserId}
                isGameRunning={isGameRunning}
                groupOptions={newInstanceGroups}
                submitting={actionStatus === 'new-instance'}
                onOpenChange={(open: boolean) => {
                    if (!open && actionStatus !== 'new-instance') {
                        instanceActions.setNewInstanceRequest(null);
                    }
                }}
                onChange={instanceActions.saveNewInstanceDraft}
                onCommitDisplayName={
                    instanceActions.saveNewInstanceDisplayNamePreset
                }
                onSubmit={(
                    form: Parameters<NewInstanceDialogProps['onSubmit']>[0]
                ) => {
                    instanceActions.createWorldInstance(form);
                }}
                onCopy={(
                    created: Parameters<NewInstanceDialogProps['onCopy']>[0]
                ) => {
                    instanceActions.copyCreatedInstance(created);
                }}
                onSelfInvite={(
                    created: Parameters<
                        NewInstanceDialogProps['onSelfInvite']
                    >[0]
                ) => {
                    instanceActions.selfInviteCreatedInstance(created);
                }}
                onInvite={instanceActions.inviteCreatedInstance}
                onLaunch={instanceActions.launchCreatedInstance}
                onOpenInGame={(
                    created: Parameters<
                        NewInstanceDialogProps['onOpenInGame']
                    >[0]
                ) => {
                    instanceActions.openCreatedInstanceInGame(created);
                }}
            />
            <InstanceInviteDialog
                open={Boolean(instanceActions.inviteRequest)}
                location={instanceActions.inviteRequest?.location || ''}
                launchToken={instanceActions.inviteRequest?.launchToken || ''}
                worldName={
                    instanceActions.inviteRequest?.worldName ||
                    world?.name ||
                    ''
                }
                endpoint={currentEndpoint}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        instanceActions.setInviteRequest(null);
                    }
                }}
            />
            <Input
                ref={imageUpload.imageUploadInputRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={imageUpload.onFileChangeWorldImage}
            />
            <ImageCropDialog
                open={Boolean(imageUpload.imageCropRequest)}
                file={imageUpload.imageCropRequest?.file || null}
                aspectRatio={4 / 3}
                title={t('dialog.world.action.change_world_image')}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        imageUpload.setImageCropRequest(null);
                        imageUpload.imageUploadWorldRef.current = null;
                    }
                }}
                onConfirm={(blob: Blob) =>
                    imageUpload.confirmWorldImageUpload(blob)
                }
            />
            <WorldDetailsDialog
                open={ownerEditor === 'details'}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setOwnerEditor('');
                    }
                }}
                world={world}
                saving={actionStatus === 'save-world'}
                onSave={(
                    draft: Parameters<WorldDetailsDialogProps['onSave']>[0]
                ) => {
                    ownerActions.saveWorldDetails(draft);
                }}
            />
            <WorldTagsDialog
                open={ownerEditor === 'tags'}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setOwnerEditor('');
                    }
                }}
                world={world}
                saving={actionStatus === 'save-world'}
                onSave={(
                    tags: Parameters<WorldTagsDialogProps['onSave']>[0]
                ) => {
                    ownerActions.saveWorldTags(tags);
                }}
            />
            <WorldAllowedDomainsDialog
                open={ownerEditor === 'allowed-domains'}
                onOpenChange={(open: boolean) => {
                    if (!open) {
                        setOwnerEditor('');
                    }
                }}
                world={world}
                saving={actionStatus === 'save-world'}
                onSave={(
                    urlList: Parameters<
                        WorldAllowedDomainsDialogProps['onSave']
                    >[0]
                ) => {
                    ownerActions.saveWorldAllowedDomains(urlList);
                }}
            />
        </>
    );
}
