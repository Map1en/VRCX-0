import { useEffect, useMemo, useState } from 'react';
import { CopyIcon, InfoIcon, MoreHorizontalIcon } from 'lucide-react';
import { toast } from 'sonner';

import { copyTextToClipboard } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { configRepository } from '@/repositories/index.js';
import {
    attachRunningVrchat,
    launchVrchat,
    resolveLaunchDialogDetails,
    selfInviteToInstance
} from '@/services/launchService.js';
import { useLaunchStore } from '@/state/launchStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/location.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { InstanceInviteDialog } from '@/components/dialogs/InstanceInviteDialog.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu.jsx';
import { Input } from '@/ui/shadcn/input.jsx';

const emptyDetails = {
    tag: '',
    location: '',
    url: '',
    vrcUrl: '',
    shortName: '',
    launchToken: '',
    shortUrl: '',
    secureOrShortName: '',
    worldName: ''
};
const closeAfterAction = new Set(['attach', 'launch', 'launch-vr', 'launch-desktop']);

function normalizeInstanceLocation(instance) {
    return String(instance?.location || instance?.instance?.location || instance?.tag || instance?.$location?.tag || '').trim();
}

function normalizeInstanceLaunchToken(instance) {
    return normalizeString(
        instance?.launchToken ||
        instance?.instance?.launchToken ||
        instance?.secureOrShortName ||
        instance?.instance?.secureOrShortName ||
        instance?.shortName ||
        instance?.instance?.shortName
    );
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function canInviteCreatedInstance(instance, currentUserId) {
    const location = normalizeInstanceLocation(instance);
    if (!location || instance?.closedAt || instance?.instance?.closedAt) {
        return false;
    }
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return false;
    }
    const accessType = normalizeString(instance?.accessType || instance?.instance?.accessType || parsed.accessType);
    const ownerId =
        normalizeString(instance?.ownerId) ||
        normalizeString(instance?.instance?.ownerId) ||
        normalizeString(instance?.owner?.id) ||
        normalizeString(instance?.instance?.owner?.id) ||
        normalizeString(instance?.creatorId) ||
        normalizeString(instance?.instance?.creatorId) ||
        normalizeString(parsed.userId);
    if (accessType === 'public' || accessType === 'group') {
        return true;
    }
    return Boolean(ownerId && currentUserId && ownerId === currentUserId);
}

function buildCachedInstanceMap(instances) {
    const map = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const location = normalizeInstanceLocation(instance);
        if (location) {
            map.set(location, instance?.instance || instance);
        }
    }
    return map;
}

function LaunchField({ label, value, notice = '', onCopy }) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium">
                <span>{label}</span>
                {notice ? <InfoIcon className="size-3.5 text-muted-foreground" title={notice} /> : null}
            </div>
            <div className="flex items-center gap-2">
                <Input
                    readOnly
                    value={value || ''}
                    className="h-8 font-mono text-xs"
                    onClick={(event) => event.currentTarget.select()}
                />
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 rounded-full"
                    disabled={!value}
                    onClick={onCopy}>
                    <CopyIcon className="size-4" />
                </Button>
            </div>
        </div>
    );
}

export function LaunchDialogHost() {
    const launchDialog = useLaunchStore((state) => state.launchDialog);
    const setLaunchDialogOpen = useLaunchStore((state) => state.setLaunchDialogOpen);
    const currentEndpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserLocation = useRuntimeStore((state) =>
        state.gameState.currentLocation ||
        state.auth.currentUserSnapshot?.$locationTag ||
        state.auth.currentUserSnapshot?.location ||
        ''
    );
    const isGameRunning = useRuntimeStore((state) => Boolean(state.gameState.isGameRunning));
    const groupInstancesState = useRuntimeStore((state) => state.groupInstances);
    const groupInstances = groupInstancesState.endpoint === currentEndpoint ? groupInstancesState.instances : [];
    const confirm = useModalStore((state) => state.confirm);
    const [details, setDetails] = useState(emptyDetails);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState('');
    const [desktopMode, setDesktopMode] = useState(false);
    const [inviteOpen, setInviteOpen] = useState(false);
    const cachedInstances = useMemo(() => buildCachedInstanceMap(groupInstances), [groupInstances]);

    useEffect(() => {
        let active = true;
        configRepository
            .getBool('launchAsDesktop', false)
            .then((nextDesktopMode) => {
                if (active) {
                    setDesktopMode(Boolean(nextDesktopMode));
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;
        if (!launchDialog.open || !launchDialog.tag) {
            setDetails(emptyDetails);
            setLoading(false);
            setInviteOpen(false);
            return () => {
                active = false;
            };
        }

        setLoading(true);
        resolveLaunchDialogDetails(launchDialog.tag, launchDialog.shortName, launchDialog.launchToken, currentEndpoint)
            .then((nextDetails) => {
                if (active) {
                    setDetails(nextDetails);
                }
            })
            .catch((error) => {
                if (active) {
                    setDetails({
                        ...emptyDetails,
                        tag: launchDialog.tag,
                        location: launchDialog.tag
                    });
                    toast.error(error instanceof Error ? error.message : 'Failed to resolve launch details.');
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, launchDialog.launchToken, launchDialog.open, launchDialog.shortName, launchDialog.tag]);

    async function copyField(value, label) {
        if (!value) {
            return;
        }
        await copyTextToClipboard(value);
        toast.success(`${label} copied.`);
    }

    async function runAction(key, action) {
        if (busy || loading) {
            return;
        }
        setBusy(key);
        try {
            const result = await action();
            if (closeAfterAction.has(key) && result !== false) {
                setLaunchDialogOpen(false);
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Launch action failed.');
        } finally {
            setBusy('');
        }
    }

    async function launchWithMode(nextDesktopMode) {
        if (isGameRunning) {
            const result = await confirm({
                title: 'Launch VRChat',
                description: 'VRChat is already running. Continue launching this instance?',
                confirmText: 'Launch',
                cancelText: 'Cancel'
            });
            if (!result.ok) {
                return false;
            }
        }
        await launchVrchat(actionTag, actionLaunchToken, nextDesktopMode, currentEndpoint);
        return true;
    }

    async function selectLaunchMode(nextDesktopMode) {
        setDesktopMode(nextDesktopMode);
        await configRepository.setBool('launchAsDesktop', nextDesktopMode);
        return launchWithMode(nextDesktopMode);
    }

    const actionTag = details.tag || normalizeInstanceLocation(launchDialog.createdInstance);
    const actionLaunchToken =
        details.launchToken ||
        details.shortName ||
        normalizeInstanceLaunchToken(launchDialog.createdInstance) ||
        launchDialog.launchToken ||
        launchDialog.shortName ||
        '';
    const canInviteResolvedInstance = Boolean(actionTag) && (checkCanInvite(actionTag, {
        currentUserId,
        lastLocationStr: currentUserLocation,
        cachedInstances
    }) || canInviteCreatedInstance(launchDialog.createdInstance, currentUserId));
    const canUseResolvedInstance = Boolean(actionTag);
    const canOpenInstanceInGame = Boolean(isGameRunning);
    const primaryLabel = desktopMode ? 'Start as Desktop' : 'Launch';

    return (
        <>
            <Dialog open={Boolean(launchDialog.open)} onOpenChange={setLaunchDialogOpen}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Launch</DialogTitle>
                        <DialogDescription>Open, copy, invite, or self-invite to this VRChat instance.</DialogDescription>
                    </DialogHeader>

                    <div className={cn('space-y-4', loading ? 'opacity-60' : '')}>
                        <LaunchField
                            label="URL"
                            value={details.url}
                            onCopy={() => void copyField(details.url, 'Launch URL')}
                        />
                        {details.shortUrl ? (
                            <LaunchField
                                label="Short URL"
                                value={details.shortUrl}
                                notice="Only available when VRChat returned a short name for this instance."
                                onCopy={() => void copyField(details.shortUrl, 'Short URL')}
                            />
                        ) : null}
                        <LaunchField
                            label="Location"
                            value={details.location}
                            onCopy={() => void copyField(details.location, 'Location')}
                        />
                    </div>

                    <DialogFooter className="items-center sm:justify-between">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={!canInviteResolvedInstance || Boolean(busy)}
                                onClick={() => setInviteOpen(true)}>
                                Invite
                            </Button>
                            {canOpenInstanceInGame ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={!canUseResolvedInstance || Boolean(busy)}
                                    onClick={() => void runAction('attach', () => attachRunningVrchat(actionTag, actionLaunchToken, currentEndpoint))}>
                                    Open In-Game
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                disabled={!canUseResolvedInstance || Boolean(busy)}
                                onClick={() => void runAction('self-invite', () => selfInviteToInstance(actionTag, actionLaunchToken, currentEndpoint))}>
                                Self Invite
                            </Button>
                        </div>
                        <div className="flex">
                            <Button
                                type="button"
                                disabled={!canUseResolvedInstance || Boolean(busy)}
                                className="rounded-r-none"
                                onClick={() => void runAction('launch', () => launchWithMode(desktopMode))}>
                                {busy === 'launch' ? 'Launching...' : primaryLabel}
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        size="icon"
                                        disabled={!canUseResolvedInstance || Boolean(busy)}
                                        className="rounded-l-none border-l border-primary-foreground/25"
                                        aria-label="More launch options">
                                        <MoreHorizontalIcon className="size-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    <DropdownMenuItem onSelect={() => void runAction('launch-vr', () => selectLaunchMode(false))}>
                                        Launch
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onSelect={() => void runAction('launch-desktop', () => selectLaunchMode(true))}>
                                        Start as Desktop
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <InstanceInviteDialog
                open={inviteOpen}
                location={actionTag}
                launchToken={actionLaunchToken}
                worldName={details.worldName || launchDialog.worldName || ''}
                endpoint={currentEndpoint}
                onOpenChange={setInviteOpen}
            />
        </>
    );
}
