import { useEffect, useMemo, useState } from 'react';

import vrchatMediaRepository, {
    type InventoryItemRecord
} from '@/repositories/vrchatMediaRepository';

import {
    PROFILE_DECORATION_SLOTS,
    type ProfileDecorationSlot,
    type UserDialogProfileAppearance,
    type UserDialogProfileAppearanceVisibility
} from './userDialogProfileAppearance';
import type { UserDialogProfileRecord } from './userDialogProfileTypes';

const EMPTY_APPEARANCE: UserDialogProfileAppearance = Object.freeze({});
const EMPTY_TEMPLATE_ITEMS: ReadonlyMap<string, InventoryItemRecord | null> =
    new Map();

type ProfileDecorationVisibility = Pick<
    UserDialogProfileAppearanceVisibility,
    'avatarFrame' | 'profileEffect' | 'nameplateEffect'
>;

export function useUserDialogProfileAppearance({
    profile,
    visibility
}: {
    profile: UserDialogProfileRecord | null | undefined;
    visibility: ProfileDecorationVisibility;
}): UserDialogProfileAppearance {
    const userId = profile?.id?.trim() ?? '';
    const iconFrameId =
        visibility.avatarFrame && typeof profile?.iconFrame === 'string'
            ? profile.iconFrame.trim()
            : '';
    const profileEffectId =
        visibility.profileEffect && typeof profile?.profileEffect === 'string'
            ? profile.profileEffect.trim()
            : '';
    const nameplateEffectId =
        visibility.nameplateEffect &&
        typeof profile?.nameplateEffect === 'string'
            ? profile.nameplateEffect.trim()
            : '';
    const [resource, setResource] = useState<{
        itemsByTemplateId: ReadonlyMap<string, InventoryItemRecord | null>;
        userId: string;
    }>({
        itemsByTemplateId: EMPTY_TEMPLATE_ITEMS,
        userId: ''
    });

    const templateIdsBySlot = useMemo(
        () => ({
            iconFrame: iconFrameId,
            profileEffect: profileEffectId,
            nameplateEffect: nameplateEffectId
        }),
        [iconFrameId, nameplateEffectId, profileEffectId]
    );

    useEffect(() => {
        const itemsByTemplateId =
            resource.userId === userId
                ? resource.itemsByTemplateId
                : EMPTY_TEMPLATE_ITEMS;
        const pendingTemplates = new Map<string, ProfileDecorationSlot>();
        for (const slot of PROFILE_DECORATION_SLOTS) {
            const templateId = templateIdsBySlot[slot];
            if (
                templateId &&
                !itemsByTemplateId.has(templateId) &&
                !pendingTemplates.has(templateId)
            ) {
                pendingTemplates.set(templateId, slot);
            }
        }
        if (!userId || pendingTemplates.size === 0) {
            return;
        }

        let active = true;
        Promise.all(
            [...pendingTemplates].map(async ([inventoryTemplateId, slot]) => {
                try {
                    return {
                        inventoryTemplateId,
                        item: await vrchatMediaRepository.getProfileDecorationTemplate(
                            slot,
                            inventoryTemplateId
                        )
                    };
                } catch {
                    return {
                        inventoryTemplateId,
                        item: null
                    };
                }
            })
        ).then((results) => {
            if (!active) {
                return;
            }
            setResource((currentResource) => {
                const nextItemsByTemplateId = new Map(
                    currentResource.userId === userId
                        ? currentResource.itemsByTemplateId
                        : EMPTY_TEMPLATE_ITEMS
                );
                let changed = currentResource.userId !== userId;
                for (const { inventoryTemplateId, item } of results) {
                    if (!nextItemsByTemplateId.has(inventoryTemplateId)) {
                        nextItemsByTemplateId.set(inventoryTemplateId, item);
                        changed = true;
                    }
                }
                if (!changed) {
                    return currentResource;
                }
                return {
                    itemsByTemplateId: nextItemsByTemplateId,
                    userId
                };
            });
        });

        return () => {
            active = false;
        };
    }, [resource, templateIdsBySlot, userId]);

    return useMemo(() => {
        if (resource.userId !== userId) {
            return EMPTY_APPEARANCE;
        }
        const value: UserDialogProfileAppearance = {};
        for (const slot of PROFILE_DECORATION_SLOTS) {
            const item = resource.itemsByTemplateId.get(
                templateIdsBySlot[slot]
            );
            if (item) {
                value[slot] = item;
            }
        }
        return value;
    }, [resource, templateIdsBySlot, userId]);
}
