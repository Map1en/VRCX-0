import { CopyIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold';
import { ImageCropDialog } from '@/components/media/ImageCropDialog';
import { enrichEntityDialogHistory } from '@/services/dialogService';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { IMAGE_UPLOAD_ACCEPT } from '@/shared/constants/imageUpload';
import { parseLocation } from '@/shared/utils/location';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';
import type { WorldNewInstanceDefaults } from '@/state/dialogStore';
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
import { WorldNewInstanceDialog } from './world-dialog/WorldNewInstanceDialog';
import {
    WorldAllowedDomainsDialog,
    WorldDetailsDialog,
    WorldTagsDialog
} from './WorldOwnerEditDialogs';

export interface WorldDialogWorkflowProps {
    worldId?: string;
    seedData?: unknown;
    initialAction?: string;
    openNonce?: number;
    initialActionNonce?: number;
    initialNewInstanceDefaults?: WorldNewInstanceDefaults | null;
}

type NewInstanceDialogProps = ComponentProps<typeof WorldNewInstanceDialog>;
type WorldDetailsDialogProps = ComponentProps<typeof WorldDetailsDialog>;
type WorldTagsDialogProps = ComponentProps<typeof WorldTagsDialog>;
type WorldAllowedDomainsDialogProps = ComponentProps<
    typeof WorldAllowedDomainsDialog
>;

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
            className={loading ? 'min-h-[min(600px,80vh)]' : 'min-h-56'}
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

    const normalizedWorldId = worldId?.trim() ?? '';
    const normalizedSeedData = isRecord(seedData) ? seedData : null;
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
        targetWorldId: string,
        targetEndpoint: string
    ) {
        return (
            activeWorldTargetRef.current.worldId === targetWorldId.trim() &&
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
        friendVisits,
        hasPersistData,
        setHasPersistData,
        worldSideData,
        setWorldSideData,
        newInstanceGroups,
        loadNewInstanceGroups
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
        normalizeString(currentHomeLocation) === normalizeString(world?.id);
    const canUpdateHome = Boolean(currentUserId && world?.id);
    const canManageWorld =
        normalizeString(world?.authorId) === normalizeString(currentUserId);

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
        loadNewInstanceGroups,
        actionStatusRef,
        setActionStatus,
        isCurrentWorldTarget,
        showLaunchDialog
    });
    const { openNewInstanceDialog } = instanceActions;

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
        enrichEntityDialogHistory({
            kind: 'world',
            entityId: normalizedWorldId,
            title: world.name,
            imageUrl: world.thumbnailImageUrl || world.imageUrl
        });
    }, [
        normalizedWorldId,
        updateEntityDialogMetadata,
        world?.id,
        world?.imageUrl,
        world?.name,
        world?.thumbnailImageUrl
    ]);

    useEffect(() => {
        setOwnerEditor('');
        handledInitialActionRef.current = '';
    }, [profileWorldId]);

    useEffect(() => {
        const actionKey = `${profileWorldId}:${initialAction}:${initialActionNonce}`;
        if (
            !world?.id ||
            !initialAction ||
            handledInitialActionRef.current === actionKey
        ) {
            return;
        }

        handledInitialActionRef.current = actionKey;
        if (initialAction === 'newInstanceSelfInvite') {
            openNewInstanceDialog(true, initialNewInstanceDefaults);
        } else if (initialAction === 'newInstance') {
            openNewInstanceDialog(false, initialNewInstanceDefaults);
        }
    }, [
        initialAction,
        initialActionNonce,
        initialNewInstanceDefaults,
        newInstanceGroups,
        openNewInstanceDialog,
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
                    openNonce,
                    previousInstances,
                    friendVisits
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
                    update: Parameters<WorldTagsDialogProps['onSave']>[0]
                ) => {
                    ownerActions.saveWorldTags(update);
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
