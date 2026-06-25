import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import configRepository from '@/repositories/configRepository';
import vrchatInstanceRepository from '@/repositories/vrchatInstanceRepository';
import { tryOpenLaunchLocation } from '@/services/directAccessService';
import { copyTextToClipboard } from '@/services/entityMediaService';
import { selfInviteToInstance } from '@/services/launchService';
import { parseLocation } from '@/shared/utils/locationParser';

import {
    findGroupOption,
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
import {
    normalizeEntityId,
    parseRoleIds,
    resolveInstanceLocation
} from './worldInstances';

export type NewInstanceAfterCreateAction = '' | 'selfInvite' | 'openInGame';

export function resolveNewInstanceAfterCreateAction(
    requestedFollowUp: any,
    isGameRunning: any
): NewInstanceAfterCreateAction {
    if (!requestedFollowUp) {
        return '';
    }
    return isGameRunning ? 'openInGame' : 'selfInvite';
}

export function isNewInstanceSelfInviteRequest(request: any): boolean {
    return request?.afterCreateAction === 'selfInvite';
}

export function isNewInstanceOpenInGameRequest(request: any): boolean {
    return request?.afterCreateAction === 'openInGame';
}

export function useWorldInstanceActions({
    world,
    currentEndpoint,
    currentUserId,
    isGameRunning,
    profileWorldId,
    newInstanceGroups,
    actionStatusRef,
    setActionStatus,
    isCurrentWorldTarget,
    showLaunchDialog
}: any) {
    const { t } = useTranslation();
    const [newInstanceRequest, setNewInstanceRequest] = useState<any>(null);
    const [inviteRequest, setInviteRequest] = useState<any>(null);

    useEffect(() => {
        setNewInstanceRequest(null);
    }, [profileWorldId]);

    async function loadNewInstanceDefaults(seed: any = null) {
        const [
            accessType,
            region,
            groupId,
            groupAccessType,
            ageGate,
            queueEnabled,
            displayName,
            displayNamePresets,
            instanceName,
            legacyUserId
        ] = await Promise.all([
            configRepository.getString('instanceDialogAccessType', 'public'),
            configRepository.getString('instanceRegion', 'US West'),
            configRepository.getString('instanceDialogGroupId', ''),
            configRepository.getString('instanceDialogGroupAccessType', 'plus'),
            configRepository.getBool('instanceDialogAgeGate', false),
            configRepository.getBool('instanceDialogQueueEnabled', true),
            configRepository.getString(INSTANCE_DIALOG_DISPLAY_NAME_KEY, ''),
            configRepository.getArray(
                INSTANCE_DIALOG_DISPLAY_NAME_PRESETS_KEY,
                []
            ),
            configRepository.getString('instanceDialogInstanceName', ''),
            configRepository.getString('instanceDialogUserId', '')
        ]);
        const seedDefaults = normalizeNewInstanceSeed(seed);
        const selectedGroupId =
            seedDefaults.groupId || normalizeEntityId(groupId) || '';
        const selectedGroup = findGroupOption(
            newInstanceGroups,
            selectedGroupId
        );
        return {
            accessType:
                seedDefaults.accessType ||
                accessType ||
                (selectedGroupId ? 'group' : 'public'),
            region: seedDefaults.region || region || 'US West',
            groupId: selectedGroupId,
            groupName: selectedGroup?.name || seedDefaults.groupName || '',
            groupAccessType:
                seedDefaults.groupAccessType || groupAccessType || 'plus',
            queueEnabled: Boolean(queueEnabled),
            ageGate: Boolean(ageGate),
            displayName: displayName || '',
            displayNamePresets: normalizeInstanceDialogDisplayNamePresets(
                displayNamePresets,
                displayName
            ),
            roleIds: '',
            instanceName: instanceName || '',
            legacyUserId: legacyUserId || currentUserId || ''
        };
    }

    async function openNewInstanceDialog(
        requestedFollowUp: any = false,
        seed: any = null
    ) {
        if (!world.id || actionStatusRef.current !== 'idle') {
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
            toast.error(
                error instanceof Error
                    ? error.message
                    : t(
                          'dialog.world.toast.failed_to_load_new_instance_settings'
                      )
            );
        }
    }

    function saveNewInstanceDraft(form: any) {
        if (!form || typeof form !== 'object') {
            return;
        }
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

    function saveNewInstanceDisplayNamePreset(value: any) {
        const normalized = normalizeInstanceDialogDisplayName(value);
        if (!normalized) {
            return;
        }

        configRepository
            .getArray(INSTANCE_DIALOG_DISPLAY_NAME_PRESETS_KEY, [])
            .then((current: any) => {
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

    async function createWorldInstance(form: any) {
        if (
            !newInstanceRequest ||
            !world.id ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }
        const shouldSelfInvite =
            isNewInstanceSelfInviteRequest(newInstanceRequest);
        const shouldOpenInGame =
            isNewInstanceOpenInGameRequest(newInstanceRequest);
        const targetWorldId = world.id;
        const targetEndpoint = currentEndpoint;
        if (form.accessType === 'group' && !normalizeEntityId(form.groupId)) {
            toast.error(
                t('dialog.world.error.group_id_is_required_for_group_instances')
            );
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
                throw new Error(
                    t(
                        'dialog.world.label.the_instance_was_created_but_vrchat_did_not_return_a_launch_location'
                    )
                );
            }
            const created = await resolveCreatedInstanceDetails(
                location,
                response.json,
                currentEndpoint,
                {
                    accessType: form.accessType || 'public',
                    ownerId:
                        form.accessType === 'group'
                            ? normalizeEntityId(form.groupId)
                            : currentUserId,
                    groupId:
                        form.accessType === 'group'
                            ? normalizeEntityId(form.groupId)
                            : '',
                    group: selectedGroup
                }
            );
            if (!isCurrentWorldTarget(targetWorldId, targetEndpoint)) {
                toast.success(t('dialog.world.success.instance_created'));
                return;
            }
            setNewInstanceRequest((current: any) => ({
                ...(current || {}),
                selfInvite: isNewInstanceSelfInviteRequest(current),
                afterCreateAction: current?.afterCreateAction || '',
                defaults: form,
                created
            }));

            if (shouldSelfInvite) {
                const parsedLocation = parseLocation(location);
                if (!parsedLocation.worldId || !parsedLocation.instanceId) {
                    toast.error(
                        t(
                            'dialog.world.label.instance_created_but_the_new_instance_location_is_not_inviteable'
                        )
                    );
                } else {
                    try {
                        await selfInviteToInstance(
                            location,
                            created.shortName ||
                                created.secureOrShortName ||
                                '',
                            currentEndpoint
                        );
                        toast.success(
                            t(
                                'dialog.world.success.instance_created_and_self_invite_sent'
                            )
                        );
                    } catch (error) {
                        toast.error(
                            error instanceof Error
                                ? t(
                                      'dialog.world.toast.instance_created_but_self_invite_failed_value',
                                      { value: error.message }
                                  )
                                : t(
                                      'dialog.world.toast.instance_created_but_self_invite_failed'
                                  )
                        );
                    }
                }
            } else if (shouldOpenInGame) {
                await openCreatedInstanceInGameRequest(created);
            } else {
                toast.success(t('dialog.world.success.instance_created'));
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('message.instance.create_failed')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function openCreatedInstanceInGameRequest(created: any) {
        const opened = await tryOpenLaunchLocation(
            created.location,
            created.shortName || created.secureOrShortName || '',
            currentEndpoint
        );
        if (!opened) {
            await selfInviteToInstance(
                created.location,
                created.shortName || created.secureOrShortName || '',
                currentEndpoint
            );
            toast.warning(
                t(
                    'dialog.world.error.failed_open_instance_in_vrchat_falling_back_to_self_invite'
                )
            );
            toast.success(t('message.invite.self_sent'));
            return;
        }
        toast.success(t('dialog.world.success.vrchat_launch_request_sent'));
    }

    async function copyCreatedInstance(created: any) {
        if (!created?.url) {
            return;
        }
        await copyTextToClipboard(created.url);
        toast.success(t('dialog.world.success.instance_url_copied'));
    }

    async function selfInviteCreatedInstance(created: any) {
        const parsedLocation = parseLocation(created?.location || '');
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'dialog.world.error.cannot_self_invite_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            await selfInviteToInstance(
                created.location,
                created.shortName || created.secureOrShortName || '',
                currentEndpoint
            );
            toast.success(t('message.invite.self_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_send_self_invite')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function inviteCreatedInstance(created: any) {
        if (!created?.location) {
            return;
        }
        setInviteRequest({
            location: created.location,
            launchToken: created.shortName || created.secureOrShortName || '',
            worldName: world?.name || created.location
        });
    }

    function launchCreatedInstance(created: any) {
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

    async function openCreatedInstanceInGame(created: any) {
        if (!created?.location) {
            return;
        }
        const parsedLocation = parseLocation(created.location);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                t(
                    'dialog.world.error.cannot_open_in_vrchat_location_is_not_a_concrete_instance'
                )
            );
            return;
        }
        actionStatusRef.current = 'new-instance';
        setActionStatus('new-instance');
        try {
            await openCreatedInstanceInGameRequest(created);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.world.toast.failed_to_open_instance_in_vrchat')
            );
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
