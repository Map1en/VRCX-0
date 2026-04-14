import { useEffect, useRef, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { toast } from 'sonner';

import { convertFileUrlToImageUrl, copyTextToClipboard } from '@/lib/entityMedia.js';
import { getFileAnalysisForUnityPackages } from '@/lib/fileAnalysis.js';
import {
    defaultWorldCacheInfo,
    readWorldCacheInfo,
    resolveWorldAssetBundleArgs
} from '@/lib/worldAssetBundle.js';
import { backend } from '@/platform/tauri/index.js';
import { WorldDialogTabbedView } from './WorldDialogTabbedView.jsx';
import { InstanceInviteDialog } from './InstanceInviteDialog.jsx';
import { WorldAllowedDomainsDialog, WorldTagsDialog } from './WorldOwnerEditDialogs.jsx';
import { ImageCropDialog } from '@/components/media/ImageCropDialog.jsx';
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
import { useDialogStore } from '@/state/dialogStore.js';
import { tryOpenLaunchLocation } from '@/services/directAccessService.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import {
    IMAGE_UPLOAD_ACCEPT,
    readFileAsBase64,
    validateImageUploadFile,
    withUploadTimeout
} from '@/shared/utils/imageUpload.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useLaunchStore } from '@/state/launchStore.js';
import { buildLegacyInstanceTag, getLaunchURL } from '@/shared/utils/instance.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Checkbox } from '@/ui/shadcn/checkbox.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';
import { Label } from '@/ui/shadcn/label.jsx';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs.jsx';

function normalizeEntityId(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function WorldDialogEmptyState({ title, description, loading = false }) {
    return (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
            <div className="max-w-sm space-y-2">
                {loading ? (
                    <div className="flex justify-center">
                        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
                    </div>
                ) : null}
                <div className="text-sm font-medium">{title}</div>
                <div className="text-sm text-muted-foreground">{description}</div>
            </div>
        </div>
    );
}

function defaultWorldSideData() {
    return {
        fileAnalysis: {},
        cache: defaultWorldCacheInfo()
    };
}

const accessTypeOptions = [
    { value: 'public', label: 'Public' },
    { value: 'friends+', label: 'Friends+' },
    { value: 'friends', label: 'Friends' },
    { value: 'invite+', label: 'Invite+' },
    { value: 'invite', label: 'Invite' },
    { value: 'group', label: 'Group' }
];

const regionOptions = ['US West', 'US East', 'Europe', 'Japan'];
const groupAccessTypeOptions = [
    { value: 'public', label: 'Group Public' },
    { value: 'plus', label: 'Group+' },
    { value: 'members', label: 'Group Members' }
];

function parseRoleIds(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function resolveInstanceLocation(worldId, instance) {
    if (typeof instance?.location === 'string' && instance.location.trim()) {
        return instance.location.trim();
    }
    const rawId = normalizeEntityId(instance?.id);
    if (rawId.includes(':')) {
        return rawId;
    }
    const instanceId = normalizeEntityId(instance?.instanceId || rawId);
    return worldId && instanceId ? `${worldId}:${instanceId}` : '';
}

function buildLegacyCreatedInstance({ worldId, form, currentUserId, legacySeed }) {
    const legacyUserId = normalizeEntityId(form.legacyUserId) || currentUserId;
    const instanceName = normalizeEntityId(form.instanceName).replace(/[^A-Za-z0-9]/g, '') || legacySeed;
    const accessType = form.accessType || 'public';
    const instanceId = buildLegacyInstanceTag({
        instanceName,
        userId: legacyUserId,
        accessType,
        groupId: form.groupId || '',
        groupAccessType: form.groupAccessType || 'plus',
        region: form.region || 'US West',
        ageGate: Boolean(form.ageGate),
        strict: Boolean(form.strict && (accessType === 'invite' || accessType === 'friends'))
    });
    const location = `${worldId}:${instanceId}`;
    const parsedLocation = parseLocation(location);
    return {
        location: parsedLocation.tag || location,
        shortName: '',
        secureOrShortName: '',
        url: getLaunchURL(parsedLocation),
        accessType,
        ownerId: legacyUserId
    };
}

function buildCreatedInstanceDetails(location, instance, fallback = {}) {
    const parsedLocation = parseLocation(location);
    const shortName = normalizeEntityId(instance?.shortName || parsedLocation.shortName);
    const secureOrShortName = shortName || normalizeEntityId(instance?.secureName);
    const launchLocation = parsedLocation.tag || location;
    return {
        location: launchLocation,
        shortName,
        secureOrShortName,
        accessType: normalizeEntityId(instance?.accessType) || normalizeEntityId(fallback.accessType) || parsedLocation.accessType,
        ownerId:
            normalizeEntityId(instance?.ownerId) ||
            normalizeEntityId(instance?.owner?.id) ||
            normalizeEntityId(instance?.creatorId) ||
            normalizeEntityId(fallback.ownerId) ||
            normalizeEntityId(parsedLocation.userId),
        url: getLaunchURL({
            ...parsedLocation,
            shortName
        })
    };
}

async function resolveCreatedInstanceDetails(location, instance, endpoint, fallback = {}) {
    const parsedLocation = parseLocation(location);
    if (!parsedLocation.worldId || !parsedLocation.instanceId || instance?.shortName) {
        return buildCreatedInstanceDetails(location, instance, fallback);
    }
    try {
        const response = await instanceRepository.getInstanceShortName({
            worldId: parsedLocation.worldId,
            instanceId: parsedLocation.instanceId,
            endpoint
        });
        return buildCreatedInstanceDetails(location, {
            ...instance,
            shortName: response.json?.shortName,
            secureName: response.json?.secureName
        }, fallback);
    } catch {
        return buildCreatedInstanceDetails(location, instance, fallback);
    }
}

function WorldNewInstanceDialog({
    open,
    request,
    world,
    currentUserId = '',
    submitting,
    onOpenChange,
    onSubmit,
    onCopy,
    onSelfInvite,
    onInvite,
    onLaunch,
    onOpenInGame
}) {
    const [form, setForm] = useState({
        selectedTab: 'Normal',
        accessType: 'public',
        region: 'US West',
        groupId: '',
        groupAccessType: 'plus',
        queueEnabled: true,
        ageGate: false,
        displayName: '',
        roleIds: '',
        instanceName: '',
        legacyUserId: '',
        strict: false
    });
    const [legacySeed, setLegacySeed] = useState('00001');

    useEffect(() => {
        if (open && request?.defaults) {
            setLegacySeed(String((99999 * Math.random() + 1).toFixed(0)).padStart(5, '0'));
            setForm({
                selectedTab: 'Normal',
                instanceName: '',
                legacyUserId: currentUserId || '',
                strict: false,
                ...request.defaults
            });
        }
    }, [currentUserId, open, request]);

    function patchForm(patch) {
        setForm((current) => ({ ...current, ...patch }));
    }

    const legacyCreated = form.selectedTab === 'Legacy' && world?.id
        ? buildLegacyCreatedInstance({ worldId: world.id, form, currentUserId, legacySeed })
        : null;
    const activeCreated = request?.created || legacyCreated;
    const activeAccessType = activeCreated?.accessType || form.accessType;
    const activeOwnerId = activeCreated?.ownerId || currentUserId;
    const inviteDisabled = Boolean(
        (activeAccessType === 'friends' || activeAccessType === 'invite') &&
            activeOwnerId &&
            currentUserId &&
            activeOwnerId !== currentUserId
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(92vw,34rem)]">
                <DialogHeader>
                    <DialogTitle>{request?.selfInvite ? 'New instance and self invite' : 'New instance'}</DialogTitle>
                    <DialogDescription>{world?.name || world?.id || 'World'}</DialogDescription>
                </DialogHeader>
                <Tabs value={form.selectedTab} onValueChange={(value) => patchForm({ selectedTab: value })}>
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="Normal">Normal</TabsTrigger>
                        <TabsTrigger value="Legacy">Legacy</TabsTrigger>
                    </TabsList>
                    <TabsContent value="Normal" className="grid gap-4">
                        <div className="grid gap-2">
                            <Label>Access</Label>
                            <Select value={form.accessType} disabled={Boolean(request?.created)} onValueChange={(value) => patchForm({ accessType: value })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {accessTypeOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Region</Label>
                            <Select value={form.region} disabled={Boolean(request?.created)} onValueChange={(value) => patchForm({ region: value })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {regionOptions.map((region) => (
                                        <SelectItem key={region} value={region}>
                                            {region}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {form.accessType === 'group' ? (
                            <>
                                <div className="grid gap-2">
                                    <Label>Group ID</Label>
                                    <Input value={form.groupId} disabled={Boolean(request?.created)} onChange={(event) => patchForm({ groupId: event.target.value })} />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Group Access</Label>
                                    <Select value={form.groupAccessType} disabled={Boolean(request?.created)} onValueChange={(value) => patchForm({ groupAccessType: value })}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {groupAccessTypeOptions.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {form.groupAccessType === 'members' ? (
                                    <div className="grid gap-2">
                                        <Label>Role IDs</Label>
                                        <Input value={form.roleIds} disabled={Boolean(request?.created)} onChange={(event) => patchForm({ roleIds: event.target.value })} />
                                    </div>
                                ) : null}
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={form.queueEnabled} disabled={Boolean(request?.created)} onCheckedChange={(value) => patchForm({ queueEnabled: Boolean(value) })} />
                                    Queue enabled
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <Checkbox checked={form.ageGate} disabled={Boolean(request?.created)} onCheckedChange={(value) => patchForm({ ageGate: Boolean(value) })} />
                                    Age gate
                                </label>
                            </>
                        ) : null}
                        <div className="grid gap-2">
                            <Label>Display Name</Label>
                            <Input value={form.displayName} disabled={Boolean(request?.created)} onChange={(event) => patchForm({ displayName: event.target.value })} />
                        </div>
                    </TabsContent>
                    <TabsContent value="Legacy" className="grid gap-4">
                        <div className="grid gap-2">
                            <Label>Access</Label>
                            <Select value={form.accessType} onValueChange={(value) => patchForm({ accessType: value })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {accessTypeOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Region</Label>
                            <Select value={form.region} onValueChange={(value) => patchForm({ region: value })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {regionOptions.map((region) => (
                                        <SelectItem key={region} value={region}>
                                            {region}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label>Instance Name</Label>
                            <Input value={form.instanceName} onChange={(event) => patchForm({ instanceName: event.target.value.replace(/[^A-Za-z0-9]/g, '') })} />
                        </div>
                        {form.accessType !== 'public' && form.accessType !== 'group' ? (
                            <div className="grid gap-2">
                                <Label>User ID</Label>
                                <Input value={form.legacyUserId} onChange={(event) => patchForm({ legacyUserId: event.target.value })} />
                            </div>
                        ) : null}
                        {form.accessType === 'group' ? (
                            <>
                                <div className="grid gap-2">
                                    <Label>Group ID</Label>
                                    <Input value={form.groupId} onChange={(event) => patchForm({ groupId: event.target.value })} />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Group Access</Label>
                                    <Select value={form.groupAccessType} onValueChange={(value) => patchForm({ groupAccessType: value })}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {groupAccessTypeOptions.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </>
                        ) : null}
                        {form.accessType === 'group' ? (
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={form.ageGate} onCheckedChange={(value) => patchForm({ ageGate: Boolean(value) })} />
                                Age gate
                            </label>
                        ) : null}
                        {(form.accessType === 'invite' || form.accessType === 'friends') ? (
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={form.strict} onCheckedChange={(value) => patchForm({ strict: Boolean(value) })} />
                                Strict
                            </label>
                        ) : null}
                    </TabsContent>
                </Tabs>
                {activeCreated ? (
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label>Location</Label>
                            <Input readOnly value={activeCreated.location || ''} onClick={(event) => event.currentTarget.select()} />
                        </div>
                        <div className="grid gap-2">
                            <Label>URL</Label>
                            <Input readOnly value={activeCreated.url || ''} onClick={(event) => event.currentTarget.select()} />
                        </div>
                    </div>
                ) : null}
                {activeCreated ? (
                    <DialogFooter className="gap-2 sm:justify-end">
                        <Button type="button" variant="outline" disabled={submitting} onClick={() => onCopy?.(activeCreated)}>
                            Copy URL
                        </Button>
                        <Button type="button" variant="outline" disabled={submitting} onClick={() => onSelfInvite?.(activeCreated)}>
                            Self Invite
                        </Button>
                        <Button type="button" variant="outline" disabled={submitting || inviteDisabled} onClick={() => onInvite?.(activeCreated)}>
                            Invite
                        </Button>
                        <Button type="button" variant="secondary" disabled={submitting} onClick={() => onLaunch?.(activeCreated)}>
                            Launch
                        </Button>
                        <Button type="button" disabled={submitting} onClick={() => onOpenInGame?.(activeCreated)}>
                            Open In-Game
                        </Button>
                    </DialogFooter>
                ) : (
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="button" disabled={submitting || form.selectedTab === 'Legacy'} onClick={() => onSubmit(form)}>
                            {request?.selfInvite ? 'Create and Invite' : 'Create'}
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}

export function WorldDialogContent({
    worldId,
    seedData = null,
    initialAction = '',
    initialActionNonce = 0
}) {
    const normalizedWorldId = normalizeEntityId(worldId);
    const profileWorldId = normalizedWorldId.split(':')[0] || normalizedWorldId;
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentHomeLocation = useRuntimeStore((state) => state.auth.currentUserSnapshot?.homeLocation || '');
    const setAuthBootstrap = useRuntimeStore((state) => state.setAuthBootstrap);
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const updateEntityDialogMetadata = useDialogStore((state) => state.updateEntityDialogMetadata);
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const [world, setWorld] = useState(() =>
        seedData ? worldProfileRepository.normalize(seedData) : null
    );
    const [loadStatus, setLoadStatus] = useState(normalizedWorldId ? 'running' : 'idle');
    const [actionStatus, setActionStatus] = useState('idle');
    const [detail, setDetail] = useState('');
    const [memo, setMemo] = useState('');
    const [previousInstances, setPreviousInstances] = useState([]);
    const [hasPersistData, setHasPersistData] = useState(false);
    const [worldSideData, setWorldSideData] = useState(() => defaultWorldSideData());
    const [newInstanceRequest, setNewInstanceRequest] = useState(null);
    const [inviteRequest, setInviteRequest] = useState(null);
    const [imageCropRequest, setImageCropRequest] = useState(null);
    const [ownerEditor, setOwnerEditor] = useState('');
    const actionStatusRef = useRef('idle');
    const memoRevisionRef = useRef(0);
    const activeWorldTargetRef = useRef({ worldId: profileWorldId, endpoint: currentEndpoint });
    const handledInitialActionRef = useRef('');
    const imageUploadInputRef = useRef(null);
    const imageUploadWorldRef = useRef(null);

    useEffect(() => {
        setWorld(seedData ? worldProfileRepository.normalize(seedData) : null);
    }, [seedData]);

    useEffect(() => {
        activeWorldTargetRef.current = { worldId: profileWorldId, endpoint: currentEndpoint };
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
        vrchatAuthRepository.getConfig({ endpoint: targetEndpoint })
            .catch(() => null)
            .then((configResponse) => Promise.allSettled([
                readWorldCacheInfo(world, targetEndpoint),
                getFileAnalysisForUnityPackages({
                    unityPackages: world.unityPackages,
                    sdkUnityVersion: String(configResponse?.json?.sdkUnityVersion || ''),
                    endpoint: targetEndpoint
                })
            ]))
            .then(([cacheResult, fileAnalysisResult]) => {
                if (active && isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                    setWorldSideData({
                        cache: cacheResult.status === 'fulfilled' ? cacheResult.value : defaultWorldSideData().cache,
                        fileAnalysis: fileAnalysisResult.status === 'fulfilled' ? fileAnalysisResult.value : {}
                    });
                }
            })
            .catch(() => {
                if (active && isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
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
                endpoint: currentEndpoint
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
                    error instanceof Error ? error.message : 'Failed to load the world profile.'
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

        worldProfileRepository.hasWorldPersistentData({
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

        gameLogRepository.getPreviousInstancesByWorldId({ worldId: profileWorldId })
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
        if (!world?.id || !normalizedInitialAction || handledInitialActionRef.current === actionKey) {
            return;
        }

        handledInitialActionRef.current = actionKey;
        if (normalizedInitialAction === 'newInstanceSelfInvite') {
            void openNewInstanceDialog(true);
        } else if (normalizedInitialAction === 'newInstance') {
            void openNewInstanceDialog(false);
        }
    }, [initialAction, initialActionNonce, profileWorldId, world?.id]);

    if (loadStatus === 'running' && !world) {
        return (
            <WorldDialogEmptyState
                loading
                title="Loading world profile"
                description="Fetching the current VRChat world snapshot for this dialog."
            />
        );
    }

    if (!world) {
        return (
            <WorldDialogEmptyState
                title="World profile unavailable"
                description={detail || 'VRCX could not resolve a world snapshot for this dialog.'}
            />
        );
    }

    const imageUrl = convertFileUrlToImageUrl(
        world.imageUrl || world.thumbnailImageUrl,
        512
    );
    const isInstanceLocation = normalizedWorldId.includes(':');
    const worldDialogShortName = isInstanceLocation ? parseLocation(normalizedWorldId).shortName : '';
    const isHomeWorld = normalizeEntityId(currentHomeLocation) === normalizeEntityId(world.id);
    const canUpdateHome = Boolean(currentUserId && world.id);
    const canManageWorld = normalizeEntityId(world.authorId) === normalizeEntityId(currentUserId);
    const worldForView = {
        ...world,
        $isCached: worldSideData.cache.inCache,
        $cacheSize: worldSideData.cache.cacheSize,
        $cacheLocked: worldSideData.cache.cacheLocked,
        $cachePath: worldSideData.cache.cachePath,
        fileAnalysis: worldSideData.fileAnalysis
    };

    function isCurrentWorldTarget(targetWorldId, targetEndpoint) {
        return (
            activeWorldTargetRef.current.worldId === normalizeEntityId(targetWorldId) &&
            activeWorldTargetRef.current.endpoint === targetEndpoint
        );
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
            setWorld(nextWorld);
            toast.success('World refreshed.');
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(error instanceof Error ? error.message : 'Failed to refresh world.');
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
            const opened = await tryOpenLaunchLocation(normalizedWorldId, worldDialogShortName, currentEndpoint);
            if (opened) {
                toast.success('VRChat launch request sent.');
                return;
            }
            toast.error('Unable to open this instance in VRChat.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to launch VRChat instance.');
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
            cancelText: 'Cancel'
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
                    currentUserDisplayName: nextUser.displayName || nextUser.username || nextUser.id,
                    currentUserSnapshot: nextUser
                });
            }
            toast.success(isHomeWorld ? 'Home world reset.' : 'Home world updated.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update home world.');
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
            toast.success(nextMemo ? 'Memo saved.' : 'Memo cleared.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to save memo.');
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
            toast.error(error instanceof Error ? error.message : 'Failed to open world cache folder.');
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
            const configResponse = await vrchatAuthRepository.getConfig({ endpoint: targetEndpoint }).catch(() => null);
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            const args = resolveWorldAssetBundleArgs(
                targetWorld,
                String(configResponse?.json?.sdkUnityVersion || '')
            );
            if (!args) {
                toast.error('World cache location unavailable.');
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
            toast.success('World cache deleted.');
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(error instanceof Error ? error.message : 'Failed to delete world cache.');
        } finally {
            if (actionStatusRef.current === 'cache') {
                actionStatusRef.current = 'idle';
                setActionStatus('idle');
            }
        }
    }

    async function editMemo() {
        const result = await prompt({
            title: 'Edit local memo',
            description: world.name || world.id,
            inputValue: memo,
            multiline: true,
            confirmText: 'Save',
            cancelText: 'Cancel'
        });

        if (!result.ok) {
            return;
        }

        await saveMemo(result.value);
    }

    async function saveWorldPatch(patch, { successMessage, errorMessage }) {
        if (!canManageWorld || actionStatusRef.current !== 'idle') {
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
            toast.error(error instanceof Error ? error.message : errorMessage);
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function renameWorld() {
        const result = await prompt({
            title: 'Rename world',
            description: world.name || world.id,
            inputValue: world.name || '',
            confirmText: 'Save',
            cancelText: 'Cancel'
        });
        if (result.ok) {
            await saveWorldPatch({ name: result.value }, {
                successMessage: 'World renamed.',
                errorMessage: 'Failed to rename world.'
            });
        }
    }

    async function changeWorldDescription() {
        const result = await prompt({
            title: 'Change world description',
            description: world.name || world.id,
            inputValue: world.description || '',
            multiline: true,
            confirmText: 'Save',
            cancelText: 'Cancel'
        });
        if (result.ok) {
            await saveWorldPatch({ description: result.value }, {
                successMessage: 'World description updated.',
                errorMessage: 'Failed to update world description.'
            });
        }
    }

    async function changeWorldCapacity(field, label) {
        const result = await prompt({
            title: `Change ${label}`,
            description: world.name || world.id,
            inputValue: String(world[field] || ''),
            confirmText: 'Save',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }
        const value = Number.parseInt(result.value, 10);
        if (!Number.isFinite(value) || value < 1) {
            toast.error(`${label} must be a positive number.`);
            return;
        }
        await saveWorldPatch({ [field]: value }, {
            successMessage: `${label} updated.`,
            errorMessage: `Failed to update ${label}.`
        });
    }

    async function changeWorldYouTubePreview() {
        const result = await prompt({
            title: 'Change YouTube preview',
            description: world.name || world.id,
            inputValue: world.previewYoutubeId || '',
            confirmText: 'Save',
            cancelText: 'Cancel'
        });
        if (!result.ok) {
            return;
        }

        let processedValue = String(result.value || '').trim();
        if (processedValue.length > 11) {
            try {
                const url = new URL(processedValue);
                const pathId = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
                const queryId = url.searchParams.get('v') || '';
                if (queryId.length === 11) {
                    processedValue = queryId;
                } else if (pathId.length === 11) {
                    processedValue = pathId;
                }
            } catch {
                toast.error('YouTube preview must be a video id or valid URL.');
                return;
            }
        }

        await saveWorldPatch({ previewYoutubeId: processedValue }, {
            successMessage: 'YouTube preview updated.',
            errorMessage: 'Failed to update YouTube preview.'
        });
    }

    function changeWorldTags() {
        setOwnerEditor('tags');
    }

    async function saveWorldTags(tags) {
        const saved = await saveWorldPatch({ tags }, {
            successMessage: 'World tags updated.',
            errorMessage: 'Failed to update world tags.'
        });
        if (saved) {
            setOwnerEditor('');
        }
    }

    function changeWorldAllowedDomains() {
        setOwnerEditor('allowed-domains');
    }

    async function saveWorldAllowedDomains(urlList) {
        const saved = await saveWorldPatch({ urlList }, {
            successMessage: 'Allowed domains updated.',
            errorMessage: 'Failed to update allowed domains.'
        });
        if (saved) {
            setOwnerEditor('');
        }
    }

    async function updateWorldPublication(nextPublished) {
        if (!canManageWorld || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: nextPublished ? 'Publish world?' : 'Unpublish world?',
            description: world.name || world.id,
            confirmText: nextPublished ? 'Publish' : 'Unpublish',
            cancelText: 'Cancel',
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
            toast.success(nextPublished ? 'World published.' : 'World unpublished.');
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(error instanceof Error ? error.message : 'Failed to update world publication.');
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function deleteWorldPersistentData() {
        if (!currentUserId || !world.id || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: 'Delete persistent data?',
            description: world.name || world.id,
            confirmText: 'Delete',
            cancelText: 'Cancel',
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
            setWorld((currentWorld) => currentWorld ? { ...currentWorld, hasPersistData: false } : currentWorld);
            setHasPersistData(false);
            toast.success('World persistent data deleted.');
        } catch (error) {
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                return;
            }
            toast.error(error instanceof Error ? error.message : 'Failed to delete world persistent data.');
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function deleteWorld() {
        if (!canManageWorld || actionStatusRef.current !== 'idle') {
            return;
        }

        const result = await confirm({
            title: 'Delete world?',
            description: world.name || world.id,
            confirmText: 'Delete',
            cancelText: 'Cancel',
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
            toast.success('World deleted.');
            closeDialog();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete world.');
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
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
            toast.error(error instanceof Error ? error.message : 'Failed to load new instance settings.');
        }
    }

    async function createWorldInstance(form) {
        if (!newInstanceRequest || !world.id || actionStatusRef.current !== 'idle') {
            return;
        }
        const shouldSelfInvite = Boolean(newInstanceRequest.selfInvite);
        const targetWorldId = world.id;
        const targetEndpoint = currentEndpoint;
        if (form.accessType === 'group' && !normalizeEntityId(form.groupId)) {
            toast.error('Group ID is required for group instances.');
            return;
        }

        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            await Promise.all([
                configRepository.setString('instanceDialogAccessType', form.accessType || 'public'),
                configRepository.setString('instanceRegion', form.region || 'US West'),
                configRepository.setString('instanceDialogGroupId', form.groupId || ''),
                configRepository.setString('instanceDialogGroupAccessType', form.groupAccessType || 'plus'),
                configRepository.setBool('instanceDialogAgeGate', Boolean(form.ageGate)),
                configRepository.setBool('instanceDialogQueueEnabled', Boolean(form.queueEnabled))
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
                throw new Error('The instance was created but VRChat did not return a launch location.');
            }
            const created = await resolveCreatedInstanceDetails(location, response.json, currentEndpoint, {
                accessType: form.accessType || 'public',
                ownerId: currentUserId
            });
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                toast.success('Instance created.');
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
                    toast.error('Instance created, but the new instance location is not inviteable.');
                } else {
                    try {
                        await selfInviteToInstance(location, created.shortName || created.secureOrShortName || '', currentEndpoint);
                        toast.success('Instance created and self invite sent.');
                    } catch (error) {
                        toast.error(error instanceof Error ? `Instance created, but self invite failed: ${error.message}` : 'Instance created, but self invite failed.');
                    }
                }
            } else {
                toast.success('Instance created.');
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to create instance.');
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
        toast.success('Instance URL copied.');
    }

    async function selfInviteCreatedInstance(created) {
        const parsedLocation = parseLocation(created?.location || '');
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error('Cannot self invite: location is not a concrete instance.');
            return;
        }
        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            await selfInviteToInstance(created.location, created.shortName || created.secureOrShortName || '', currentEndpoint);
            toast.success('Self invite sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to send self invite.');
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
        showLaunchDialog(created.location, created.shortName || '', created.secureOrShortName || '', {
            createdInstance: created,
            worldName: world?.name || ''
        });
    }

    async function openCreatedInstanceInGame(created) {
        if (!created?.location) {
            return;
        }
        const parsedLocation = parseLocation(created.location);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error('Cannot open in VRChat: location is not a concrete instance.');
            return;
        }
        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            const opened = await tryOpenLaunchLocation(created.location, created.shortName || created.secureOrShortName || '', currentEndpoint);
            if (!opened) {
                await selfInviteToInstance(created.location, created.shortName || created.secureOrShortName || '', currentEndpoint);
                toast.warning('Failed open instance in VRChat, falling back to self invite.');
                toast.success('Self invite sent.');
                return;
            }
            toast.success('VRChat launch request sent.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to open instance in VRChat.');
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
        const selectedWorld = request?.world || imageUploadWorldRef.current || world;
        const selectedWorldId = normalizeEntityId(selectedWorld?.id);
        const requestEndpoint = currentEndpoint;
        if (!blob || !selectedWorldId) {
            return;
        }

        actionStatusRef.current = 'image-upload';
        setActionStatus('image-upload');
        try {
            const base64Body = await readFileAsBase64(blob);
            const base64File = await mediaRepository.resizeImageToFitLimits(base64Body);
            const result = await withUploadTimeout(
                mediaRepository.uploadWorldImageLegacy({
                    worldId: selectedWorldId,
                    imageUrl: selectedWorld.imageUrl || selectedWorld.thumbnailImageUrl || '',
                    base64File,
                    blob,
                    endpoint: requestEndpoint
                })
            );
            const activeTarget = activeWorldTargetRef.current;
            if (activeTarget.worldId !== selectedWorldId || activeTarget.endpoint !== requestEndpoint) {
                return;
            }
            setWorld(worldProfileRepository.normalize(result.world));
            setDetail(`World image updated for ${selectedWorld.name || selectedWorldId}.`);
            toast.success('World image updated.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to upload world image.';
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
                onRename={() => void renameWorld()}
                onChangeDescription={() => void changeWorldDescription()}
                onChangeCapacity={() => void changeWorldCapacity('capacity', 'Capacity')}
                onChangeRecommendedCapacity={() => void changeWorldCapacity('recommendedCapacity', 'Recommended Capacity')}
                onChangePreview={() => void changeWorldYouTubePreview()}
                onChangeTags={() => void changeWorldTags()}
                onChangeAllowedDomains={() => void changeWorldAllowedDomains()}
                onChangeImage={() => void beginWorldImageUpload()}
                onNewInstance={() => void openNewInstanceDialog(false)}
                onNewInstanceSelfInvite={() => void openNewInstanceDialog(true)}
                onPublication={(nextPublished) => void updateWorldPublication(nextPublished)}
                onDeletePersistentData={() => void deleteWorldPersistentData()}
                onDelete={() => void deleteWorld()}
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
                onSelfInvite={(created) => void selfInviteCreatedInstance(created)}
                onInvite={inviteCreatedInstance}
                onLaunch={launchCreatedInstance}
                onOpenInGame={(created) => void openCreatedInstanceInGame(created)}
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
            <input
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
                title="Change world image"
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
                onSave={(tags) => void saveWorldTags(tags)}
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
                onSave={(urlList) => void saveWorldAllowedDomains(urlList)}
            />
        </>
    );

}
