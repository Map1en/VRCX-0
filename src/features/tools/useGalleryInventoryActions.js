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
}) {
    async function deletePrint(printId) {
        const normalizedPrintId =
            typeof printId === 'string'
                ? printId.trim()
                : String(printId ?? '').trim();
        if (!normalizedPrintId) {
            return;
        }
        const authTarget = getAuthTarget();
        const result = await confirm({
            title: t('view.tools.generated_modal.delete_print'),
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
                setAssets((current) => ({
                    ...current,
                    prints: current.prints.filter(
                        (print) => print.id !== normalizedPrintId
                    )
                }));
                toast.success(t('view.tools.generated.print_deleted'));
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t('view.tools.generated_toast.failed_to_delete_print')
                );
            }
        } finally {
            setMutatingKey((current) =>
                current === `prints:${normalizedPrintId}` ? '' : current
            );
        }
    }
    async function setProfileField(fieldName, fileId) {
        if (!isVrcPlusSupporter) {
            toast.error(t('message.vrcplus.required'));
            return;
        }
        if (!currentUserId) {
            toast.error(t('view.tools.generated.no_current_user_is_available'));
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
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserSnapshot: nextUser,
                currentUserDisplayName:
                    nextUser.displayName ||
                    nextUser.username ||
                    nextUser.id ||
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
                        : t(
                              'view.tools.generated_toast.failed_to_update_profile_media'
                          )
                );
            }
        } finally {
            setMutatingKey((current) =>
                current === `${fieldName}:${normalizedFileId || 'clear'}`
                    ? ''
                    : current
            );
        }
    }
    async function consumeInventoryBundle(inventoryId) {
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
                setAssets((current) => ({
                    ...current,
                    inventory: current.inventory.filter(
                        (item) => item.id !== normalizedInventoryId
                    )
                }));
                await refreshInventory();
                toast.success(
                    t('view.tools.generated.inventory_bundle_consumed')
                );
            }
        } catch (error) {
            if (isRuntimeAuthTarget(authTarget)) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.tools.generated_toast.failed_to_consume_inventory_bundle'
                          )
                );
            }
        } finally {
            setMutatingKey((current) =>
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
                        : t(
                              'view.tools.generated_toast.failed_to_redeem_reward'
                          )
                );
            }
        } finally {
            setMutatingKey((current) =>
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
