import { CopyIcon, InfoIcon, MoreHorizontalIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { InstanceInviteDialog } from '@/components/dialogs/InstanceInviteDialog.jsx';
import { copyTextToClipboard } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { configRepository } from '@/repositories/index.js';
import {
    attachRunningVrchat,
    launchVrchat,
    resolveLaunchDialogDetails,
    selfInviteToInstance
} from '@/services/launchService.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useLaunchStore } from '@/state/launchStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldLabel } from '@/ui/shadcn/field';
import { Input } from '@/ui/shadcn/input';

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
const closeAfterAction = new Set([
    'attach',
    'launch',
    'launch-vr',
    'launch-desktop'
]);

function normalizeInstanceLocation(instance) {
    return String(
        instance?.location ||
            instance?.instance?.location ||
            instance?.tag ||
            instance?.$location?.tag ||
            ''
    ).trim();
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
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
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
    const accessType = normalizeString(
        instance?.accessType ||
            instance?.instance?.accessType ||
            parsed.accessType
    );
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
        <Field>
            <div className="flex items-center gap-1.5 text-sm font-medium">
                <FieldLabel>{label}</FieldLabel>
                {notice ? (
                    <InfoIcon
                        className="text-muted-foreground"
                        title={notice}
                    />
                ) : null}
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
                    aria-label={`Copy ${label}`}
                    disabled={!value}
                    onClick={onCopy}
                >
                    <CopyIcon data-icon="inline-start" />
                </Button>
            </div>
        </Field>
    );
}

export function LaunchDialogHost() {
    const { t } = useTranslation();

    const launchDialog = useLaunchStore((state) => state.launchDialog);
    const setLaunchDialogOpen = useLaunchStore(
        (state) => state.setLaunchDialogOpen
    );
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserLocation = useRuntimeStore(
        (state) =>
            state.gameState.currentLocation ||
            state.auth.currentUserSnapshot?.$locationTag ||
            state.auth.currentUserSnapshot?.location ||
            ''
    );
    const isGameRunning = useRuntimeStore((state) =>
        Boolean(state.gameState.isGameRunning)
    );
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const groupInstances =
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const confirm = useModalStore((state) => state.confirm);
    const [details, setDetails] = useState(emptyDetails);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState('');
    const [desktopMode, setDesktopMode] = useState(false);
    const [inviteOpen, setInviteOpen] = useState(false);
    const cachedInstances = useMemo(
        () => buildCachedInstanceMap(groupInstances),
        [groupInstances]
    );

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
        resolveLaunchDialogDetails(
            launchDialog.tag,
            launchDialog.shortName,
            launchDialog.launchToken,
            currentEndpoint
        )
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
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t('host.launch_dialog.generated_toast.failed_to_resolve_launch_details')
                    );
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
    }, [
        currentEndpoint,
        launchDialog.launchToken,
        launchDialog.open,
        launchDialog.shortName,
        launchDialog.tag
    ]);

    async function copyField(value, label) {
        if (!value) {
            return;
        }
        await copyTextToClipboard(value);
        toast.success(t('host.launch_dialog.generated_dynamic.value_copied', { value: label }));
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
            toast.error(
                error instanceof Error ? error.message : t('host.launch_dialog.generated_toast.launch_action_failed')
            );
        } finally {
            setBusy('');
        }
    }

    async function launchWithMode(nextDesktopMode) {
        if (isGameRunning) {
            const result = await confirm({
                title: t('host.launch_dialog.generated_modal.launch_vrchat'),
                description:
                    t('host.launch_dialog.generated_modal.vrchat_is_already_running_continue_launching_thi'),
                confirmText: t('host.launch_dialog.generated_modal.launch'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return false;
            }
        }
        await launchVrchat(
            actionTag,
            actionLaunchToken,
            nextDesktopMode,
            currentEndpoint
        );
        return true;
    }

    async function selectLaunchMode(nextDesktopMode) {
        setDesktopMode(nextDesktopMode);
        await configRepository.setBool('launchAsDesktop', nextDesktopMode);
        return launchWithMode(nextDesktopMode);
    }

    const actionTag =
        details.tag || normalizeInstanceLocation(launchDialog.createdInstance);
    const actionLaunchToken =
        details.launchToken ||
        details.shortName ||
        normalizeInstanceLaunchToken(launchDialog.createdInstance) ||
        launchDialog.launchToken ||
        launchDialog.shortName ||
        '';
    const canInviteResolvedInstance =
        Boolean(actionTag) &&
        (checkCanInvite(actionTag, {
            currentUserId,
            lastLocationStr: currentUserLocation,
            cachedInstances
        }) ||
            canInviteCreatedInstance(
                launchDialog.createdInstance,
                currentUserId
            ));
    const canUseResolvedInstance = Boolean(actionTag);
    const canOpenInstanceInGame = Boolean(isGameRunning);
    const primaryLabel = desktopMode ? 'Start as Desktop' : 'Launch';

    return (
        <>
            <Dialog
                open={Boolean(launchDialog.open)}
                onOpenChange={setLaunchDialogOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{t('dialog.launch.generated.launch')}</DialogTitle>
                        <DialogDescription>
                            {t('dialog.launch.generated.open_copy_invite_or_self_invite_to_this_vrchat_instance')}
                        </DialogDescription>
                    </DialogHeader>

                    <div
                        className={cn(
                            'flex flex-col gap-4',
                            loading ? 'opacity-60' : ''
                        )}
                    >
                        <LaunchField
                            label="URL"
                            value={details.url}
                            onCopy={() =>
                                void copyField(details.url, 'Launch URL')
                            }
                        />
                        {details.shortUrl ? (
                            <LaunchField
                                label={t('dialog.launch.short_url')}
                                value={details.shortUrl}
                                notice="Only available when VRChat returned a short name for this instance."
                                onCopy={() =>
                                    void copyField(
                                        details.shortUrl,
                                        'Short URL'
                                    )
                                }
                            />
                        ) : null}
                        <LaunchField
                            label={t('dialog.launch.generated.location')}
                            value={details.location}
                            onCopy={() =>
                                void copyField(details.location, 'Location')
                            }
                        />
                    </div>

                    <DialogFooter className="items-center sm:justify-between">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={
                                    !canInviteResolvedInstance || Boolean(busy)
                                }
                                onClick={() => setInviteOpen(true)}
                            >
                                {t('dialog.launch.generated.invite')}
                            </Button>
                            {canOpenInstanceInGame ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={
                                        !canUseResolvedInstance || Boolean(busy)
                                    }
                                    onClick={() =>
                                        void runAction('attach', () =>
                                            attachRunningVrchat(
                                                actionTag,
                                                actionLaunchToken,
                                                currentEndpoint
                                            )
                                        )
                                    }
                                >
                                    {t('dialog.launch.generated.open_in_game')}
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                disabled={
                                    !canUseResolvedInstance || Boolean(busy)
                                }
                                onClick={() =>
                                    void runAction('self-invite', () =>
                                        selfInviteToInstance(
                                            actionTag,
                                            actionLaunchToken,
                                            currentEndpoint
                                        )
                                    )
                                }
                            >
                                {t('dialog.launch.generated.self_invite')}
                            </Button>
                        </div>
                        <div className="flex">
                            <Button
                                type="button"
                                disabled={
                                    !canUseResolvedInstance || Boolean(busy)
                                }
                                className="rounded-r-none"
                                onClick={() =>
                                    void runAction('launch', () =>
                                        launchWithMode(desktopMode)
                                    )
                                }
                            >
                                {busy === 'launch'
                                    ? 'Launching...'
                                    : primaryLabel}
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        size="icon"
                                        disabled={
                                            !canUseResolvedInstance ||
                                            Boolean(busy)
                                        }
                                        className="border-primary-foreground/25 rounded-l-none border-l"
                                        aria-label={"More launch options"}
                                    >
                                        <MoreHorizontalIcon data-icon="inline-start" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="w-48"
                                >
                                    <DropdownMenuGroup>
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                void runAction(
                                                    'launch-vr',
                                                    () =>
                                                        selectLaunchMode(false)
                                                )
                                            }
                                        >
                                            {t('dialog.launch.generated.launch')}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                void runAction(
                                                    'launch-desktop',
                                                    () => selectLaunchMode(true)
                                                )
                                            }
                                        >
                                            {t('dialog.launch.generated.start_as_desktop')}
                                        </DropdownMenuItem>
                                    </DropdownMenuGroup>
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
