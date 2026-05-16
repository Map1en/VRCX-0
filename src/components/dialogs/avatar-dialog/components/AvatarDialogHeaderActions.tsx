// @ts-nocheck
import {
    BanIcon,
    CheckCircleIcon,
    DownloadIcon,
    ImageIcon,
    PencilIcon,
    RefreshCwIcon,
    Trash2Icon,
    UserIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu';
import { Button } from '@/ui/shadcn/button';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator
} from '../../EntityDialogScaffold';

export function AvatarDialogHeaderActions({
    avatar,
    state,
    capabilities,
    links,
    actions
}) {
    const { t } = useTranslation();

    const { actionStatus, avatarBlocked, isCurrentAvatar } = state;
    const {
        canManageAvatar,
        canSelectAvatar,
        canSelectFallbackAvatar,
        hasImposter
    } = capabilities;
    const { packageUrl } = links;
    const {
        onDeleteCache,
        onSelect,
        onRefresh,
        onOpenLink,
        onSelectFallback,
        onReleaseStatus,
        onEditDetails,
        onChangeContentTags,
        onChangeImage,
        onRegenerateImposter,
        onDeleteImposter,
        onCreateImposter,
        onAvatarBlock,
        onDelete
    } = actions;

    const selectLabel = isCurrentAvatar
        ? t('dialog.avatar.actions.current_avatar')
        : t('dialog.avatar.actions.select');
    const SelectIcon = isCurrentAvatar ? CheckCircleIcon : UserIcon;

    return (
        <>
            <Button
                type="button"
                size="sm"
                variant={canSelectAvatar ? 'default' : 'outline'}
                className="min-w-0 flex-1"
                aria-label={selectLabel}
                disabled={!canSelectAvatar || actionStatus === 'selecting'}
                onClick={onSelect}
            >
                <SelectIcon data-icon="inline-start" />
                <span className="truncate">{selectLabel}</span>
            </Button>
            <FavoriteActionMenu
                kind="avatar"
                entityId={avatar.id}
                entity={avatar}
                iconOnly
            />
            <EntityActionDropdown
                busy={actionStatus !== 'idle'}
                dangerous={avatarBlocked}
            >
                <EntityActionItem
                    icon={RefreshCwIcon}
                    disabled={actionStatus === 'refresh'}
                    onSelect={onRefresh}
                >
                    {t('common.actions.refresh')}
                </EntityActionItem>
                <EntityActionItem
                    icon={UserIcon}
                    disabled={
                        !canSelectFallbackAvatar || actionStatus === 'fallback'
                    }
                    onSelect={onSelectFallback}
                >
                    {t('dialog.avatar.actions.select_fallback')}
                </EntityActionItem>
                {canManageAvatar ? (
                    <>
                        <EntityActionSeparator />
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionStatus !== 'idle'}
                            onSelect={onEditDetails}
                        >
                            {t('dialog.avatar.actions.edit_details')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={ImageIcon}
                            disabled={actionStatus === 'image-upload'}
                            onSelect={onChangeImage}
                        >
                            {t('dialog.avatar.actions.change_image')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionStatus === 'tags'}
                            onSelect={onChangeContentTags}
                        >
                            {t('dialog.avatar.actions.change_content_tags')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={UserIcon}
                            disabled={actionStatus === 'release-status'}
                            onSelect={() =>
                                onReleaseStatus(
                                    avatar.releaseStatus === 'public'
                                        ? 'private'
                                        : 'public'
                                )
                            }
                        >
                            {avatar.releaseStatus === 'public'
                                ? t('dialog.avatar.actions.make_private')
                                : t('dialog.avatar.actions.make_public')}
                        </EntityActionItem>
                    </>
                ) : null}
                {canManageAvatar || !isCurrentAvatar ? (
                    <EntityActionSeparator />
                ) : null}
                {canManageAvatar && packageUrl ? (
                    <EntityActionItem
                        icon={DownloadIcon}
                        onSelect={() => onOpenLink(packageUrl)}
                    >
                        {t('dialog.avatar.actions.download_package')}
                    </EntityActionItem>
                ) : null}
                {canManageAvatar && hasImposter ? (
                    <EntityActionItem
                        icon={RefreshCwIcon}
                        disabled={actionStatus === 'imposter'}
                        onSelect={onRegenerateImposter}
                    >
                        {t('dialog.avatar.actions.regenerate_impostor')}
                    </EntityActionItem>
                ) : canManageAvatar ? (
                    <EntityActionItem
                        icon={UserIcon}
                        disabled={actionStatus === 'imposter'}
                        onSelect={onCreateImposter}
                    >
                        {t('dialog.avatar.actions.create_impostor')}
                    </EntityActionItem>
                ) : null}
                {!isCurrentAvatar ? (
                    <EntityActionItem
                        icon={BanIcon}
                        destructive={avatarBlocked}
                        disabled={actionStatus === 'avatar-block'}
                        onSelect={() => onAvatarBlock(!avatarBlocked)}
                    >
                        {avatarBlocked
                            ? t('dialog.avatar.actions.unblock')
                            : t('dialog.avatar.actions.block')}
                    </EntityActionItem>
                ) : null}
                {avatar.$isCached || canManageAvatar ? (
                    <>
                        <EntityActionSeparator />
                        {avatar.$isCached ? (
                            <EntityActionItem
                                icon={Trash2Icon}
                                disabled={actionStatus === 'cache'}
                                onSelect={onDeleteCache}
                            >
                                {t(
                                    'dialog.avatar.actions.delete_cache_tooltip'
                                )}
                            </EntityActionItem>
                        ) : null}
                        {canManageAvatar && hasImposter ? (
                            <EntityActionItem
                                icon={Trash2Icon}
                                destructive
                                disabled={actionStatus === 'imposter'}
                                onSelect={onDeleteImposter}
                            >
                                {t('dialog.avatar.actions.delete_impostor')}
                            </EntityActionItem>
                        ) : null}
                        {canManageAvatar ? (
                            <EntityActionItem
                                icon={Trash2Icon}
                                destructive
                                disabled={actionStatus === 'delete'}
                                onSelect={onDelete}
                            >
                                {t('common.actions.delete')}
                            </EntityActionItem>
                        ) : null}
                    </>
                ) : null}
            </EntityActionDropdown>
        </>
    );
}
