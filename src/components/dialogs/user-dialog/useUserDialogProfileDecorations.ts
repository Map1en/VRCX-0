import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveProfileDecorationMutation } from '@/domain/entities/inventory';
import type { CurrentUserProfileUpdateRequest } from '@/platform/tauri/bindings';
import mediaRepository, {
    type InventoryItemRecord
} from '@/repositories/mediaRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import { refreshCurrentUser } from '@/services/backgroundMaintenanceSessionService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';

import {
    PROFILE_DECORATION_SLOTS,
    type ProfileDecorationSlot,
    type UserDialogProfileAppearanceOverride,
    type UserDialogProfileAppearanceOverrides
} from './userDialogProfileAppearance';

type ItemsBySlot = Record<ProfileDecorationSlot, InventoryItemRecord[]>;

type ProfileDecorationsAuthTarget = {
    endpoint: string;
    userId: string;
    websocket: string;
};

type ProfileDecorationMutation =
    | {
          action: 'equip';
          equipSlot: ProfileDecorationSlot;
          inventoryId: string;
          item: InventoryItemRecord;
      }
    | {
          action: 'unequip';
          equipSlot: ProfileDecorationSlot;
          inventoryId: string;
      }
    | { action: 'background'; params: CurrentUserProfileUpdateRequest };

export const UNEQUIP_PENDING_KEY = 'unequip';

const EMPTY_ITEMS_BY_SLOT: ItemsBySlot = {
    iconFrame: [],
    profileEffect: [],
    nameplateEffect: []
};

function emptyItemsBySlot(): ItemsBySlot {
    return {
        iconFrame: [],
        profileEffect: [],
        nameplateEffect: []
    };
}

function authTargetKey(target: ProfileDecorationsAuthTarget) {
    return [target.endpoint, target.userId, target.websocket].join(' ');
}

function isProfileDecorationSlot(
    value: unknown
): value is ProfileDecorationSlot {
    return PROFILE_DECORATION_SLOTS.some((slot) => slot === value);
}

function applyDecorationOverrideToItems(
    itemsBySlot: ItemsBySlot,
    slot: ProfileDecorationSlot,
    override: UserDialogProfileAppearanceOverride
): ItemsBySlot {
    const selectedInventoryId =
        override.action === 'equip' ? override.item.id : '';
    const items = itemsBySlot[slot].map((item) => {
        let equipSlot = item.equipSlot;
        if (item.id === selectedInventoryId) {
            equipSlot = slot;
        } else if (equipSlot === slot) {
            equipSlot = '';
        }
        return { ...item, equipSlot };
    });
    if (
        override.action === 'equip' &&
        !items.some((item) => item.id === selectedInventoryId)
    ) {
        items.push({ ...override.item, equipSlot: slot });
    }
    return { ...itemsBySlot, [slot]: items };
}

export function useUserDialogProfileDecorations({
    enabled,
    onProfileUpdated
}: {
    enabled: boolean;
    onProfileUpdated?: () => void;
}) {
    const { t } = useTranslation();
    const tRef = useRef(t);
    tRef.current = t;
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserWebsocket = useRuntimeStore(
        (state) => state.auth.currentUserWebsocket
    );
    const onProfileUpdatedRef = useRef(onProfileUpdated);
    onProfileUpdatedRef.current = onProfileUpdated;

    const authTargetRef = useRef<ProfileDecorationsAuthTarget>({
        endpoint: '',
        userId: '',
        websocket: ''
    });
    authTargetRef.current = {
        endpoint: currentEndpoint || '',
        userId: currentUserId || '',
        websocket: currentUserWebsocket || ''
    };
    const currentKey = authTargetKey(authTargetRef.current);

    const [itemsBySlot, setItemsBySlot] =
        useState<ItemsBySlot>(emptyItemsBySlot);
    const [loadedKey, setLoadedKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [pendingKey, setPendingKey] = useState('');
    const pendingRef = useRef(false);
    const [appearanceOverrideState, setAppearanceOverrideState] = useState<{
        key: string;
        value: UserDialogProfileAppearanceOverrides;
    }>({ key: '', value: {} });
    const appearanceOverrideStateRef = useRef(appearanceOverrideState);
    appearanceOverrideStateRef.current = appearanceOverrideState;

    const setAppearanceOverrides = useCallback(
        (key: string, value: UserDialogProfileAppearanceOverrides) => {
            const nextState = { key, value };
            appearanceOverrideStateRef.current = nextState;
            setAppearanceOverrideState(nextState);
        },
        []
    );

    const refresh = useCallback(async () => {
        const target = authTargetRef.current;
        const targetKey = authTargetKey(target);
        if (!target.userId) {
            return;
        }
        setLoading(true);
        try {
            const { items: rows, truncated } =
                await mediaRepository.collectInventoryItems({
                    types: [...PROFILE_DECORATION_SLOTS],
                    notFlags: ['ugc'],
                    archived: false
                });
            if (truncated) {
                console.warn(
                    'Profile decoration listing truncated at the page limit.'
                );
            }
            if (authTargetKey(authTargetRef.current) !== targetKey) {
                return;
            }
            const next = emptyItemsBySlot();
            for (const row of rows) {
                if (isProfileDecorationSlot(row.itemType)) {
                    next[row.itemType].push(row);
                }
            }
            setItemsBySlot(next);
            setLoadedKey(targetKey);
        } catch (error) {
            if (authTargetKey(authTargetRef.current) === targetKey) {
                toast.add({
                    type: 'error',
                    title:
                        error instanceof Error
                            ? error.message
                            : tRef.current('dialog.inventory.failed_to_load')
                });
            }
        } finally {
            if (authTargetKey(authTargetRef.current) === targetKey) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (!enabled || !currentKey) {
            return;
        }
        refresh();
    }, [currentKey, enabled, refresh]);

    useEffect(() => {
        if (appearanceOverrideStateRef.current.key !== currentKey) {
            setAppearanceOverrides(currentKey, {});
        }
    }, [currentKey, setAppearanceOverrides]);

    async function runMutation(
        key: string,
        mutation: ProfileDecorationMutation
    ) {
        const target = authTargetRef.current;
        if (!target.userId || pendingRef.current) {
            return;
        }
        const targetKey = authTargetKey(target);
        pendingRef.current = true;
        setPendingKey(key);
        let optimisticOverride: UserDialogProfileAppearanceOverride | null =
            null;
        let previousOverride: UserDialogProfileAppearanceOverride | undefined;
        if (mutation.action !== 'background') {
            optimisticOverride =
                mutation.action === 'equip'
                    ? {
                          action: 'equip',
                          item: mutation.item,
                          templateId: mutation.item.templateId?.trim() ?? ''
                      }
                    : { action: 'unequip' };
            const currentOverrides =
                appearanceOverrideStateRef.current.key === targetKey
                    ? appearanceOverrideStateRef.current.value
                    : {};
            previousOverride = currentOverrides[mutation.equipSlot];
            setAppearanceOverrides(targetKey, {
                ...currentOverrides,
                [mutation.equipSlot]: optimisticOverride
            });
        }
        try {
            if (mutation.action === 'background') {
                await userProfileRepository.updateCurrentUserProfile({
                    expectedUserId: target.userId,
                    params: mutation.params
                });
                toast.add({
                    type: 'success',
                    title: t('dialog.inventory.profile_background_updated')
                });
                onProfileUpdatedRef.current?.();
                await refreshCurrentUser({
                    expectedUserId: target.userId,
                    expectedEndpoint: target.endpoint,
                    expectedWebsocket: target.websocket
                }).catch(() => undefined);
                return;
            }

            const isUnequip = mutation.action === 'unequip';
            if (isUnequip) {
                await mediaRepository.unequipProfileDecoration({
                    expectedUserId: target.userId,
                    equipSlot: mutation.equipSlot
                });
            } else {
                await mediaRepository.equipProfileDecoration({
                    expectedUserId: target.userId,
                    inventoryId: mutation.inventoryId,
                    equipSlot: mutation.equipSlot
                });
            }
            toast.add({
                type: 'success',
                title: t(
                    isUnequip
                        ? 'dialog.inventory.unequipped_success'
                        : 'dialog.inventory.equipped_success'
                )
            });
            await refreshCurrentUser({
                expectedUserId: target.userId,
                expectedEndpoint: target.endpoint,
                expectedWebsocket: target.websocket
            }).catch(() => undefined);
            if (authTargetKey(authTargetRef.current) === targetKey) {
                onProfileUpdatedRef.current?.();
            }
        } catch (error) {
            if (
                mutation.action !== 'background' &&
                optimisticOverride &&
                appearanceOverrideStateRef.current.key === targetKey &&
                appearanceOverrideStateRef.current.value[mutation.equipSlot] ===
                    optimisticOverride
            ) {
                const nextOverrides = {
                    ...appearanceOverrideStateRef.current.value
                };
                if (previousOverride) {
                    nextOverrides[mutation.equipSlot] = previousOverride;
                } else {
                    delete nextOverrides[mutation.equipSlot];
                }
                setAppearanceOverrides(targetKey, nextOverrides);
            }
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              mutation.action === 'background'
                                  ? 'dialog.inventory.failed_to_update_profile_background'
                                  : 'dialog.inventory.failed_to_update_profile_decoration'
                          )
            });
        } finally {
            pendingRef.current = false;
            setPendingKey('');
        }
    }

    function equipItem(item: InventoryItemRecord) {
        const mutation = resolveProfileDecorationMutation(
            item,
            authTargetRef.current.userId
        );
        if (!mutation || mutation.action !== 'equip') {
            return;
        }
        runMutation(item.id, { ...mutation, item });
    }

    function unequipSlot(slot: ProfileDecorationSlot) {
        runMutation(UNEQUIP_PENDING_KEY, {
            action: 'unequip',
            equipSlot: slot,
            inventoryId: ''
        });
    }

    function updateBackground(
        key: string,
        params: CurrentUserProfileUpdateRequest
    ) {
        runMutation(key, { action: 'background', params });
    }

    const isReady = loadedKey === currentKey;
    const appearanceOverrides =
        appearanceOverrideState.key === currentKey
            ? appearanceOverrideState.value
            : {};
    let displayedItemsBySlot = itemsBySlot;
    for (const slot of PROFILE_DECORATION_SLOTS) {
        const override = appearanceOverrides[slot];
        if (override) {
            displayedItemsBySlot = applyDecorationOverrideToItems(
                displayedItemsBySlot,
                slot,
                override
            );
        }
    }

    return {
        itemsBySlot:
            enabled && isReady ? displayedItemsBySlot : EMPTY_ITEMS_BY_SLOT,
        appearanceOverrides,
        loading,
        pendingKey,
        isReady,
        equipItem,
        unequipSlot,
        updateBackground
    };
}

export type UserDialogProfileDecorationsController = ReturnType<
    typeof useUserDialogProfileDecorations
>;
