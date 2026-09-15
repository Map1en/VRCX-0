import {
    useEffect,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';

import type { WorldProfileRecord } from '@/domain/entities/world';
import configRepository from '@/repositories/configRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { copyTextToClipboard } from '@/services/clipboardService';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import { selfInviteToInstance } from '@/services/launchService';
import { toast } from '@/services/toastService';
import { parseLocation } from '@/shared/utils/location';
import { normalizeString } from '@/shared/utils/string';
import type { WorldNewInstanceDefaults } from '@/state/dialogStore';
import type { LaunchStoreState } from '@/state/launchStore';

import {
    findGroupOption,
    normalizeGroupAccessType,
    normalizeInstanceAccessType,
    normalizeInstanceRegion,
    normalizeMinimumAvatarPerformance,
    normalizeNewInstanceSeed
} from './worldDialogHelpers';
import {
    INSTANCE_DIALOG_DISPLAY_NAME_KEY,
    INSTANCE_DIALOG_DISPLAY_NAME_PRESETS_KEY,
    normalizeInstanceDialogDisplayName,
    normalizeInstanceDialogDisplayNamePresets,
    prependInstanceDialogDisplayNamePreset
} from './worldInstanceDisplayNamePresets';
import { resolveCreatedInstanceDetails } from './worldInstanceResolver';
import { parseRoleIds, resolveInstanceLocation } from './worldInstances';
import type {
    CreatedWorldInstance,
    InstanceGroupOption,
    NewInstanceAfterCreateAction,
    WorldInstanceInviteRequest,
    WorldNewInstanceForm,
    WorldNewInstanceRequest
} from './worldNewInstanceTypes';

export type { NewInstanceAfterCreateAction } from './worldNewInstanceTypes';

export function resolveNewInstanceAfterCreateAction(
    requestedFollowUp: boolean,
    isGameRunning: boolean
): NewInstanceAfterCreateAction {
    if (!requestedFollowUp) {
        return '';
    }
    return isGameRunning ? 'openInGame' : 'selfInvite';
}

interface UseWorldInstanceActionsInput {
    world: WorldProfileRecord | null;
    currentEndpoint: string;
    currentUserId: string | null;
    isGameRunning: boolean;
    profileWorldId: string;
    newInstanceGroups: InstanceGroupOption[];
    loadNewInstanceGroups: () => Promise<InstanceGroupOption[]>;
    actionStatusRef: MutableRefObject<string>;
    setActionStatus: Dispatch<SetStateAction<string>>;
    isCurrentWorldTarget: (worldId: string, endpoint: string) => boolean;
    showLaunchDialog: LaunchStoreState['showLaunchDialog'];
}

export function useWorldInstanceActions({
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
}: UseWorldInstanceActionsInput) {
    const { t } = useTranslation();
    const [newInstanceRequest, setNewInstanceRequest] =
        useState<WorldNewInstanceRequest | null>(null);
    const [inviteRequest, setInviteRequest] =
        useState<WorldInstanceInviteRequest | null>(null);

    useEffect(() => {
        setNewInstanceRequest(null);
    }, [profileWorldId]);

    async function loadNewInstanceDefaults(
        seed: WorldNewInstanceDefaults | null = null
    ) {
        const [
            accessType,
            region,
            groupId,
            groupAccessType,
            minimumAvatarPerformance,
            ageGate,
            queueEnabled,
            displayName,
            displayNamePresets,
            instanceName,
            legacyUserId,
            groupOptions
        ] = await Promise.all([
            configRepository.getString('instanceDialogAccessType', 'public'),
            configRepository.getString('instanceRegion', 'US West'),
            configRepository.getString('instanceDialogGroupId', ''),
            configRepository.getString('instanceDialogGroupAccessType', 'plus'),
            configRepository.getString(
                'instanceDialogMinimumAvatarPerformance',
                ''
            ),
            configRepository.getBool('instanceDialogAgeGate', false),
            configRepository.getBool('instanceDialogQueueEnabled', true),
            configRepository.getString(INSTANCE_DIALOG_DISPLAY_NAME_KEY, ''),
            configRepository.getArray(
                INSTANCE_DIALOG_DISPLAY_NAME_PRESETS_KEY,
                []
            ),
            configRepository.getString('instanceDialogInstanceName', ''),
            configRepository.getString('instanceDialogUserId', ''),
            loadNewInstanceGroups()
        ]);
        const seedDefaults = normalizeNewInstanceSeed(seed);
        const selectedGroupId =
            seedDefaults.groupId || normalizeString(groupId) || '';
        const selectedGroup = findGroupOption(groupOptions, selectedGroupId);
        return {
            accessType:
                seedDefaults.accessType ||
                normalizeInstanceAccessType(accessType) ||
                (selectedGroupId ? 'group' : 'public'),
            region:
                seedDefaults.region ||
                normalizeInstanceRegion(region) ||
                'US West',
            groupId: selectedGroupId,
            groupName: selectedGroup?.name || seedDefaults.groupName || '',
            groupAccessType:
                seedDefaults.groupAccessType ||
                normalizeGroupAccessType(groupAccessType) ||
                'plus',
            minimumAvatarPerformance: normalizeMinimumAvatarPerformance(
                minimumAvatarPerformance
            ),
            queueEnabled,
            ageGate,
            displayName,
            displayNamePresets: normalizeInstanceDialogDisplayNamePresets(
                displayNamePresets,
                displayName
            ),
            roleIds: '',
            instanceName,
            legacyUserId: legacyUserId || currentUserId || ''
        };
    }

    async function openNewInstanceDialog(
        requestedFollowUp: boolean = false,
        seed: WorldNewInstanceDefaults | null = null
    ) {
        if (!world?.id || actionStatusRef.current !== 'idle') {
            return;
        }
        try {
            const defaults = await loadNewInstanceDefaults(seed);
            const afterCreateAction = resolveNewInstanceAfterCreateAction(
                requestedFollowUp,
                isGameRunning
            );
            setNewInstanceRequest({
                selfInvite: afterCreateAction === 'selfInvite',
                afterCreateAction,
                defaults
            });
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.world.toast.failed_to_load_new_instance_settings'
                          )
            });
        }
    }

    function saveNewInstanceDraft(form: WorldNewInstanceForm) {
        Promise.all([
            configRepository.setString(
                'instanceDialogAccessType',
                form.accessType || 'public'
            ),
            configRepository.setString(
                'instanceRegion',
                form.region || 'US West'
            ),
            configRepository.setString(
                'instanceDialogInstanceName',
                form.instanceName || ''
            ),
            configRepository.setString(
                'instanceDialogUserId',
                form.legacyUserId === currentUserId
                    ? ''
                    : form.legacyUserId || ''
            ),
            configRepository.setString(
                'instanceDialogGroupId',
                form.groupId || ''
            ),
            configRepository.setString(
                'instanceDialogGroupAccessType',
                form.groupAccessType || 'plus'
            ),
            configRepository.setString(
                'instanceDialogMinimumAvatarPerformance',
                form.minimumAvatarPerformance
            ),
            configRepository.setBool(
                'instanceDialogQueueEnabled',
                Boolean(form.queueEnabled)
            ),
            configRepository.setBool(
                'instanceDialogAgeGate',
                Boolean(form.ageGate)
            ),
            configRepository.setString(
                INSTANCE_DIALOG_DISPLAY_NAME_KEY,
                form.displayName || ''
            )
        ]).catch(() => {});
    }

    function saveNewInstanceDisplayNamePreset(value: string) {
        const normalized = normalizeInstanceDialogDisplayName(value);
        if (!normalized) {
            return;
        }

        configRepository
            .getArray(INSTANCE_DIALOG_DISPLAY_NAME_PRESETS_KEY, [])
            .then((current) => {
                const next = prependInstanceDialogDisplayNamePreset(
                    current,
                    normalized
                );
                return Promise.all([
                    configRepository.setString(
                        INSTANCE_DIALOG_DISPLAY_NAME_KEY,
                        normalized
                    ),
                    configRepository.setArray(
                        INSTANCE_DIALOG_DISPLAY_NAME_PRESETS_KEY,
                        next
                    )
                ]);
            })
            .catch(() => {});
    }

    async function createWorldInstance(form: WorldNewInstanceForm) {
        if (
            !newInstanceRequest ||
            !world?.id ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }
        const shouldSelfInvite =
            newInstanceRequest.afterCreateAction === 'selfInvite';
        const shouldOpenInGame =
            newInstanceRequest.afterCreateAction === 'openInGame';
        const targetWorldId = world.id;
        const targetEndpoint = currentEndpoint;
        if (form.accessType === 'group' && !normalizeString(form.groupId)) {
            toast.add({
                type: 'error',
                title: t(
                    'dialog.world.error.group_id_is_required_for_group_instances'
                )
            });
            return;
        }

        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            await Promise.all([
                configRepository.setString(
                    'instanceDialogAccessType',
                    form.accessType || 'public'
                ),
                configRepository.setString(
                    'instanceRegion',
                    form.region || 'US West'
                ),
                configRepository.setString(
                    'instanceDialogGroupId',
                    form.groupId || ''
                ),
                configRepository.setString(
                    'instanceDialogGroupAccessType',
                    form.groupAccessType || 'plus'
                ),
                configRepository.setString(
                    'instanceDialogMinimumAvatarPerformance',
                    form.minimumAvatarPerformance
                ),
                configRepository.setBool(
                    'instanceDialogAgeGate',
                    Boolean(form.ageGate)
                ),
                configRepository.setBool(
                    'instanceDialogQueueEnabled',
                    Boolean(form.queueEnabled)
                ),
                configRepository.setString(
                    INSTANCE_DIALOG_DISPLAY_NAME_KEY,
                    form.displayName || ''
                )
            ]);
            const selectedGroup = findGroupOption(
                newInstanceGroups,
                form.groupId
            );
            const response = await vrchatInstanceRepository.createInstance({
                worldId: targetWorldId,
                ownerId: currentUserId || '',
                accessType: form.accessType || 'public',
                region: form.region || 'US West',
                groupId: form.groupId || '',
                groupAccessType: form.groupAccessType || 'plus',
                minimumAvatarPerformance: form.minimumAvatarPerformance,
                queueEnabled: Boolean(form.queueEnabled),
                ageGate: Boolean(form.ageGate),
                roleIds: parseRoleIds(form.roleIds),
                displayName: normalizeString(form.displayName)
            });
            const location = resolveInstanceLocation(
                targetWorldId,
                response.json
            );
            if (!location) {
                throw new Error(
                    t(
                        'dialog.world.label.the_instance_was_created_but_vrchat_did_not_return_a_launch_location'
                    )
                );
            }
            const created = await resolveCreatedInstanceDetails(
                location,
                response.json,
                {
                    accessType: form.accessType || 'public',
                    ownerId:
                        form.accessType === 'group'
                            ? normalizeString(form.groupId)
                            : currentUserId,
                    groupId:
                        form.accessType === 'group'
                            ? normalizeString(form.groupId)
                            : '',
                    group: selectedGroup
                }
            );
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                toast.add({
                    type: 'success',
                    title: t('dialog.world.success.instance_created')
                });
                return;
            }
            setNewInstanceRequest(null);

            if (shouldSelfInvite) {
                const parsedLocation = parseLocation(location);
                if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                    toast.add({
                        type: 'error',
                        title: t(
                            'dialog.world.label.instance_created_but_the_new_instance_location_is_not_inviteable'
                        )
                    });
                    launchCreatedInstance(created);
                } else {
                    try {
                        await selfInviteToInstance(
                            location,
                            created.shortName || created.secureOrShortName || ''
                        );
                        toast.add({
                            type: 'success',
                            title: t(
                                'dialog.world.success.instance_created_and_self_invite_sent'
                            )
                        });
                    } catch (error) {
                        toast.add({
                            type: 'error',
                            title:
                                error instanceof Error
                                    ? t(
                                          'dialog.world.toast.instance_created_but_self_invite_failed_value',
                                          { value: error.message }
                                      )
                                    : t(
                                          'dialog.world.toast.instance_created_but_self_invite_failed'
                                      )
                        });
                        launchCreatedInstance(created);
                    }
                }
            } else if (shouldOpenInGame) {
                try {
                    await openCreatedInstanceInGameRequest(created);
                } catch (error) {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : t(
                                      'dialog.world.toast.failed_to_open_instance_in_vrchat'
                                  )
                    });
                    launchCreatedInstance(created);
                }
            } else {
                toast.add({
                    type: 'success',
                    title: t('dialog.world.success.instance_created')
                });
                launchCreatedInstance(created);
            }
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t('message.instance.create_failed')
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function openCreatedInstanceInGameRequest(
        created: CreatedWorldInstance
    ) {
        const opened = await tryOpenLaunchLocation(
            created.location,
            created.shortName || created.secureOrShortName || ''
        );
        if (!opened) {
            await selfInviteToInstance(
                created.location,
                created.shortName || created.secureOrShortName || ''
            );
            toast.add({
                type: 'warning',
                title: t(
                    'dialog.world.error.failed_open_instance_in_vrchat_falling_back_to_self_invite'
                )
            });
            toast.add({
                type: 'success',
                title: t('message.invite.self_sent')
            });
            return;
        }
        toast.add({
            type: 'success',
            title: t('dialog.world.success.vrchat_launch_request_sent')
        });
    }

    async function copyCreatedInstance(created: CreatedWorldInstance) {
        if (!created?.url) {
            return;
        }
        await copyTextToClipboard(created.url, {
            successMessage: t('dialog.world.success.instance_url_copied')
        });
    }

    async function selfInviteCreatedInstance(created: CreatedWorldInstance) {
        const parsedLocation = parseLocation(created?.location || '');
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.add({
                type: 'error',
                title: t(
                    'dialog.world.error.cannot_self_invite_location_is_not_a_concrete_instance'
                )
            });
            return;
        }
        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            await selfInviteToInstance(
                created.location,
                created.shortName || created.secureOrShortName || ''
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
                        : t('dialog.world.toast.failed_to_send_self_invite')
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function inviteCreatedInstance(created: CreatedWorldInstance) {
        if (!created?.location) {
            return;
        }
        setInviteRequest({
            location: created.location,
            launchToken: created.shortName || created.secureOrShortName || '',
            worldName: world?.name || created.location
        });
    }

    function launchCreatedInstance(created: CreatedWorldInstance) {
        if (!created?.location) {
            return;
        }
        showLaunchDialog(
            created.location,
            created.shortName || '',
            created.secureOrShortName || '',
            {
                createdInstance: created,
                worldName: world?.name || ''
            }
        );
    }

    async function openCreatedInstanceInGame(created: CreatedWorldInstance) {
        if (!created?.location) {
            return;
        }
        const parsedLocation = parseLocation(created.location);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.add({
                type: 'error',
                title: t(
                    'dialog.world.error.cannot_open_in_vrchat_location_is_not_a_concrete_instance'
                )
            });
            return;
        }
        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            await openCreatedInstanceInGameRequest(created);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'dialog.world.toast.failed_to_open_instance_in_vrchat'
                          )
            });
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    return {
        newInstanceRequest,
        setNewInstanceRequest,
        inviteRequest,
        setInviteRequest,
        openNewInstanceDialog,
        saveNewInstanceDraft,
        saveNewInstanceDisplayNamePreset,
        createWorldInstance,
        copyCreatedInstance,
        selfInviteCreatedInstance,
        inviteCreatedInstance,
        launchCreatedInstance,
        openCreatedInstanceInGame
    };
}
