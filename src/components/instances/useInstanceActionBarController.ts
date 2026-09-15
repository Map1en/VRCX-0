import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    buildInstanceActionTarget,
    finiteLocationNumber,
    firstFiniteLocationNumber,
    firstNonNegativeLocationNumber,
    normalizeLocationText,
    type LocationObjectRecord
} from '@/components/location/locationModel';
import { instanceLocationKey } from '@/domain/presence/instancePresence';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import { recordLocationHintsFromInstances } from '@/services/domainIngestionService';
import { selfInviteToInstance } from '@/services/launchService';
import { toast } from '@/services/toastService';
import { hasGroupIdPrefix } from '@/shared/constants/vrchatIds';
import { useInstanceJoinHistoryStore } from '@/state/instanceJoinHistoryStore';
import { useLaunchStore } from '@/state/launchStore';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

type GroupPermissionRecord = Record<string, unknown> & {
    myMember?: { permissions?: string[]; roleIds?: string[] };
    roles?: Array<{ id?: string; permissions?: string[] }>;
};

export type InstanceActionRecord = Record<string, unknown> & {
    userCount?: number | null;
    occupants?: number | null;
    n_users?: number | null;
    users?: Array<Record<string, unknown> | string>;
    ref?: Partial<InstanceActionRecord> | null;
    $disabledContentSettings?: string[];
    group?: GroupPermissionRecord;
    owner?: GroupPermissionRecord;
    capacity?: number | null;
    world?: { capacity?: number | null };
    platforms?: Record<string, number>;
    ownerId?: string | null;
    closedAt?: string | null;
    gameServerVersion?: number | null;
    queueEnabled?: boolean;
    queueSize?: number | null;
    ageGate?: boolean;
};
type InstanceRefreshResult = InstanceActionRecord | null | void;

function isInstanceActionRecord(value: unknown): value is InstanceActionRecord {
    return Boolean(value && typeof value === 'object');
}

function instanceUserCount(instance: InstanceActionRecord | null) {
    if (!instance) {
        return null;
    }
    return firstNonNegativeLocationNumber(
        instance.userCount,
        instance.occupants,
        instance.n_users,
        Array.isArray(instance.users) ? instance.users.length : null
    );
}

function instanceCapacity(instance: InstanceActionRecord | null) {
    if (!instance) {
        return null;
    }
    return firstFiniteLocationNumber(
        instance.capacity,
        instance.world?.capacity
    );
}

function resolveInstanceSource(instance: unknown): InstanceActionRecord | null {
    if (!isInstanceActionRecord(instance)) {
        return null;
    }
    const source = instance;
    const ref = source.ref;
    if (!ref || typeof ref !== 'object') {
        return source;
    }
    return { ...ref, ...source };
}

function hasGroupPermission(
    group: GroupPermissionRecord | undefined,
    permission: string
) {
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
        .filter((role) => Boolean(role.id && roleIds.includes(role.id)))
        .some(
            (role) =>
                Array.isArray(role.permissions) &&
                (role.permissions.includes('*') ||
                    role.permissions.includes(permission))
        );
}

function canCloseInstance(
    instance: InstanceActionRecord | null,
    currentUserId: string | null
) {
    const ownerId = normalizeLocationText(instance?.ownerId);
    if (!ownerId || !currentUserId) {
        return false;
    }
    if (ownerId === currentUserId) {
        return true;
    }
    if (!hasGroupIdPrefix(ownerId)) {
        return false;
    }
    return (
        hasGroupPermission(instance?.group, 'group-instance-moderate') ||
        hasGroupPermission(instance?.owner, 'group-instance-moderate')
    );
}

export interface InstanceActionBarControllerInput {
    target: LocationObjectRecord | null;
    instance: unknown;
    friendCount?: number;
    playerCount?: number | string | null;
    providedCapacity?: number | string | null;
    showLaunch: boolean;
    onRefresh?: (
        location: string
    ) => InstanceRefreshResult | Promise<InstanceRefreshResult>;
}

export function useInstanceActionBarController({
    target,
    instance,
    friendCount,
    playerCount,
    providedCapacity,
    showLaunch,
    onRefresh
}: InstanceActionBarControllerInput) {
    const { t } = useTranslation();
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning === true
    );
    const confirm = useModalStore((state) => state.confirm);
    const showLaunchDialog = useLaunchStore((state) => state.showLaunchDialog);
    const [busy, setBusy] = useState('');
    const [instanceInfo, setInstanceInfo] = useState(() =>
        resolveInstanceSource(instance)
    );
    const actionTarget = useMemo(
        () => buildInstanceActionTarget(target),
        [target]
    );
    const joinHistoryKey = useMemo(
        () => instanceLocationKey(actionTarget.instanceLocation),
        [actionTarget.instanceLocation]
    );
    const joinedAtMs = useInstanceJoinHistoryStore(
        (state) =>
            (joinHistoryKey ? state.joinedAtByLocation[joinHistoryKey] : 0) || 0
    );
    const userCount = instanceUserCount(instanceInfo);
    const providedPlayerCount = firstNonNegativeLocationNumber(playerCount);
    const resolvedUserCount = userCount ?? providedPlayerCount;
    const capacity =
        instanceCapacity(instanceInfo) ??
        finiteLocationNumber(providedCapacity) ??
        0;
    const hasUserCount = userCount !== null || providedPlayerCount !== null;
    const canCloseCurrentInstance = canCloseInstance(
        instanceInfo,
        currentUserId
    );
    const activeContextRef = useRef({
        endpoint,
        location: actionTarget.instanceLocation
    });
    const hasInstanceSummary = Boolean(
        instanceInfo || hasUserCount || capacity || friendCount || joinedAtMs
    );
    const queueSize = Number(instanceInfo?.queueSize) || 0;
    const hasAgeGate = Boolean(
        instanceInfo?.ageGate ||
        actionTarget.instanceLocation.includes('~ageGate')
    );
    const canShowLaunchAction = showLaunch && actionTarget.isRealLaunchLocation;
    const canOpenInstanceInGame = canShowLaunchAction && isGameRunning;

    useEffect(() => {
        activeContextRef.current = {
            endpoint,
            location: actionTarget.instanceLocation
        };
        setInstanceInfo(resolveInstanceSource(instance));
    }, [endpoint, instance, actionTarget.instanceLocation]);

    function launchInstance() {
        if (!actionTarget.launchLocation || busy) {
            return;
        }
        showLaunchDialog(
            actionTarget.launchLocation,
            actionTarget.parsedLaunchLocation.shortName || '',
            actionTarget.shortName,
            { worldName: actionTarget.worldName }
        );
    }

    async function openInstanceInGame() {
        if (!canOpenInstanceInGame || busy) {
            return;
        }
        setBusy('open-in-game');
        try {
            const opened = await tryOpenLaunchLocation(
                actionTarget.launchLocation,
                actionTarget.parsedLaunchLocation.shortName ||
                    actionTarget.shortName
            );
            if (opened) {
                toast.add({
                    type: 'success',
                    title: t(
                        'dialog.instance.success.vrchat_launch_request_sent'
                    )
                });
                return;
            }
            toast.add({
                type: 'error',
                title: t(
                    'dialog.instance.error.unable_to_open_this_instance_in_vrchat'
                )
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.instance_action_bar.toast.failed_to_launch_instance'
                          )
            });
        } finally {
            setBusy('');
        }
    }

    async function selfInvite() {
        if (!actionTarget.isRealInviteLocation || busy) {
            return;
        }
        setBusy('invite');
        try {
            await selfInviteToInstance(
                actionTarget.inviteLocation,
                actionTarget.parsedInviteLocation.shortName ||
                    actionTarget.shortName
            );
            toast.add({
                type: 'success',
                title: t('message.invite.self_sent')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.instance_action_bar.toast.failed_to_send_self_invite'
                          )
            });
        } finally {
            setBusy('');
        }
    }

    async function refreshInstance() {
        if (!actionTarget.isRealInstanceLocation || busy) {
            return;
        }
        const requestLocation = actionTarget.instanceLocation;
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
                const normalizedOverride = resolveInstanceSource(override);
                setInstanceInfo(normalizedOverride);
                recordLocationHintsFromInstances({
                    endpoint: requestEndpoint,
                    instances: [normalizedOverride]
                });
            } else {
                const response = await vrchatInstanceRepository.getInstance({
                    worldId: actionTarget.parsedInstanceLocation.worldId,
                    instanceId: actionTarget.parsedInstanceLocation.instanceId,
                    force: true
                });
                if (
                    activeContextRef.current.location !== requestLocation ||
                    activeContextRef.current.endpoint !== requestEndpoint
                ) {
                    return;
                }
                setInstanceInfo(resolveInstanceSource(response.json));
                recordLocationHintsFromInstances({
                    endpoint: requestEndpoint,
                    instances: [response.json]
                });
            }
            toast.add({
                type: 'success',
                title: t('dialog.instance.success.instance_refreshed')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.instance_action_bar.toast.failed_to_refresh_instance'
                          )
            });
        } finally {
            setBusy('');
        }
    }

    async function closeInstance() {
        if (!actionTarget.instanceLocation || busy) {
            return;
        }
        const requestLocation = actionTarget.instanceLocation;
        const requestEndpoint = endpoint;
        const result = await confirm({
            title: t('confirm.title'),
            description: t('confirm.close_instance'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setBusy('close');
        try {
            const response = await vrchatInstanceRepository.closeInstance({
                location: requestLocation,
                hardClose: false
            });
            if (
                activeContextRef.current.location !== requestLocation ||
                activeContextRef.current.endpoint !== requestEndpoint
            ) {
                return;
            }
            if (response.json) {
                setInstanceInfo(resolveInstanceSource(response.json));
                recordLocationHintsFromInstances({
                    endpoint: requestEndpoint,
                    instances: [response.json]
                });
            }
            toast.add({
                type: 'success',
                title: t('dialog.instance.label.instance_closed')
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.instance_action_bar.toast.failed_to_close_instance'
                          )
            });
        } finally {
            setBusy('');
        }
    }

    return {
        actionTarget,
        busy,
        canCloseCurrentInstance,
        canOpenInstanceInGame,
        canShowLaunchAction,
        capacity,
        closeInstance,
        hasAgeGate,
        hasInstanceSummary,
        hasUserCount,
        instanceInfo,
        joinedAtMs,
        launchInstance,
        openInstanceInGame,
        queueSize,
        refreshInstance,
        resolvedUserCount,
        selfInvite
    };
}
