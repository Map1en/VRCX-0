import {
    CheckIcon,
    Gamepad2Icon,
    Link2Icon,
    LinkIcon,
    MailIcon,
    MapPinIcon,
    MonitorIcon,
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
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

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

const copyIconClass =
    'absolute size-4 transition-[opacity,filter,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]';
const copyIconHiddenClass = 'scale-90 opacity-0 blur-[2px]';

function CopyButton({
    icon: Icon,
    label,
    value,
    onCopy
}: {
    icon: LucideIcon;
    label: string;
    value: string;
    onCopy(): Promise<boolean>;
}) {
    const [copyCount, setCopyCount] = useState(0);
    const copied = copyCount > 0;

    useEffect(() => {
        if (!copyCount) {
            return;
        }
        const timer = window.setTimeout(() => setCopyCount(0), 1600);
        return () => window.clearTimeout(timer);
    }, [copyCount]);

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={label}
                        disabled={!value}
                        onClick={() => {
                            onCopy().then((ok) => {
                                if (ok) {
                                    setCopyCount((count) => count + 1);
                                }
                            });
                        }}
                    >
                        <span className="relative inline-flex size-4 items-center justify-center">
                            <Icon
                                className={cn(
                                    copyIconClass,
                                    copied && copyIconHiddenClass
                                )}
                            />
                            <CheckIcon
                                className={cn(
                                    copyIconClass,
                                    !copied && copyIconHiddenClass
                                )}
                            />
                        </span>
                    </Button>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
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
            await launchVrchat(actionTag, actionLaunchToken, nextDesktopMode);
            return true;
        }
        await launchVrchat(actionTag, actionLaunchToken, nextDesktopMode);
        return true;
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
        shortName: actionLaunchToken
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
                                    attachRunningVrchat(
                                        actionTag,
                                        actionLaunchToken
                                    )
                                );
                            }}
                        />
                    </div>

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
                                        selfInviteToInstance(
                                            actionTag,
                                            actionLaunchToken
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
                            <CopyButton
                                icon={Share2Icon}
                                label={t('dialog.world.info.copy_vrcx_url')}
                                value={vrcxInstanceUrl}
                                onCopy={() =>
                                    copyField(
                                        t('dialog.world.info.vrcx_share_text', {
                                            name: `${subtitle} #${instanceName}`,
                                            url: vrcxInstanceUrl
                                        }),
                                        t('dialog.world.info.vrcx_url')
                                    )
                                }
                            />
                            <CopyButton
                                icon={LinkIcon}
                                label={t('accessibility.copy_value', {
                                    value: t('dialog.launch.copy.link')
                                })}
                                value={details.url}
                                onCopy={() =>
                                    copyField(
                                        details.url,
                                        t('dialog.launch.copy.link')
                                    )
                                }
                            />
                            <CopyButton
                                icon={MapPinIcon}
                                label={t('accessibility.copy_value', {
                                    value: t('dialog.launch.location')
                                })}
                                value={details.location}
                                onCopy={() =>
                                    copyField(
                                        details.location,
                                        t('dialog.launch.location')
                                    )
                                }
                            />
                            {details.shortUrl ? (
                                <CopyButton
                                    icon={Link2Icon}
                                    label={t('accessibility.copy_value', {
                                        value: t('dialog.launch.short_url')
                                    })}
                                    value={details.shortUrl}
                                    onCopy={() =>
                                        copyField(
                                            details.shortUrl,
                                            t('dialog.launch.short_url')
                                        )
                                    }
                                />
                            ) : null}
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
