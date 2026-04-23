import {
    CopyIcon,
    DownloadIcon,
    EyeIcon,
    ExternalLinkIcon,
    FlagIcon,
    GlobeIcon,
    HeartIcon,
    HomeIcon,
    ImageIcon,
    LineChartIcon,
    MessageSquareIcon,
    PencilIcon,
    RefreshCwIcon,
    Share2Icon,
    Trash2Icon,
    UploadIcon,
    UsersIcon
} from 'lucide-react';

import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityDialogHeader
} from '../EntityDialogScaffold.jsx';
import { PlatformBadge, fileAnalysisSizeForPlatform } from './WorldDialogViewParts.jsx';

export function WorldDialogHeaderSection({ handlers, state, t }) {
    const {
        actionStatus,
        canManageWorld,
        canUpdateHome,
        detail,
        hasPersistData,
        imageUrl,
        isHomeWorld,
        isPublished,
        packageUrl,
        platformRows,
        previousInstances,
        visibleTags,
        world,
        worldUrl
    } = state;
    const {
        onChangeAllowedDomains,
        onChangeCapacity,
        onChangeDescription,
        onChangeImage,
        onChangePreview,
        onChangeRecommendedCapacity,
        onChangeTags,
        onChangeTab,
        onCopyWorldId,
        onCopyWorldName,
        onCopyWorldUrl,
        onDelete,
        onDeleteCache,
        onDeletePersistentData,
        onHome,
        onNewInstance,
        onNewInstanceSelfInvite,
        onOpenAuthor,
        onOpenCache,
        onOpenImage,
        onOpenPackage,
        onOpenWorldPage,
        onPublication,
        onRefresh,
        onRename
    } = handlers;

    return (
        <EntityDialogHeader
            imageUrl={imageUrl}
            imageAlt={world.name || world.id || 'World'}
            imagePlaceholder={<GlobeIcon className="text-muted-foreground size-8" />}
            onImageClick={imageUrl ? onOpenImage : null}
            titlePrefix={
                isHomeWorld ? <HomeIcon className="size-5 shrink-0" /> : null
            }
            title={world.name || 'World'}
            onTitleClick={world.name ? onCopyWorldName : undefined}
            subtitle={world.authorName || ''}
            onSubtitleClick={world.authorId ? onOpenAuthor : undefined}
            description={world.description}
            detail={detail}
            badges={
                <>
                    <Badge
                        variant={
                            world.releaseStatus === 'public'
                                ? 'default'
                                : 'outline'
                        }
                    >
                        {world.isLabs ? 'Labs' : world.releaseStatus || 'Unknown'}
                    </Badge>
                    {world.capacity > 0 ? (
                        <Badge variant="outline">
                            <UsersIcon data-icon="inline-start" />
                            {t('dialog.world.info.capacity')} {world.capacity}
                        </Badge>
                    ) : null}
                    {world.occupants > 0 ? (
                        <Badge variant="outline">
                            <UsersIcon data-icon="inline-start" />
                            {t('dialog.world.generated.occupants')}{' '}
                            {world.occupants}
                        </Badge>
                    ) : null}
                    {world.favorites > 0 ? (
                        <Badge variant="outline">
                            <HeartIcon data-icon="inline-start" />
                            {t('dialog.world.generated.favorites')}{' '}
                            {world.favorites}
                        </Badge>
                    ) : null}
                    {world.$isCached ? (
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            className="rounded-full"
                            onClick={onOpenCache}
                        >
                            {world.$cacheSize
                                ? `${world.$cacheSize} Cache`
                                : 'Local cache'}
                        </Button>
                    ) : null}
                    {platformRows.map((platform) => (
                        <PlatformBadge
                            key={platform}
                            name={platform}
                            fileSize={fileAnalysisSizeForPlatform(
                                world.fileAnalysis,
                                platform
                            )}
                        />
                    ))}
                    {visibleTags.map((tag) => (
                        <Badge key={tag.key} variant="outline">
                            {tag.label}
                        </Badge>
                    ))}
                </>
            }
            actions={
                <>
                    {world.$isCached ? (
                        <Button
                            type="button"
                            size="icon-lg"
                            variant="outline"
                            aria-label="Delete cached world"
                            disabled={actionStatus === 'cache'}
                            onClick={onDeleteCache}
                        >
                            <Trash2Icon data-icon="inline-start" />
                        </Button>
                    ) : null}
                    <FavoriteActionMenu kind="world" entityId={world.id} entity={world} />
                    <EntityActionDropdown busy={actionStatus !== 'idle'}>
                        <EntityActionItem
                            icon={RefreshCwIcon}
                            disabled={actionStatus === 'refresh'}
                            onSelect={onRefresh}
                        >
                            {t('common.actions.refresh')}
                        </EntityActionItem>
                        {worldUrl ? (
                            <>
                                <EntityActionItem
                                    icon={Share2Icon}
                                    onSelect={() => void onCopyWorldUrl()}
                                >
                                    {t('dialog.world.generated.share_copy_url')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={ExternalLinkIcon}
                                    onSelect={onOpenWorldPage}
                                >
                                    {t('dialog.world.generated.open_vrchat_page')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={CopyIcon}
                                    onSelect={() => void onCopyWorldId()}
                                >
                                    {t('dialog.world.generated.copy_world_id')}
                                </EntityActionItem>
                            </>
                        ) : null}
                        <EntityActionSeparator />
                        <EntityActionItem
                            icon={FlagIcon}
                            disabled={actionStatus === 'new-instance'}
                            onSelect={onNewInstance}
                        >
                            {t('dialog.world.generated.new_instance')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={MessageSquareIcon}
                            disabled={actionStatus === 'new-instance'}
                            onSelect={onNewInstanceSelfInvite}
                        >
                            {t('dialog.world.actions.new_instance_and_self_invite')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={HomeIcon}
                            disabled={!canUpdateHome || actionStatus === 'home'}
                            onSelect={onHome}
                        >
                            {isHomeWorld ? 'Reset Home' : 'Make Home'}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={LineChartIcon}
                            disabled={!previousInstances.length}
                            onSelect={() => onChangeTab('visit-history')}
                        >
                            {t('dialog.world.generated.visit_history')}
                        </EntityActionItem>
                        <EntityActionItem
                            icon={UploadIcon}
                            disabled={
                                !hasPersistData ||
                                actionStatus === 'persistent-data'
                            }
                            onSelect={onDeletePersistentData}
                        >
                            {t('dialog.world.actions.delete_persistent_data')}
                        </EntityActionItem>
                        <EntityActionSeparator />
                        {canManageWorld ? (
                            <>
                                <EntityActionItem
                                    icon={PencilIcon}
                                    disabled={actionStatus === 'save-world'}
                                    onSelect={onRename}
                                >
                                    {t('dialog.world.generated.rename')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={PencilIcon}
                                    disabled={actionStatus === 'save-world'}
                                    onSelect={onChangeDescription}
                                >
                                    {t('dialog.world.generated.change_description')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={PencilIcon}
                                    disabled={actionStatus === 'save-world'}
                                    onSelect={onChangeCapacity}
                                >
                                    {t('dialog.world.generated.change_capacity')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={PencilIcon}
                                    disabled={actionStatus === 'save-world'}
                                    onSelect={onChangeRecommendedCapacity}
                                >
                                    {t(
                                        'dialog.world.generated.change_recommended_capacity'
                                    )}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={PencilIcon}
                                    disabled={actionStatus === 'save-world'}
                                    onSelect={onChangePreview}
                                >
                                    {t('prompt.change_world_preview.header')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={PencilIcon}
                                    disabled={actionStatus === 'save-world'}
                                    onSelect={onChangeTags}
                                >
                                    {t('dialog.world.generated.change_tags')}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={PencilIcon}
                                    disabled={actionStatus === 'save-world'}
                                    onSelect={onChangeAllowedDomains}
                                >
                                    {t(
                                        'dialog.world.generated.change_allowed_domains'
                                    )}
                                </EntityActionItem>
                                <EntityActionItem
                                    icon={ImageIcon}
                                    disabled={actionStatus === 'image-upload'}
                                    onSelect={onChangeImage}
                                >
                                    {t('dialog.world.generated.change_image')}
                                </EntityActionItem>
                                {packageUrl ? (
                                    <EntityActionItem
                                        icon={DownloadIcon}
                                        onSelect={onOpenPackage}
                                    >
                                        {t(
                                            'dialog.world.generated.download_unity_package'
                                        )}
                                    </EntityActionItem>
                                ) : null}
                                <EntityActionSeparator />
                                <EntityActionItem
                                    icon={EyeIcon}
                                    disabled={actionStatus === 'publish-world'}
                                    onSelect={onPublication}
                                >
                                    {isPublished
                                        ? 'Unpublish'
                                        : 'Publish to Labs'}
                                </EntityActionItem>
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
            }
        />
    );
}
