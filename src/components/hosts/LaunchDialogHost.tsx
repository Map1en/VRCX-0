import {
    Gamepad2Icon,
    MailIcon,
    MonitorIcon,
    MoreHorizontalIcon,
    RectangleGogglesIcon,
    Share2Icon,
    UserPlusIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { InstanceInviteDialog } from '@/components/dialogs/InstanceInviteDialog';
import { useLocationMetadata } from '@/components/location/useLocationMetadata';
import type { GroupInstanceRecord } from '@/domain/entities/group';
import { cn } from '@/lib/utils';
import { selectAvatar } from '@/services/avatarSelectionService';
import { copyTextToClipboard } from '@/services/clipboardService';
import {
    attachRunningVrchat,
    launchVrchat,
    resolveLaunchDialogDetails,
    type LaunchDialogDetails,
    selfInviteToInstance
} from '@/services/launchService';
import { toast } from '@/services/toastService';
import { accessTypeLocaleKeyMap } from '@/shared/constants/accessType';
import { vrcxInstanceDeepLink } from '@/shared/constants/vrcxDeepLinks';
import { checkCanInvite } from '@/shared/utils/invite';
import { parseLocation, translateAccessType } from '@/shared/utils/location';
import {
    useLaunchStore,
    type LaunchCreatedInstance
} from '@/state/launchStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { HintTooltip } from '@/ui/hint-tooltip';
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
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { LaunchAvatarSwitch } from './LaunchAvatarSwitch';

const emptyDetails: LaunchDialogDetails = {
    tag: '',
    location: '',
    url: '',
    vrcUrl: '',
    shortName: '',
    launchToken: '',
    shortUrl: '',
    secureOrShortName: '',
    worldName: '',
    parsed: parseLocation('')
};
const EMPTY_GROUP_INSTANCES: GroupInstanceRecord[] = [];
const AVATAR_SWITCH_TIMEOUT_MS = 3000;
type LaunchActionKey =
    | 'attach'
    | 'launch-vr'
    | 'launch-desktop'
    | 'self-invite';
type LaunchAction = () => boolean | void | Promise<boolean | void>;
const closeAfterAction = new Set<LaunchActionKey>([
    'attach',
    'launch-vr',
    'launch-desktop'
]);

type CreatedInstanceRecord = Record<string, unknown> & {
    location?: string | null;
    tag?: string | null;
    closedAt?: string | null;
    instance?: CreatedInstanceRecord;
    $location?: { tag?: string | null };
};

function isCreatedInstanceRecord(
    value: unknown
): value is CreatedInstanceRecord {
    return Boolean(value && typeof value === 'object');
}

function createdInstanceRecord(value: unknown): CreatedInstanceRecord | null {
    return isCreatedInstanceRecord(value) ? value : null;
}

function normalizeInstanceLocation(instance: CreatedInstanceRecord | null) {
    return String(
        instance?.location ||
            instance?.instance?.location ||
            instance?.tag ||
            instance?.$location?.tag ||
            ''
    ).trim();
}

function canInviteCreatedInstance(
    instance: LaunchCreatedInstance | null,
    currentUserId: string | null
) {
    const location = instance?.location.trim() ?? '';
    if (!instance || !location) {
        return false;
    }
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return false;
    }
    const accessType = instance.accessType.trim() || parsed.accessType;
    const ownerId = instance.ownerId.trim() || parsed.userId || '';
    if (accessType === 'public' || accessType === 'group') {
        return true;
    }
    return Boolean(ownerId && currentUserId && ownerId === currentUserId);
}

function buildCachedInstanceMap(instances: readonly GroupInstanceRecord[]) {
    const map = new Map<string, CreatedInstanceRecord>();
    for (const value of instances) {
        const instance = createdInstanceRecord(value);
        if (!instance) {
            continue;
        }
        const location = normalizeInstanceLocation(instance);
        if (location) {
            map.set(location, instance?.instance || instance);
        }
    }
    return map;
}

function LaunchTile({
    icon: Icon,
    label,
    hint,
    pending,
    disabled,
    onClick
}: {
    icon: LucideIcon;
    label: string;
    hint?: string;
    pending: boolean;
    disabled: boolean;
    onClick(): void;
}) {
    return (
        <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={onClick}
            className="h-auto flex-col gap-1.5 px-2 py-3 whitespace-normal"
        >
            {pending ? (
                <Spinner className="size-5" />
            ) : (
                <Icon className="size-5" />
            )}
            <span className="text-sm leading-none font-medium">{label}</span>
            {hint ? (
                <span className="text-muted-foreground text-[10px] leading-tight">
                    {hint}
                </span>
            ) : null}
        </Button>
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
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning === true
    );
    const currentAvatarId = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot?.currentAvatar?.trim() || ''
    );
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const groupInstances =
        groupInstancesState.userId === currentUserId &&
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : EMPTY_GROUP_INSTANCES;
    const confirm = useModalStore((state) => state.confirm);
    const [details, setDetails] = useState(emptyDetails);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState('');
    const [inviteOpen, setInviteOpen] = useState(false);
    const [avatarSwitchOpen, setAvatarSwitchOpen] = useState(false);
    const [avatarSwitchTarget, setAvatarSwitchTarget] = useState('');
    const avatarSwitchValue = avatarSwitchTarget || currentAvatarId;
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
            setAvatarSwitchOpen(false);
            setAvatarSwitchTarget('');
            return () => {
                active = false;
            };
        }

        setLoading(true);
        resolveLaunchDialogDetails(
            launchDialog.tag,
            launchDialog.shortName,
            launchDialog.launchToken
        )
            .then((nextDetails) => {
                if (active) {
                    setDetails(nextDetails);
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setDetails({
                        ...emptyDetails,
                        tag: launchDialog.tag,
                        location: launchDialog.tag
                    });
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : t(
                                      'host.launch_dialog.toast.failed_to_resolve_launch_details'
                                  )
                    });
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
        launchDialog.launchToken,
        launchDialog.open,
        launchDialog.shortName,
        launchDialog.tag,
        t
    ]);

    async function copyField(value: string, label: string) {
        if (!value) {
            return false;
        }
        return copyTextToClipboard(value, {
            successMessage: t('host.launch_dialog.dynamic.value_copied', {
                value: label
            }),
            errorMessage: t('dialog.launch.copy.failed')
        });
    }

    const copyMenuItem = (value: string, label: string) => (
        <DropdownMenuItem
            disabled={!value}
            onClick={() => {
                void copyField(value, label);
            }}
        >
            {t('accessibility.copy_value', { value: label })}
        </DropdownMenuItem>
    );

    async function runAction(key: LaunchActionKey, action: LaunchAction) {
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
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('host.launch_dialog.toast.launch_action_failed')
            });
        } finally {
            setBusy('');
        }
    }

    async function switchAvatarBeforeJoin() {
        if (
            !avatarSwitchOpen ||
            !avatarSwitchValue ||
            avatarSwitchValue === currentAvatarId
        ) {
            return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error(t('dialog.launch.avatar_switch.timeout')));
            }, AVATAR_SWITCH_TIMEOUT_MS);
        });
        try {
            await Promise.race([selectAvatar(avatarSwitchValue), timeout]);
        } finally {
            clearTimeout(timer);
        }
        toast.add({
            type: 'success',
            title: t('dialog.avatar.success.avatar_selected')
        });
    }

    async function launchWithMode(nextDesktopMode: boolean) {
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
        }
        await switchAvatarBeforeJoin();
        await launchVrchat(actionTag, actionLaunchToken, nextDesktopMode);
        return true;
    }

    async function joinRunningGame(join: () => Promise<void>) {
        await switchAvatarBeforeJoin();
        await join();
    }

    const actionTag =
        details.location ||
        details.tag ||
        launchDialog.createdInstance?.location.trim() ||
        '';
    const actionLaunchToken =
        details.launchToken ||
        details.shortName ||
        launchDialog.createdInstance?.secureOrShortName.trim() ||
        launchDialog.createdInstance?.shortName.trim() ||
        launchDialog.launchToken ||
        launchDialog.shortName ||
        '';
    const shareLocation = useMemo(() => parseLocation(actionTag), [actionTag]);
    const { worldName, instanceName } = useLocationMetadata({
        locationInfo: shareLocation,
        currentLocation: actionTag,
        endpoint: currentEndpoint,
        worldNameHint: details.worldName || launchDialog.worldName,
        instanceName: shareLocation.instanceName
    });
    const vrcxInstanceUrl = vrcxInstanceDeepLink({
        worldId: shareLocation.worldId,
        instanceId: shareLocation.instanceId,
        shortName: details.shortName,
        launchToken: actionLaunchToken
    });
    const canInviteResolvedInstance =
        Boolean(actionTag) &&
        (checkCanInvite(actionTag, {
            currentUserId: currentUserId || '',
            lastLocationStr: currentUserLocation,
            cachedInstances
        }) ||
            canInviteCreatedInstance(
                launchDialog.createdInstance,
                currentUserId
            ));
    const actionDisabled = !actionTag || Boolean(busy);
    const inviteDisabled = !canInviteResolvedInstance || Boolean(busy);
    const inGameHint = isGameRunning
        ? ''
        : t('dialog.launch.tile.game_not_running');
    const accessTypeLabel = details.parsed.accessTypeName
        ? translateAccessType(
              details.parsed.accessTypeName,
              t,
              accessTypeLocaleKeyMap
          )
        : '';
    const subtitle =
        [worldName, accessTypeLabel].filter(Boolean).join(' · ') ||
        t('dialog.launch.subtitle_fallback');

    return (
        <>
            <Dialog
                open={Boolean(launchDialog.open)}
                onOpenChange={setLaunchDialogOpen}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader className="min-w-0">
                        <DialogTitle>{t('dialog.launch.header')}</DialogTitle>
                        <DialogDescription className="min-w-0 break-words whitespace-normal">
                            {subtitle}
                        </DialogDescription>
                    </DialogHeader>

                    <div
                        className={cn(
                            'grid min-w-0 grid-cols-3 gap-2',
                            loading && 'opacity-60'
                        )}
                    >
                        <LaunchTile
                            icon={RectangleGogglesIcon}
                            label={t('dialog.launch.tile.vr')}
                            pending={busy === 'launch-vr'}
                            disabled={actionDisabled}
                            onClick={() => {
                                runAction('launch-vr', () =>
                                    launchWithMode(false)
                                );
                            }}
                        />
                        <LaunchTile
                            icon={MonitorIcon}
                            label={t('dialog.launch.tile.desktop')}
                            pending={busy === 'launch-desktop'}
                            disabled={actionDisabled}
                            onClick={() => {
                                runAction('launch-desktop', () =>
                                    launchWithMode(true)
                                );
                            }}
                        />
                        <LaunchTile
                            icon={Gamepad2Icon}
                            label={t('dialog.launch.tile.in_game')}
                            hint={inGameHint}
                            pending={busy === 'attach'}
                            disabled={actionDisabled}
                            onClick={() => {
                                runAction('attach', () =>
                                    joinRunningGame(() =>
                                        attachRunningVrchat(
                                            actionTag,
                                            actionLaunchToken
                                        )
                                    )
                                );
                            }}
                        />
                    </div>

                    <LaunchAvatarSwitch
                        open={avatarSwitchOpen}
                        value={avatarSwitchValue}
                        disabled={Boolean(busy)}
                        onOpenChange={setAvatarSwitchOpen}
                        onValueChange={setAvatarSwitchTarget}
                    />

                    <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
                        <div className="flex gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={inviteDisabled}
                                onClick={() => setInviteOpen(true)}
                            >
                                <UserPlusIcon data-icon="inline-start" />
                                {t('dialog.launch.invite')}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={actionDisabled}
                                onClick={() => {
                                    runAction('self-invite', () =>
                                        joinRunningGame(() =>
                                            selfInviteToInstance(
                                                actionTag,
                                                actionLaunchToken
                                            )
                                        )
                                    );
                                }}
                            >
                                {busy === 'self-invite' ? (
                                    <Spinner
                                        data-icon="inline-start"
                                        className="size-3.5"
                                    />
                                ) : (
                                    <MailIcon data-icon="inline-start" />
                                )}
                                {t('dialog.launch.label.self_invite')}
                            </Button>
                        </div>
                        <div className="flex gap-0.5">
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            disabled={!vrcxInstanceUrl}
                                            onClick={() => {
                                                void copyField(
                                                    t(
                                                        'dialog.world.info.vrcx_share_text',
                                                        {
                                                            name: `${subtitle} #${instanceName}`,
                                                            url: vrcxInstanceUrl
                                                        }
                                                    ),
                                                    t(
                                                        'dialog.world.info.vrcx_url'
                                                    )
                                                );
                                            }}
                                        >
                                            <Share2Icon data-icon="inline-start" />
                                            {t('dialog.launch.share')}
                                        </Button>
                                    }
                                />
                                <TooltipContent>
                                    {t('dialog.launch.share_description')}
                                </TooltipContent>
                            </Tooltip>
                            <DropdownMenu>
                                <HintTooltip
                                    label={t('dialog.launch.more_copy_options')}
                                >
                                    <DropdownMenuTrigger
                                        render={
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                            >
                                                <MoreHorizontalIcon data-icon="inline-start" />
                                            </Button>
                                        }
                                    />
                                </HintTooltip>
                                <DropdownMenuContent align="end">
                                    {copyMenuItem(
                                        details.url,
                                        t('dialog.launch.copy.vrchat_link')
                                    )}
                                    {details.shortUrl
                                        ? copyMenuItem(
                                              details.shortUrl,
                                              t('dialog.launch.short_url')
                                          )
                                        : null}
                                    <DropdownMenuSeparator />
                                    {copyMenuItem(
                                        details.location,
                                        t('dialog.launch.copy.instance_id')
                                    )}
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
                worldName={worldName}
                endpoint={currentEndpoint}
                onOpenChange={setInviteOpen}
            />
        </>
    );
}
