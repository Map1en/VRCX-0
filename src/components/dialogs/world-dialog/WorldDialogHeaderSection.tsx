// @ts-nocheck
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
import { isValidElement } from 'react';
import { useTranslation } from 'react-i18next';

import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
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
import { useWorldDescriptionTranslation } from './useWorldDescriptionTranslation.js';
import { PlatformBadge } from './WorldDialogViewParts';

function overviewValue(value) {
    return value || value === 0 ? String(value) : '—';
}

function scoreValue(value) {
    const displayValue = overviewValue(value);
    return displayValue === '—' ? displayValue : `${displayValue}/10`;
}

function WorldOverviewMetric({ label, value }) {
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

function compactWorldId(worldId) {
    if (!worldId || worldId.length <= 18) {
        return worldId || '';
    }
    return `${worldId.slice(0, 12)}\u2026${worldId.slice(-4)}`;
}

function compactUrl(url) {
    if (!url) {
        return '';
    }

    const displayUrl = url.replace(/^https?:\/\//, '');
    if (displayUrl.length <= 18) {
        return displayUrl;
    }

    return `${displayUrl.slice(0, 12)}\u2026${displayUrl.slice(-4)}`;
}

function WorldOverviewFactRow({ children, label }) {
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
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    aria-label={t('dialog.world.info.copy_id')}
                                    size="icon-xs"
                                    variant="ghost"
                                    onClick={() => void onCopyWorldId?.()}
                                >
                                    <CopyIcon data-icon="inline-start" />
                                </Button>
                            </TooltipTrigger>
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
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    aria-label={t('common.actions.open_link')}
                                    size="icon-xs"
                                    variant="ghost"
                                    onClick={onOpenWorldPage}
                                >
                                    <ExternalLinkIcon data-icon="inline-start" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {t('common.actions.open_link')}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    aria-label={t('dialog.world.info.copy_url')}
                                    size="icon-xs"
                                    variant="ghost"
                                    onClick={() => void onCopyWorldUrl?.()}
                                >
                                    <CopyIcon data-icon="inline-start" />
                                </Button>
                            </TooltipTrigger>
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

function WorldOverviewActions({ handlers, state }) {
    const { t } = useTranslation();
    const {
        actionStatus,
        canManageWorld,
        canUpdateHome,
        hasPersistData,
        isHomeWorld,
        isPublished,
        packageUrl,
        previousInstances,
        world
    } = state;
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
    } = handlers;

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
                    onSelect={onRefresh}
                >
                    {t('common.actions.refresh')}
                </EntityActionItem>
                <EntityActionSeparator />
                <EntityActionItem
                    icon={FlagIcon}
                    disabled={actionStatus === 'new-instance'}
                    onSelect={onNewInstance}
                >
                    {t('dialog.world.actions.new_instance')}
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
                    {t(
                        isHomeWorld
                            ? 'dialog.world.actions.reset_home'
                            : 'dialog.world.actions.make_home'
                    )}
                </EntityActionItem>
                <EntityActionItem
                    icon={HistoryIcon}
                    disabled={!previousInstances.length}
                    onSelect={() => onChangeTab('visit-history')}
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
                                onSelect={onEditDetails}
                            >
                                {t('dialog.world.actions.edit_details')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={ImageIcon}
                                disabled={actionStatus === 'image-upload'}
                                onSelect={onChangeImage}
                            >
                                {t('dialog.world.actions.change_image')}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={SettingsIcon}
                                disabled={actionStatus === 'save-world'}
                                onSelect={onChangeTags}
                            >
                                {t(
                                    'dialog.world.actions.change_warnings_settings_tags'
                                )}
                            </EntityActionItem>
                            <EntityActionItem
                                icon={LinkIcon}
                                disabled={actionStatus === 'save-world'}
                                onSelect={onChangeAllowedDomains}
                            >
                                {t(
                                    'dialog.world.actions.change_allowed_video_player_domains'
                                )}
                            </EntityActionItem>
                            {packageUrl ? (
                                <EntityActionItem
                                    icon={DownloadIcon}
                                    onSelect={onOpenPackage}
                                >
                                    {t('dialog.world.actions.download_package')}
                                </EntityActionItem>
                            ) : null}
                            <EntityActionSeparator />
                            <EntityActionItem
                                icon={EyeIcon}
                                disabled={actionStatus === 'publish-world'}
                                onSelect={onPublication}
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
                            label={t('dialog.world.actions.local_data')}
                        >
                            {world.$isCached ? (
                                <>
                                    <EntityActionItem
                                        icon={FolderOpenIcon}
                                        onSelect={onOpenCache}
                                    >
                                        {t('dialog.world.actions.open_cache')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={Trash2Icon}
                                        disabled={actionStatus === 'cache'}
                                        onSelect={onDeleteCache}
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
                                    onSelect={onDeletePersistentData}
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
                            onSelect={onDelete}
                        >
                            {t('common.actions.delete')}
                        </EntityActionItem>
                    </>
                ) : null}
            </EntityActionDropdown>
        </div>
    );
}

export function WorldDialogOverviewSection({ handlers, state }) {
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
    } = state;
    const {
        onCopyWorldId,
        onCopyWorldName,
        onCopyWorldUrl,
        onOpenAuthor,
        onOpenImage,
        onOpenCache,
        onOpenWorldPage
    } = handlers;
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
                        <img
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
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={!world.name}
                        className="hover:text-primary h-auto min-w-0 flex-1 justify-start overflow-hidden p-0 text-left text-lg leading-tight font-semibold whitespace-normal disabled:pointer-events-none disabled:opacity-100"
                        onClick={world.name ? onCopyWorldName : undefined}
                    >
                        <span className="line-clamp-2 min-w-0 break-all">
                            {world.name || 'World'}
                        </span>
                    </Button>
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

            <WorldOverviewActions handlers={handlers} state={state} />

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
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon-xs"
                                    variant="ghost"
                                    className="absolute top-0 right-0"
                                    disabled={descriptionTranslationLoading}
                                    aria-label={descriptionActionLabel}
                                    onClick={() =>
                                        void toggleDescriptionTranslation()
                                    }
                                >
                                    {descriptionTranslationLoading ? (
                                        <Spinner data-icon="inline-start" />
                                    ) : (
                                        <LanguagesIcon data-icon="inline-start" />
                                    )}
                                </Button>
                            </TooltipTrigger>
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
