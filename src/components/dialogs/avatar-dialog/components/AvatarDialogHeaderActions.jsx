import {
    BanIcon,
    CheckCircleIcon,
    CopyIcon,
    DownloadIcon,
    ExternalLinkIcon,
    ImageIcon,
    PencilIcon,
    RefreshCwIcon,
    Share2Icon,
    Trash2Icon,
    UserIcon
} from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import { Button } from '@/ui/shadcn/button';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator
} from '../../EntityDialogScaffold.jsx';

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
    const { avatarUrl, packageUrl } = links;
    const {
        onDeleteCache,
        onSelect,
        onRefresh,
        onCopyText,
        onOpenLink,
        onSelectFallback,
        onReleaseStatus,
        onRename,
        onChangeDescription,
        onChangeContentTags,
        onChangeStylesAndAuthorTags,
        onChangeImage,
        onRegenerateImposter,
        onDeleteImposter,
        onCreateImposter,
        onAvatarBlock,
        onDelete
    } = actions;

    return (
        <>
            {avatar.$isCached ? (
                <Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    className="rounded-full"
                    aria-label={t('dialog.avatar.actions.delete_cache_tooltip')}
                    disabled={actionStatus === 'cache'}
                    onClick={onDeleteCache}
                >
                    <Trash2Icon data-icon="inline-start" />
                </Button>
            ) : null}
            <FavoriteActionMenu kind="avatar" entityId={avatar.id} entity={avatar} />
            <Button
                type="button"
                size="icon-lg"
                className="rounded-full"
                aria-label={t('dialog.avatar.actions.select')}
                disabled={!canSelectAvatar || actionStatus === 'selecting'}
                onClick={onSelect}
            >
                <CheckCircleIcon data-icon="inline-start" />
            </Button>
            <EntityActionDropdown busy={actionStatus !== 'idle'} dangerous={avatarBlocked}>
                <EntityActionItem
                    icon={RefreshCwIcon}
                    disabled={actionStatus === 'refresh'}
                    onSelect={onRefresh}
                >
                    {t('common.actions.refresh')}
                </EntityActionItem>
                {avatarUrl ? (
                    <>
                        <EntityActionItem
                            icon={Share2Icon}
                            onSelect={() =>
                                void onCopyText(
                                    avatarUrl,
                                    t('dialog.avatar.info.copy_url')
                                )
                            }
                        >
                            {t('dialog.avatar.generated.share_copy_url')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={ExternalLinkIcon}
                            onSelect={() => onOpenLink(avatarUrl)}
                        >
                            {t('dialog.avatar.generated.open_vrchat_page')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={CopyIcon}
                            onSelect={() =>
                                void onCopyText(
                                    avatar.id,
                                    t('dialog.avatar.info.copy_id')
                                )
                            }
                        >
                            {t('dialog.avatar.generated.copy_avatar_id')}
                        </EntityActionItem>
                    </>
                ) : null}
                <EntityActionSeparator />
                <EntityActionItem
                    icon={UserIcon}
                    disabled={!canSelectFallbackAvatar || actionStatus === 'fallback'}
                    onSelect={onSelectFallback}
                >
                    {t('dialog.avatar.actions.select_fallback')}
                </EntityActionItem>
                {canManageAvatar && packageUrl ? (
                    <EntityActionItem
                        icon={DownloadIcon}
                        onSelect={() => onOpenLink(packageUrl)}
                    >
                        {t('dialog.avatar.generated.download_unity_package')}
                    </EntityActionItem>
                ) : null}
                {canManageAvatar ? (
                    <>
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
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionStatus === 'rename'}
                            onSelect={onRename}
                        >
                            {t('dialog.avatar.generated.rename')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionStatus === 'description'}
                            onSelect={onChangeDescription}
                        >
                            {t('dialog.avatar.generated.change_description')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionStatus === 'tags'}
                            onSelect={onChangeContentTags}
                        >
                            {t('dialog.avatar.actions.change_content_tags')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={PencilIcon}
                            disabled={actionStatus === 'styles'}
                            onSelect={onChangeStylesAndAuthorTags}
                        >
                            {t('dialog.avatar.actions.change_styles_author_tags')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={ImageIcon}
                            disabled={actionStatus === 'image-upload'}
                            onSelect={onChangeImage}
                        >
                            {t('dialog.avatar.generated.change_image')}
                        </EntityActionItem>
                        <EntityActionSeparator />
                        {hasImposter ? (
                            <>
                                <EntityActionItem
                                    icon={RefreshCwIcon}
                                    destructive
                                    disabled={actionStatus === 'imposter'}
                                    onSelect={onRegenerateImposter}
                                >
                                    {t(
                                        'dialog.avatar.actions.regenerate_impostor'
                                    )}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={Trash2Icon}
                                    destructive
                                    disabled={actionStatus === 'imposter'}
                                    onSelect={onDeleteImposter}
                                >
                                    {t('dialog.avatar.actions.delete_impostor')}
                                </EntityActionItem>
                            </>
                        ) : (
                            <EntityActionItem
                                icon={UserIcon}
                                disabled={actionStatus === 'imposter'}
                                onSelect={onCreateImposter}
                            >
                                {t('dialog.avatar.actions.create_impostor')}
                            </EntityActionItem>
                        )}
                    </>
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
                {canManageAvatar ? (
                    <>
                        <EntityActionSeparator />
                        <EntityActionItem
                            icon={Trash2Icon}
                            destructive
                            disabled={actionStatus === 'delete'}
                            onSelect={onDelete}
                        >
                            {t('common.actions.delete')}
                        </EntityActionItem>
                    </>
                ) : null}
            </EntityActionDropdown>
        </>
    );
}
