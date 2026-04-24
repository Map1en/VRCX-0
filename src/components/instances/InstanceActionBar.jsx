import {
    HistoryIcon,
    LogInIcon,
    MailIcon,
    RefreshCwIcon,
    UsersRoundIcon,
    XCircleIcon
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import { formatDateFilter } from '@/lib/dateTime.js';
import { cn } from '@/lib/utils.js';
import { instanceRepository } from '@/repositories/index.js';
import { selfInviteToInstance } from '@/services/launchService.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useLaunchStore } from '@/state/launchStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function finiteNumber(value) {
    if (value === null || typeof value === 'undefined' || value === '') {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function firstFiniteNumber(...values) {
    for (const value of values) {
        const number = finiteNumber(value);
        if (number !== null) {
            return number;
        }
    }
    return null;
}

function ActionButton({
    label,
    disabled = false,
    loading = false,
    icon: Icon,
    onClick
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="outline"
                        aria-label={label}
                        disabled={disabled || loading}
                        onClick={onClick}
                    >
                        {loading ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <Icon data-icon="inline-start" />
                        )}
                    </Button>
                </span>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

function resolveLocation(baseLocation, fallbackLocation) {
    const normalized = normalizeString(baseLocation);
    if (normalized) {
        return normalized;
    }
    return normalizeString(fallbackLocation);
}

function instanceUserCount(instance) {
    if (!instance) {
        return null;
    }
    return firstFiniteNumber(
        instance.userCount,
        instance.occupants,
        instance.n_users,
        Array.isArray(instance.users) ? instance.users.length : null
    );
}

function instanceCapacity(instance) {
    if (!instance) {
        return null;
    }
    return firstFiniteNumber(instance.capacity, instance.world?.capacity);
}

function platformCount(instance, platform) {
    return Number(instance?.platforms?.[platform] ?? 0);
}

function disabledContentSettings(instance) {
    return Array.isArray(instance?.$disabledContentSettings)
        ? instance.$disabledContentSettings.filter(Boolean).join(', ')
        : '';
}

function hasGroupPermission(group, permission) {
    const direct = Array.isArray(group?.myMember?.permissions)
        ? group.myMember.permissions
        : [];
    if (direct.includes('*') || direct.includes(permission)) {
        return true;
    }
    const roleIds = Array.isArray(group?.myMember?.roleIds)
        ? group.myMember.roleIds
        : [];
    return (Array.isArray(group?.roles) ? group.roles : [])
        .filter((role) => roleIds.includes(role?.id))
        .some(
            (role) =>
                Array.isArray(role.permissions) &&
                (role.permissions.includes('*') ||
                    role.permissions.includes(permission))
        );
}

function canCloseInstance(instance, currentUserId) {
    const ownerId = normalizeString(instance?.ownerId);
    if (!ownerId || !currentUserId) {
        return false;
    }
    if (ownerId === currentUserId) {
        return true;
    }
    if (!ownerId.startsWith('grp_')) {
        return false;
    }
    return (
        hasGroupPermission(instance?.group, 'group-instance-moderate') ||
        hasGroupPermission(instance?.owner, 'group-instance-moderate')
    );
}

function InstanceInfoTooltip({
    instance,
    canClose,
    closeDisabled,
    onClose,
    children
}) {
    const { t } = useTranslation();

    const disabledContent = disabledContentSettings(instance);
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent className="max-w-sm text-xs">
                <div className="flex flex-col gap-1.5">
                    {instance?.closedAt ? (
                        <div>
                            {t('dialog.instance.generated.closed_at')}{' '}
                            {formatDateFilter(instance.closedAt, 'long')}
                        </div>
                    ) : null}
                    {canClose ? (
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            className="h-7"
                            disabled={
                                closeDisabled || Boolean(instance?.closedAt)
                            }
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onClose?.();
                            }}
                        >
                            {t('dialog.instance.generated.close_instance')}
                        </Button>
                    ) : null}
                    <div>
                        <span className="text-platform-pc">PC: </span>
                        {platformCount(instance, 'standalonewindows')}
                        <span className="text-platform-quest ml-2">
                            {t('dialog.instance.generated.android')}{' '}
                        </span>
                        {platformCount(instance, 'android')}
                    </div>
                    <div>
                        {t('dialog.instance.generated.ios')}{' '}
                        {platformCount(instance, 'ios')}
                    </div>
                    {instance?.gameServerVersion ? (
                        <div>{t('dialog.instance.generated.game_version')} {instance.gameServerVersion}</div>
                    ) : null}
                    {instance?.queueEnabled ? (
                        <div>{t('dialog.instance.generated.instance_queuing_enabled')}</div>
                    ) : null}
                    {disabledContent ? (
                        <div>{t('dialog.instance.generated.disabled_content')} {disabledContent}</div>
                    ) : null}
                </div>
            </TooltipContent>
        </Tooltip>
    );
}

export function InstanceActionBar({
    className,
    location = '',
    launchLocation = '',
    inviteLocation = '',
    instanceLocation = '',
    shortName = '',
    worldName = '',
    instance = null,
    friendCount,
    playerCount,
    capacity: providedCapacity,
    showLaunch = true,
    showInvite = true,
    showRefresh = true,
    showHistory = false,
    showInstanceInfo = true,
    refreshTooltip = 'Refresh instance info',
    historyTooltip = 'Previous instance history',
    onRefresh,
    onHistory
}) {
    const { t } = useTranslation();

    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const confirm = useModalStore((state) => state.confirm);
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const [busy, setBusy] = useState('');
    const [instanceInfo, setInstanceInfo] = useState(instance);
    const resolvedLaunchLocation = resolveLocation(launchLocation, location);
    const resolvedInviteLocation = resolveLocation(inviteLocation, location);
    const resolvedInstanceLocation = resolveLocation(
        instanceLocation,
        location
    );
    const parsedInviteLocation = useMemo(
        () => parseLocation(resolvedInviteLocation),
        [resolvedInviteLocation]
    );
    const parsedLaunchLocation = useMemo(
        () => parseLocation(resolvedLaunchLocation),
        [resolvedLaunchLocation]
    );
    const parsedInstanceLocation = useMemo(
        () => parseLocation(resolvedInstanceLocation),
        [resolvedInstanceLocation]
    );
    const isRealInviteLocation = Boolean(
        parsedInviteLocation.isRealInstance &&
        parsedInviteLocation.worldId &&
        parsedInviteLocation.instanceId
    );
    const isRealLaunchLocation = Boolean(
        parsedLaunchLocation.isRealInstance &&
        parsedLaunchLocation.worldId &&
        parsedLaunchLocation.instanceId
    );
    const isRealInstanceLocation = Boolean(
        parsedInstanceLocation.isRealInstance &&
        parsedInstanceLocation.worldId &&
        parsedInstanceLocation.instanceId
    );
    const userCount = instanceUserCount(instanceInfo);
    const providedPlayerCount = finiteNumber(playerCount);
    const resolvedUserCount = userCount ?? providedPlayerCount ?? 0;
    const capacity =
        instanceCapacity(instanceInfo) ?? finiteNumber(providedCapacity) ?? 0;
    const hasUserCount = userCount !== null || providedPlayerCount !== null;
    const canCloseCurrentInstance = canCloseInstance(
        instanceInfo,
        currentUserId
    );
    const activeContextRef = useRef({
        endpoint,
        location: resolvedInstanceLocation
    });
    const hasInstanceSummary = Boolean(
        instanceInfo || hasUserCount || capacity || friendCount
    );
    const queueSize = Number(instanceInfo?.queueSize) || 0;
    const hasAgeGate = Boolean(
        instanceInfo?.ageGate || resolvedInstanceLocation.includes('~ageGate')
    );

    useEffect(() => {
        activeContextRef.current = {
            endpoint,
            location: resolvedInstanceLocation
        };
        setInstanceInfo(instance);
    }, [endpoint, instance, resolvedInstanceLocation]);

    function launchInstance() {
        if (!resolvedLaunchLocation || busy) {
            return;
        }
        showLaunchDialog(
            resolvedLaunchLocation,
            parsedLaunchLocation.shortName || '',
            shortName || parsedLaunchLocation.shortName || '',
            {
                worldName
            }
        );
    }

    async function selfInvite() {
        if (!isRealInviteLocation || busy) {
            return;
        }
        setBusy('invite');
        try {
            await selfInviteToInstance(
                resolvedInviteLocation,
                shortName || parsedInviteLocation.shortName,
                endpoint
            );
            toast.success(t('dialog.instance.generated.self_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.instance_action_bar.generated_toast.failed_to_send_self_invite')
            );
        } finally {
            setBusy('');
        }
    }

    async function refreshInstance() {
        if (!isRealInstanceLocation || busy) {
            return;
        }
        const requestLocation = resolvedInstanceLocation;
        const requestEndpoint = endpoint;
        setBusy('refresh');
        try {
            const override = await onRefresh?.(requestLocation);
            if (
                activeContextRef.current.location !== requestLocation ||
                activeContextRef.current.endpoint !== requestEndpoint
            ) {
                return;
            }
            if (override) {
                setInstanceInfo(override);
            } else {
                const response = await instanceRepository.getInstance({
                    worldId: parsedInstanceLocation.worldId,
                    instanceId: parsedInstanceLocation.instanceId,
                    endpoint: requestEndpoint
                });
                if (
                    activeContextRef.current.location !== requestLocation ||
                    activeContextRef.current.endpoint !== requestEndpoint
                ) {
                    return;
                }
                setInstanceInfo(response.json);
            }
            toast.success(t('dialog.instance.generated.instance_refreshed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.instance_action_bar.generated_toast.failed_to_refresh_instance')
            );
        } finally {
            setBusy('');
        }
    }

    async function closeInstance() {
        if (!resolvedInstanceLocation || busy) {
            return;
        }
        const requestLocation = resolvedInstanceLocation;
        const requestEndpoint = endpoint;
        const result = await confirm({
            title: t('component.instance_action_bar.generated_modal.close_instance'),
            description: requestLocation,
            confirmText: t('common.actions.close'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setBusy('close');
        try {
            const response = await instanceRepository.closeInstance({
                location: requestLocation,
                hardClose: false,
                endpoint: requestEndpoint
            });
            if (
                activeContextRef.current.location !== requestLocation ||
                activeContextRef.current.endpoint !== requestEndpoint
            ) {
                return;
            }
            if (response.json) {
                setInstanceInfo(response.json);
            }
            toast.success(t('dialog.instance.generated.instance_closed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('component.instance_action_bar.generated_toast.failed_to_close_instance')
            );
        } finally {
            setBusy('');
        }
    }

    if (
        !resolvedInstanceLocation &&
        !resolvedLaunchLocation &&
        !resolvedInviteLocation
    ) {
        return null;
    }

    return (
        <div
            className={cn(
                'inline-flex items-center gap-1.5 align-middle',
                className
            )}
        >
            {showLaunch && isRealLaunchLocation ? (
                <ActionButton
                    label={t('dialog.instance.generated.launch_instance')}
                    icon={LogInIcon}
                    loading={busy === 'launch'}
                    disabled={Boolean(busy)}
                    onClick={launchInstance}
                />
            ) : null}
            {showInvite && isRealInviteLocation ? (
                <ActionButton
                    label={t('dialog.instance.generated.self_invite')}
                    icon={MailIcon}
                    loading={busy === 'invite'}
                    disabled={Boolean(busy)}
                    onClick={() => void selfInvite()}
                />
            ) : null}
            {showRefresh && isRealInstanceLocation ? (
                <ActionButton
                    label={refreshTooltip}
                    icon={RefreshCwIcon}
                    loading={busy === 'refresh'}
                    disabled={Boolean(busy)}
                    onClick={() => void refreshInstance()}
                />
            ) : null}
            {showHistory ? (
                <ActionButton
                    label={historyTooltip}
                    icon={HistoryIcon}
                    disabled={Boolean(busy)}
                    onClick={onHistory}
                />
            ) : null}
            {showInstanceInfo && hasInstanceSummary ? (
                <InstanceInfoTooltip
                    instance={instanceInfo}
                    location={resolvedInstanceLocation}
                    canClose={canCloseCurrentInstance}
                    closeDisabled={Boolean(busy)}
                    onClose={() => void closeInstance()}
                >
                    <div className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        {hasUserCount || capacity ? (
                            <span>
                                {resolvedUserCount}
                                {capacity ? `/${capacity}` : ''}
                            </span>
                        ) : null}
                        {friendCount ? (
                            <span className="inline-flex items-center gap-0.5">
                                <UsersRoundIcon className="size-3.5" />
                                {friendCount}
                            </span>
                        ) : null}
                        {canCloseCurrentInstance ? (
                            busy === 'close' ? (
                                <Spinner className="size-3.5" />
                            ) : (
                                <XCircleIcon className="size-3.5" />
                            )
                        ) : null}
                        {queueSize ? <span>{t('dialog.new_instance.queueEnabled')} {queueSize}</span> : null}
                        {hasAgeGate ? (
                            <Badge variant="destructive">{t('dialog.new_instance.ageGate')}</Badge>
                        ) : null}
                    </div>
                </InstanceInfoTooltip>
            ) : null}
        </div>
    );
}
