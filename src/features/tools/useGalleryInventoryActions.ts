import { mergeCurrentUserPresenceFields } from '@/shared/utils/currentUserPresence';

function mergeCurrentUserMediaUpdate(nextUser: any, previousUser: any) {
    const mergedUser = mergeCurrentUserPresenceFields(nextUser, previousUser);
    if (
        Array.isArray(previousUser?.badges) &&
        previousUser.badges.length > 0 &&
        (!Array.isArray(nextUser?.badges) || nextUser.badges.length === 0)
    ) {
        return {
            ...mergedUser,
            badges: previousUser.badges
        };
    }
    return mergedUser;
}

export function useGalleryInventoryActions({
    buildProfilePicOverride,
    confirm,
    currentEndpoint,
    currentUserId,
    currentUserSnapshot,
    getAuthTarget,
    isRuntimeAuthTarget,
    isVrcPlusSupporter,
    mediaRepository,
    prompt,
    refreshInventory,
    setAssets,
    setMutatingKey,
    t,
    toast,
    useRuntimeStore,
    userProfileRepository
}: any) {
    async function deletePrint(printId: any) {
        const normalizedPrintId =
            typeof printId === 'string'
                ? printId.trim()
                : String(printId ?? '').trim();
        if (!normalizedPrintId) {
            return;
        }
        const authTarget = getAuthTarget();
        const result = await confirm({
            title: t('view.tools.modal.delete_print'),
            description: normalizedPrintId,
            confirmText: t('common.actions.delete'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey(`prints:${normalizedPrintId}`);
        try {
            await mediaRepository.deletePrint(normalizedPrintId, {
                endpoint: currentEndpoint
            });
            if (isRuntimeAuthTarget(authTarget)) {
                setAssets((current: any) => ({
                    ...current,
                    prints: current.prints.filter(
                        (print: any) => print.id !== normalizedPrintId
                    )
                }));
                toast.success(t('view.tools.success.print_deleted'));
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_delete_print')
                );
            }
        } finally {
            setMutatingKey((current: any) =>
                current === `prints:${normalizedPrintId}` ? '' : current
            );
        }
    }
    async function setProfileField(fieldName: any, fileId: any) {
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        if (!currentUserId) {
            toast.error(t('view.tools.empty.no_current_user_is_available'));
            return;
        }
        const normalizedFileId =
            typeof fileId === 'string'
                ? fileId.trim()
                : String(fileId ?? '').trim();
        const nextValue = buildProfilePicOverride(
            currentEndpoint,
            normalizedFileId
        );
        if (nextValue === currentUserSnapshot?.[fieldName]) {
            return;
        }
        const authTarget = getAuthTarget();
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey(`${fieldName}:${normalizedFileId || 'clear'}`);
        try {
            const nextUser = await userProfileRepository.updateCurrentUser({
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: {
                    [fieldName]: nextValue
                }
            });
            if (!isRuntimeAuthTarget(authTarget)) {
                return;
            }
            const mergedUser: any = mergeCurrentUserMediaUpdate(
                nextUser,
                useRuntimeStore.getState().auth.currentUserSnapshot
            );
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserSnapshot: mergedUser,
                currentUserDisplayName:
                    mergedUser.displayName ||
                    mergedUser.username ||
                    mergedUser.id ||
                    currentUserId
            });
            toast.success(
                fieldName === 'userIcon'
                    ? t('message.gallery.profile_icon_changed')
                    : t('message.gallery.profile_pic_changed')
            );
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_update_profile_media')
                );
            }
        } finally {
            setMutatingKey((current: any) =>
                current === `${fieldName}:${normalizedFileId || 'clear'}`
                    ? ''
                    : current
            );
        }
    }
    async function consumeInventoryBundle(inventoryId: any) {
        const normalizedInventoryId =
            typeof inventoryId === 'string'
                ? inventoryId.trim()
                : String(inventoryId ?? '').trim();
        if (!normalizedInventoryId) {
            return;
        }
        const authTarget = getAuthTarget();
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey(`inventory:${normalizedInventoryId}`);
        try {
            await mediaRepository.consumeInventoryBundle(
                normalizedInventoryId,
                {
                    endpoint: currentEndpoint
                }
            );
            if (isRuntimeAuthTarget(authTarget)) {
                setAssets((current: any) => ({
                    ...current,
                    inventory: current.inventory.filter(
                        (item: any) => item.id !== normalizedInventoryId
                    )
                }));
                await refreshInventory();
                toast.success(t('view.tools.label.inventory_bundle_consumed'));
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.tools.toast.failed_to_consume_inventory_bundle'
                          )
                );
            }
        } finally {
            setMutatingKey((current: any) =>
                current === `inventory:${normalizedInventoryId}` ? '' : current
            );
        }
    }
    async function redeemReward() {
        const authTarget = getAuthTarget();
        const result = await prompt({
            title: t('prompt.redeem.header'),
            description: t('prompt.redeem.description'),
            confirmText: t('prompt.redeem.redeem'),
            cancelText: t('prompt.redeem.cancel')
        });
        if (!result.ok || !String(result.value || '').trim()) {
            return;
        }
        if (!isRuntimeAuthTarget(authTarget)) {
            return;
        }
        setMutatingKey('inventory:redeem');
        try {
            await mediaRepository.redeemReward(result.value, {
                endpoint: currentEndpoint
            });
            if (isRuntimeAuthTarget(authTarget)) {
                toast.success(t('prompt.redeem.success'));
                await refreshInventory();
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.tools.toast.failed_to_redeem_reward')
                );
            }
        } finally {
            setMutatingKey((current: any) =>
                current === 'inventory:redeem' ? '' : current
            );
        }
    }
    return {
        deletePrint,
        setProfileField,
        consumeInventoryBundle,
        redeemReward
    };
}
