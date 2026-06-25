import { CopyIcon, InfoIcon, MoreHorizontalIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { InstanceInviteDialog } from '@/components/dialogs/InstanceInviteDialog';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/services/entityMediaService';
import {
    attachRunningVrchat,
    launchVrchat,
    resolveLaunchDialogDetails,
    selfInviteToInstance
} from '@/services/launchService';
import { checkCanInvite } from '@/shared/utils/invite';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import { useLaunchStore } from '@/state/launchStore';
import { useModalStore } from '@/state/modalStore';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';
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

const emptyDetails: any = {
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

function normalizeInstanceLocation(instance: any) {
    return String(
        instance?.location ||
            instance?.instance?.location ||
            instance?.tag ||
            instance?.$location?.tag ||
            ''
    ).trim();
}

function normalizeInstanceLaunchToken(instance: any) {
    return normalizeString(
        instance?.launchToken ||
            instance?.instance?.launchToken ||
            instance?.secureOrShortName ||
            instance?.instance?.secureOrShortName ||
            instance?.shortName ||
            instance?.instance?.shortName
    );
}

function canInviteCreatedInstance(instance: any, currentUserId: any) {
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

function buildCachedInstanceMap(instances: any) {
    const map = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const location = normalizeInstanceLocation(instance);
        if (location) {
            map.set(location, instance?.instance || instance);
        }
    }
    return map;
}

function LaunchField({ label, value, notice = '', onCopy }: any) {
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
                    onClick={(event: any) => event.currentTarget.select()}
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

    const launchDialog = useLaunchStore((state: any) => state.launchDialog);
    const setLaunchDialogOpen = useLaunchStore(
        (state: any) => state.setLaunchDialogOpen
    );
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore(
        (state: any) => state.auth.currentUserId
    );
    const currentUserLocation = useRuntimeStore(
        (state: any) =>
            state.gameState.currentLocation ||
            state.auth.currentUserSnapshot?.$locationTag ||
            state.auth.currentUserSnapshot?.location ||
            ''
    );
    const isGameRunning = useRuntimeStore((state: any) =>
        Boolean(state.gameState.isGameRunning)
    );
    const defaultLaunchMode = usePreferencesStore(
        (state: any) => state.defaultLaunchMode
    );
    const groupInstancesState = useRuntimeStore(
        (state: any) => state.groupInstances
    );
    const groupInstances =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const confirm = useModalStore((state: any) => state.confirm);
    const [details, setDetails] = useState(emptyDetails);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState('');
    const [inviteOpen, setInviteOpen] = useState(false);
    const cachedInstances = useMemo(
        () => buildCachedInstanceMap(groupInstances),
        [groupInstances]
    );

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
            .then((nextDetails: any) => {
                if (active) {
                    setDetails(nextDetails);
                }
            })
            .catch((error: any) => {
                if (active) {
                    setDetails({
                        ...emptyDetails,
                        tag: launchDialog.tag,
                        location: launchDialog.tag
                    });
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : t(
                                  'host.launch_dialog.toast.failed_to_resolve_launch_details'
                              )
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

    async function copyField(value: any, label: any) {
        if (!value) {
            return;
        }
        await copyTextToClipboard(value);
        toast.success(
            t('host.launch_dialog.dynamic.value_copied', {
                value: label
            })
        );
    }

    async function runAction(key: any, action: any) {
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
                error instanceof Error
                    ? error.message
                    : t('host.launch_dialog.toast.launch_action_failed')
            );
        } finally {
            setBusy('');
        }
    }

    async function launchWithMode(nextDesktopMode: any) {
        if (isGameRunning) {
            const result = await confirm({
                title: t('host.launch_dialog.modal.launch_vrchat'),
                description: t(
                    'host.launch_dialog.modal.vrchat_is_already_running_continue_launching_this_instance'
                ),
                confirmText: t('host.launch_dialog.modal.launch'),
                cancelText: t('common.actions.cancel')
            });
            if (!result.ok) {
                return false;
            }
            await launchVrchat(
                actionTag,
                actionLaunchToken,
                nextDesktopMode,
                currentEndpoint
            );
            return true;
        }
        await launchVrchat(
            actionTag,
            actionLaunchToken,
            nextDesktopMode,
            currentEndpoint
        );
        return true;
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
    const defaultDesktopMode = defaultLaunchMode === 'desktop';
    const alternateDesktopMode = !defaultDesktopMode;
    const primaryLabel = defaultDesktopMode
        ? t('dialog.launch.action.start_as_desktop')
        : t('dialog.launch.launch');
    const alternateLaunchKey = alternateDesktopMode
        ? 'launch-desktop'
        : 'launch-vr';
    const alternateLabel = alternateDesktopMode
        ? t('dialog.launch.action.start_as_desktop')
        : t('dialog.launch.launch');

    return (
        <>
            <Dialog
                open={Boolean(launchDialog.open)}
                onOpenChange={setLaunchDialogOpen}
            >
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{t('dialog.launch.header')}</DialogTitle>
                        <DialogDescription>
                            {t(
                                'dialog.launch.action.open_copy_invite_or_self_invite_to_this_vrchat_instance'
                            )}
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
                            onCopy={() => {
                                copyField(details.url, 'Launch URL');
                            }}
                        />
                        {details.shortUrl ? (
                            <LaunchField
                                label={t('dialog.launch.short_url')}
                                value={details.shortUrl}
                                notice="Only available when VRChat returned a short name for this instance."
                                onCopy={() => {
                                    copyField(details.shortUrl, 'Short URL');
                                }}
                            />
                        ) : null}
                        <LaunchField
                            label={t('dialog.launch.location')}
                            value={details.location}
                            onCopy={() => {
                                copyField(details.location, 'Location');
                            }}
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
                                {t('dialog.launch.invite')}
                            </Button>
                            {canOpenInstanceInGame ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={
                                        !canUseResolvedInstance || Boolean(busy)
                                    }
                                    onClick={() => {
                                        runAction('attach', () =>
                                            attachRunningVrchat(
                                                actionTag,
                                                actionLaunchToken,
                                                currentEndpoint
                                            )
                                        );
                                    }}
                                >
                                    {t('dialog.launch.action.open_in_game')}
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                disabled={
                                    !canUseResolvedInstance || Boolean(busy)
                                }
                                onClick={() => {
                                    runAction('self-invite', () =>
                                        selfInviteToInstance(
                                            actionTag,
                                            actionLaunchToken,
                                            currentEndpoint
                                        )
                                    );
                                }}
                            >
                                {t('dialog.launch.label.self_invite')}
                            </Button>
                        </div>
                        <div className="flex">
                            <Button
                                type="button"
                                disabled={
                                    !canUseResolvedInstance || Boolean(busy)
                                }
                                className="rounded-r-none"
                                onClick={() => {
                                    runAction('launch', () =>
                                        launchWithMode(defaultDesktopMode)
                                    );
                                }}
                            >
                                {busy === 'launch'
                                    ? t('common.loading')
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
                                        aria-label={'More launch options'}
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
                                            onSelect={() => {
                                                runAction(
                                                    alternateLaunchKey,
                                                    () =>
                                                        launchWithMode(
                                                            alternateDesktopMode
                                                        )
                                                );
                                            }}
                                        >
                                            {alternateLabel}
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
