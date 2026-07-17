import {
    CopyIcon,
    DatabaseIcon,
    DownloadIcon,
    EyeIcon,
    ExternalLinkIcon,
    FlagIcon,
    FolderOpenIcon,
    GlobeIcon,
    HistoryIcon,
    HomeIcon,
    ImageIcon,
    LanguagesIcon,
    LinkIcon,
    MessageSquareIcon,
    PencilIcon,
    RefreshCwIcon,
    SettingsIcon,
    Trash2Icon
} from 'lucide-react';
import { isValidElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu';
import { FadeInImage } from '@/components/media/FadeInImage';
import type { WorldProfileRecord } from '@/domain/entities/profileEntities';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityActionSub,
    EntityOverviewCard
} from '../EntityDialogScaffold';
import { useWorldDescriptionTranslation } from './useWorldDescriptionTranslation';
import type {
    WorldDialogHeaderCommands,
    WorldDialogHeaderModel
} from './WorldDialogTabbedView';
import { PlatformBadge } from './WorldDialogViewParts';

function overviewValue(value: unknown) {
    return value || value === 0 ? String(value) : '—';
}

function scoreValue(value: unknown) {
    const displayValue = overviewValue(value);
    return displayValue === '—' ? displayValue : `${displayValue}/10`;
}

function WorldOverviewMetric({
    label,
    value
}: {
    label: ReactNode;
    value: unknown;
}) {
    const displayValue = overviewValue(value);
    if (displayValue === '—') {
        return null;
    }

    return (
        <div className="flex min-w-0 items-baseline gap-1">
            <span className="text-muted-foreground truncate">{label}</span>
            <span className="text-foreground truncate font-medium tabular-nums">
                {displayValue}
            </span>
        </div>
    );
}

function compactWorldId(worldId: string) {
    if (!worldId || worldId.length <= 18) {
        return worldId || '';
    }
    return `${worldId.slice(0, 12)}\u2026${worldId.slice(-4)}`;
}

function compactUrl(url: string) {
    if (!url) {
        return '';
    }

    const displayUrl = url.replace(/^https?:\/\//, '');
    if (displayUrl.length <= 18) {
        return displayUrl;
    }

    return `${displayUrl.slice(0, 12)}\u2026${displayUrl.slice(-4)}`;
}

function WorldOverviewFactRow({
    children,
    label
}: {
    children: ReactNode;
    label: ReactNode;
}) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="text-muted-foreground min-w-0 truncate">
                {label}
            </span>
            {children}
        </div>
    );
}

function WorldOverviewFacts({
    onCopyWorldId,
    onCopyWorldUrl,
    onOpenWorldPage,
    world,
    worldUrl
}: {
    onCopyWorldId: () => void;
    onCopyWorldUrl: () => void;
    onOpenWorldPage: () => void;
    world: WorldProfileRecord;
    worldUrl: string;
}) {
    const { t } = useTranslation();

    if (!world.id && !worldUrl) {
        return null;
    }

    return (
        <div className="text-muted-foreground/80 flex min-w-0 flex-col gap-1 border-t pt-3 text-xs">
            {world.id ? (
                <WorldOverviewFactRow label={t('dialog.world.info.id')}>
                    <span className="flex min-w-0 items-center justify-end gap-1">
                        <span
                            className="text-muted-foreground/80 min-w-0 truncate font-mono text-[11px]"
                            title={world.id}
                        >
                            {compactWorldId(world.id)}
                        </span>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        aria-label={t(
                                            'dialog.world.info.copy_id'
                                        )}
                                        size="icon-xs"
                                        variant="ghost"
                                        onClick={() => {
                                            onCopyWorldId?.();
                                        }}
                                    >
                                        <CopyIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('dialog.world.info.copy_id')}
                            </TooltipContent>
                        </Tooltip>
                    </span>
                </WorldOverviewFactRow>
            ) : null}
            {worldUrl ? (
                <WorldOverviewFactRow label={t('dialog.world.info.url')}>
                    <span className="flex min-w-0 items-center justify-end gap-1">
                        <span
                            className="text-muted-foreground/80 min-w-0 truncate font-mono text-[11px]"
                            title={worldUrl}
                        >
                            {compactUrl(worldUrl)}
                        </span>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        aria-label={t(
                                            'common.actions.open_link'
                                        )}
                                        size="icon-xs"
                                        variant="ghost"
                                        onClick={onOpenWorldPage}
                                    >
                                        <ExternalLinkIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('common.actions.open_link')}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        aria-label={t(
                                            'dialog.world.info.copy_url'
                                        )}
                                        size="icon-xs"
                                        variant="ghost"
                                        onClick={() => {
                                            onCopyWorldUrl?.();
                                        }}
                                    >
                                        <CopyIcon data-icon="inline-start" />
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {t('dialog.world.info.copy_url')}
                            </TooltipContent>
                        </Tooltip>
                    </span>
                </WorldOverviewFactRow>
            ) : null}
        </div>
    );
}

function WorldOverviewActions({
    actionModel: model,
    actionCommands: commands
}: {
    actionModel: WorldDialogHeaderModel;
    actionCommands: WorldDialogHeaderCommands;
}) {
    const { t } = useTranslation();
    const {
        actionStatus,
        canManageWorld,
        canOpenInstanceInGame,
        canUpdateHome,
        hasPersistData,
        isHomeWorld,
        isPublished,
        packageUrl,
        previousInstances,
        world
    } = model;
    const {
        onChangeAllowedDomains,
        onEditDetails,
        onChangeImage,
        onChangeTags,
        onChangeTab,
        onDelete,
        onDeleteCache,
        onDeletePersistentData,
        onHome,
        onNewInstance,
        onNewInstanceSelfInvite,
        onOpenCache,
        onOpenPackage,
        onPublication,
        onRefresh
    } = commands;
    const newInstanceFollowUpLabelKey = canOpenInstanceInGame
        ? 'dialog.world.actions.new_instance_and_open_ingame'
        : 'dialog.world.actions.new_instance_and_self_invite';

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Button
                type="button"
                size="sm"
                className="min-w-0 flex-1"
                disabled={actionStatus === 'new-instance'}
                onClick={onNewInstance}
            >
                <FlagIcon data-icon="inline-start" />
                <span className="truncate">
                    {t('dialog.world.actions.new_instance')}
                </span>
            </Button>
            <FavoriteActionMenu
                kind="world"
                entityId={world.id}
                entity={world}
                iconOnly
            />
            <EntityActionDropdown busy={actionStatus !== 'idle'}>
                <EntityActionItem
                    icon={RefreshCwIcon}
                    disabled={actionStatus === 'refresh'}
                    onClick={onRefresh}
                >
                    {t('common.actions.refresh')}
                </EntityActionItem>
                <EntityActionSeparator />
                <EntityActionItem
                    icon={FlagIcon}
                    disabled={actionStatus === 'new-instance'}
                    onClick={onNewInstance}
                >
                    {t('dialog.world.actions.new_instance')}
                </EntityActionItem>
                <EntityActionItem
                    icon={MessageSquareIcon}
                    disabled={actionStatus === 'new-instance'}
                    onClick={onNewInstanceSelfInvite}
                >
                    {t(newInstanceFollowUpLabelKey)}
                </EntityActionItem>
                <EntityActionItem
                    icon={HomeIcon}
                    disabled={!canUpdateHome || actionStatus === 'home'}
                    onClick={onHome}
                >
                    {t(
                        isHomeWorld
                            ? 'dialog.world.actions.reset_home'
                            : 'dialog.world.actions.make_home'
                    )}
                </EntityActionItem>
                <EntityActionItem
                    icon={HistoryIcon}
                    disabled={!previousInstances.length}
                    onClick={() => onChangeTab('visit-history')}
                >
                    {t('dialog.world.actions.show_previous_instances')}
                </EntityActionItem>
                {canManageWorld ? (
                    <>
                        <EntityActionSeparator />
                        <EntityActionSub
                            icon={PencilIcon}
                            label={t('dialog.world.actions.manage_world')}
                        >
                            <EntityActionItem
                                icon={PencilIcon}
                                disabled={actionStatus === 'save-world'}
                                onClick={onEditDetails}
                            >
                                {t('dialog.world.actions.edit_details')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={ImageIcon}
                                disabled={actionStatus === 'image-upload'}
                                onClick={onChangeImage}
                            >
                                {t('dialog.world.actions.change_image')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={SettingsIcon}
                                disabled={actionStatus === 'save-world'}
                                onClick={onChangeTags}
                            >
                                {t(
                                    'dialog.world.actions.change_warnings_settings_tags'
                                )}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={LinkIcon}
                                disabled={actionStatus === 'save-world'}
                                onClick={onChangeAllowedDomains}
                            >
                                {t(
                                    'dialog.world.actions.change_allowed_video_player_domains'
                                )}
                            </EntityActionItem>
                            {packageUrl ? (
                                <EntityActionItem
                                    icon={DownloadIcon}
                                    onClick={onOpenPackage}
                                >
                                    {t('dialog.world.actions.download_package')}
                                </EntityActionItem>
                            ) : null}
                            <EntityActionSeparator />
                            <EntityActionItem
                                icon={EyeIcon}
                                disabled={actionStatus === 'publish-world'}
                                onClick={onPublication}
                            >
                                {isPublished
                                    ? t('dialog.world.actions.unpublish')
                                    : t('dialog.world.actions.publish_to_labs')}
                            </EntityActionItem>
                        </EntityActionSub>
                    </>
                ) : null}
                {world.$isCached || hasPersistData ? (
                    <>
                        <EntityActionSeparator />
                        <EntityActionSub
                            icon={FolderOpenIcon}
                            label={t('dialog.world.actions.local_records')}
                        >
                            {world.$isCached ? (
                                <>
                                    <EntityActionItem
                                        icon={FolderOpenIcon}
                                        onClick={onOpenCache}
                                    >
                                        {t('dialog.world.actions.open_cache')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={Trash2Icon}
                                        disabled={actionStatus === 'cache'}
                                        onClick={onDeleteCache}
                                    >
                                        {t(
                                            'dialog.world.actions.delete_cache_tooltip'
                                        )}
                                    </EntityActionItem>
                                </>
                            ) : null}
                            {hasPersistData ? (
                                <EntityActionItem
                                    icon={DatabaseIcon}
                                    disabled={
                                        actionStatus === 'persistent-data'
                                    }
                                    onClick={onDeletePersistentData}
                                >
                                    {t(
                                        'dialog.world.actions.delete_persistent_data'
                                    )}
                                </EntityActionItem>
                            ) : null}
                        </EntityActionSub>
                    </>
                ) : null}
                {canManageWorld ? (
                    <>
                        <EntityActionSeparator />
                        <EntityActionItem
                            icon={Trash2Icon}
                            destructive
                            disabled={actionStatus === 'delete'}
                            onClick={onDelete}
                        >
                            {t('common.actions.delete')}
                        </EntityActionItem>
                    </>
                ) : null}
            </EntityActionDropdown>
        </div>
    );
}

export function WorldDialogOverviewSection({
    headerModel: model,
    headerCommands: commands
}: {
    headerModel: WorldDialogHeaderModel;
    headerCommands: WorldDialogHeaderCommands;
}) {
    const { t } = useTranslation();
    const {
        detail,
        favoriteRate,
        hasPersistData,
        imageUrl,
        isHomeWorld,
        platformRows,
        visibleTags,
        world,
        worldUrl
    } = model;
    const {
        onCopyWorldId,
        onCopyWorldName,
        onCopyWorldUrl,
        onOpenAuthor,
        onOpenImage,
        onOpenCache,
        onOpenWorldPage
    } = commands;
    const {
        descriptionTranslationLoading,
        translatedDescriptionActive,
        toggleDescriptionTranslation,
        visibleDescription
    } = useWorldDescriptionTranslation({ world });
    const descriptionActionLabel = translatedDescriptionActive
        ? t('dialog.world.info.show_original_description', {
              defaultValue: 'Show Original'
          })
        : t('dialog.world.info.translate_description', {
              defaultValue: 'Translate Description'
          });
    const releaseLabel = world.isLabs
        ? t('dialog.world.tags.labs')
        : world.releaseStatus === 'public'
          ? t('dialog.world.tags.public')
          : world.releaseStatus === 'private'
            ? t('dialog.world.tags.private')
            : world.releaseStatus || 'Unknown';
    const favoritesText = world.favorites
        ? `${world.favorites}${favoriteRate ? ` (${favoriteRate}%)` : ''}`
        : '';
    const capacityText =
        world.recommendedCapacity && world.capacity
            ? `${world.recommendedCapacity}/${world.capacity}`
            : world.recommendedCapacity || world.capacity || '';

    return (
        <EntityOverviewCard
            media={
                <Button
                    type="button"
                    variant="ghost"
                    disabled={!imageUrl || !onOpenImage}
                    onClick={onOpenImage}
                    className={cn(
                        'bg-muted aspect-[4/3] h-auto w-full overflow-hidden rounded-lg border p-0 disabled:pointer-events-none',
                        imageUrl && onOpenImage
                            ? 'cursor-pointer'
                            : 'cursor-default'
                    )}
                >
                    {imageUrl ? (
                        <FadeInImage
                            src={imageUrl}
                            alt={world.name || world.id || 'World'}
                            className="size-full object-cover"
                        />
                    ) : (
                        <span className="flex size-full items-center justify-center">
                            <GlobeIcon className="text-muted-foreground size-10" />
                        </span>
                    )}
                </Button>
            }
        >
            <div className="flex min-w-0 flex-col gap-2">
                <div className="flex min-w-0 items-start gap-2 overflow-hidden">
                    {isHomeWorld ? (
                        <HomeIcon className="mt-0.5 size-5 shrink-0" />
                    ) : null}
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={!world.name}
                                    className="hover:text-primary h-auto min-w-0 flex-1 justify-start overflow-hidden p-0 text-left text-lg leading-tight font-semibold whitespace-normal disabled:pointer-events-none disabled:opacity-100"
                                    onClick={
                                        world.name ? onCopyWorldName : undefined
                                    }
                                >
                                    <span className="line-clamp-2 min-w-0 break-all">
                                        {world.name || 'World'}
                                    </span>
                                </Button>
                            }
                        />
                        <TooltipContent>
                            {t('common.actions.copy')}
                        </TooltipContent>
                    </Tooltip>
                </div>
                {world.authorName ? (
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={!world.authorId}
                        className="text-muted-foreground hover:text-primary h-auto max-w-full min-w-0 justify-start overflow-hidden p-0 text-left font-mono text-sm disabled:pointer-events-none disabled:opacity-100"
                        onClick={world.authorId ? onOpenAuthor : undefined}
                    >
                        <span className="truncate">{world.authorName}</span>
                    </Button>
                ) : null}
            </div>

            <WorldOverviewActions
                actionModel={model}
                actionCommands={commands}
            />

            <div className="flex flex-wrap gap-1.5">
                <Badge
                    variant={
                        world.releaseStatus === 'public' ? 'default' : 'outline'
                    }
                    className="max-w-full"
                >
                    <span className="truncate">{releaseLabel}</span>
                </Badge>
                {world.$isCached ? (
                    <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        className="rounded-full"
                        onClick={onOpenCache}
                    >
                        {world.$cacheSize
                            ? `${world.$cacheSize} ${t('dialog.world.tags.cache')}`
                            : t('dialog.world.tags.cache')}
                    </Button>
                ) : null}
                {hasPersistData ? (
                    <Badge variant="outline">
                        {t('dialog.world.info.persistent_data')}
                    </Badge>
                ) : null}
                {platformRows.map((platform) => (
                    <PlatformBadge key={platform} name={platform} />
                ))}
                {visibleTags.map((tag) => (
                    <Badge
                        key={tag.key}
                        variant="outline"
                        className="max-w-full"
                    >
                        <span className="truncate">{tag.label}</span>
                    </Badge>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <WorldOverviewMetric
                    label={t('dialog.world.info.players')}
                    value={world.occupants}
                />
                <WorldOverviewMetric
                    label={t('dialog.world.info.capacity')}
                    value={capacityText}
                />
                <WorldOverviewMetric
                    label={t('dialog.world.info.favorites')}
                    value={favoritesText}
                />
                <WorldOverviewMetric
                    label={t('dialog.world.info.visits')}
                    value={world.visits}
                />
                <WorldOverviewMetric
                    label={t('dialog.world.info.heat')}
                    value={scoreValue(world.heat)}
                />
                <WorldOverviewMetric
                    label={t('dialog.world.info.popularity')}
                    value={scoreValue(world.popularity)}
                />
            </div>

            {world.description ? (
                <>
                    <Separator />
                    <div className="relative min-w-0">
                        <div className="text-muted-foreground max-h-28 overflow-auto pr-8 text-sm whitespace-pre-wrap">
                            {visibleDescription}
                        </div>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        type="button"
                                        size="icon-xs"
                                        variant="ghost"
                                        className="absolute top-0 right-0"
                                        disabled={descriptionTranslationLoading}
                                        aria-label={descriptionActionLabel}
                                        onClick={() => {
                                            toggleDescriptionTranslation();
                                        }}
                                    >
                                        {descriptionTranslationLoading ? (
                                            <Spinner data-icon="inline-start" />
                                        ) : (
                                            <LanguagesIcon data-icon="inline-start" />
                                        )}
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {descriptionActionLabel}
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </>
            ) : null}

            <WorldOverviewFacts
                onCopyWorldId={onCopyWorldId}
                onCopyWorldUrl={onCopyWorldUrl}
                onOpenWorldPage={onOpenWorldPage}
                world={world}
                worldUrl={worldUrl}
            />

            {detail ? (
                <div className="text-muted-foreground text-xs">
                    {isValidElement(detail)
                        ? detail
                        : userFacingErrorMessage(
                              detail,
                              'The requested data could not be loaded.'
                          )}
                </div>
            ) : null}
        </EntityOverviewCard>
    );
}
