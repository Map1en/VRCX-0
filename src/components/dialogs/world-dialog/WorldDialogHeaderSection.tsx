import {
    ArmchairIcon,
    CopyIcon,
    DatabaseIcon,
    DownloadIcon,
    EyeIcon,
    ExternalLinkIcon,
    FlagIcon,
    FolderOpenIcon,
    FootprintsIcon,
    GlobeIcon,
    HistoryIcon,
    HomeIcon,
    ImageIcon,
    LinkIcon,
    LockIcon,
    type LucideIcon,
    MessageSquareIcon,
    PencilIcon,
    RefreshCwIcon,
    SettingsIcon,
    StarIcon,
    Trash2Icon,
    UsersIcon
} from 'lucide-react';
import { isValidElement } from 'react';
import { useTranslation } from 'react-i18next';

import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu';
import { FadeInImage } from '@/components/media/FadeInImage';
import { TranslatableText } from '@/components/translation/TranslatableText';
import type { WorldProfileRecord } from '@/domain/entities/world';
import { formatDateTime } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityActionSub,
    EntityFactAction,
    EntityFactList,
    EntityFactRow,
    EntityFactValue,
    EntityOverviewCard
} from '../EntityDialogScaffold';
import type {
    WorldDialogHeaderCommands,
    WorldDialogHeaderModel
} from './WorldDialogTabbedView';
import {
    fileAnalysisSizeForPlatform,
    platformDisplayName
} from './WorldDialogViewParts';
import { WorldRatingMenuItems } from './WorldRatingMenuItems';

function WorldRailStat({
    icon: Icon,
    label,
    value,
    detail
}: {
    icon: LucideIcon;
    label: string;
    value: number | string | undefined;
    detail?: string;
}) {
    const { i18n } = useTranslation();
    if (!value) {
        return null;
    }
    const display =
        typeof value === 'number'
            ? new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, {
                  notation: 'compact',
                  maximumFractionDigits: 1
              }).format(value)
            : value;
    const exact = typeof value === 'number' ? value.toLocaleString() : value;

    return (
        <HintTooltip label={`${label} ${exact}${detail ? ` · ${detail}` : ''}`}>
            <span className="flex min-w-0 cursor-default items-center gap-1.5">
                <Icon
                    aria-hidden="true"
                    className="text-muted-foreground size-3.5 shrink-0"
                />
                <span className="shrink-0 font-medium tabular-nums">
                    {display}
                </span>
                <span className="text-muted-foreground min-w-0 truncate text-xs">
                    {label}
                </span>
            </span>
        </HintTooltip>
    );
}

function WorldRailMeter({
    label,
    value
}: {
    label: string;
    value: number | undefined;
}) {
    if (!value) {
        return null;
    }
    const score = Math.min(10, Math.max(0, value));

    return (
        <HintTooltip label={`${label} ${score}/10`}>
            <span className="flex min-w-0 cursor-default items-center gap-1.5 text-xs">
                <span className="text-muted-foreground w-14 shrink-0 truncate">
                    {label}
                </span>
                <span className="bg-muted relative h-1.5 min-w-8 flex-1 overflow-hidden rounded-full">
                    <span
                        className="bg-primary absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${score * 10}%` }}
                    />
                </span>
            </span>
        </HintTooltip>
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

function WorldOverviewFacts({
    onCopyVrcxWorldUrl,
    onCopyWorldId,
    onCopyWorldUrl,
    onOpenWorldPage,
    vrcxWorldUrl,
    world,
    worldUrl
}: {
    onCopyVrcxWorldUrl: () => void;
    onCopyWorldId: () => void;
    onCopyWorldUrl: () => void;
    onOpenWorldPage: () => void;
    vrcxWorldUrl: string;
    world: WorldProfileRecord;
    worldUrl: string;
}) {
    const { t } = useTranslation();

    if (!world.id && !worldUrl) {
        return null;
    }

    return (
        <EntityFactList className="border-t pt-3">
            {world.id ? (
                <EntityFactRow label={t('dialog.world.info.id')}>
                    <EntityFactValue
                        display={compactWorldId(world.id)}
                        title={world.id}
                    >
                        <EntityFactAction
                            label={t('dialog.world.info.copy_id')}
                            icon={CopyIcon}
                            onClick={() => {
                                onCopyWorldId?.();
                            }}
                        />
                    </EntityFactValue>
                </EntityFactRow>
            ) : null}
            {worldUrl ? (
                <EntityFactRow label={t('dialog.world.info.url')}>
                    <EntityFactValue
                        display={compactUrl(worldUrl)}
                        title={worldUrl}
                    >
                        <EntityFactAction
                            label={t('common.actions.view_on_website')}
                            icon={ExternalLinkIcon}
                            onClick={onOpenWorldPage}
                        />
                        <EntityFactAction
                            label={t('dialog.world.info.copy_url')}
                            icon={CopyIcon}
                            onClick={() => {
                                onCopyWorldUrl?.();
                            }}
                        />
                    </EntityFactValue>
                </EntityFactRow>
            ) : null}
            {vrcxWorldUrl ? (
                <EntityFactRow
                    label={
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <span
                                        className="cursor-help underline decoration-dotted underline-offset-2"
                                        tabIndex={0}
                                    >
                                        {t('dialog.world.info.vrcx_url')}
                                    </span>
                                }
                            />
                            <TooltipContent>
                                {t('dialog.world.info.vrcx_url_description')}
                            </TooltipContent>
                        </Tooltip>
                    }
                >
                    <EntityFactValue
                        display={compactUrl(vrcxWorldUrl)}
                        title={vrcxWorldUrl}
                    >
                        <EntityFactAction
                            label={t('dialog.world.info.copy_vrcx_url')}
                            icon={CopyIcon}
                            onClick={onCopyVrcxWorldUrl}
                        />
                    </EntityFactValue>
                </EntityFactRow>
            ) : null}
        </EntityFactList>
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
                size="lg"
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
                {world.id ? <WorldRatingMenuItems worldId={world.id} /> : null}
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
                                        shortcut={
                                            world.$cacheSize ? (
                                                <span className="text-muted-foreground text-xs tabular-nums">
                                                    {world.$cacheSize}
                                                </span>
                                            ) : null
                                        }
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
    const { i18n, t } = useTranslation();
    const {
        detail,
        favoriteRate,
        imageUrl,
        isHomeWorld,
        platformRows,
        visibleTags,
        vrcxWorldUrl,
        world,
        worldUrl
    } = model;
    const {
        onChangeTab,
        onCopyVrcxWorldUrl,
        onCopyWorldId,
        onCopyWorldName,
        onCopyWorldUrl,
        onOpenAuthor,
        onOpenImage,
        onOpenWorldPage
    } = commands;
    const { restrictions, warnings } = visibleTags;
    const isPrivateWorld = !world.isLabs && world.releaseStatus === 'private';
    const lastVisitedAt = model.previousInstances[0]?.created_at;
    const lastVisitedText = lastVisitedAt
        ? formatDateTime(
              lastVisitedAt,
              { dateStyle: 'medium', timeStyle: 'short' },
              {
                  appLocale: i18n.resolvedLanguage || i18n.language,
                  fallback: ''
              }
          )
        : '';
    const occupantSplitText = `${t('dialog.world.instances.public_count', {
        count: world.publicOccupants ?? 0
    })} · ${t('dialog.world.instances.private_count', {
        count: world.privateOccupants ?? 0
    })}`;

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
                    {isPrivateWorld ? (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <span
                                        className="mt-0.5 shrink-0 cursor-help"
                                        role="img"
                                        tabIndex={0}
                                        aria-label={t(
                                            'dialog.world.tags.private'
                                        )}
                                    >
                                        <LockIcon className="size-5" />
                                    </span>
                                }
                            />
                            <TooltipContent>
                                {t('dialog.world.tags.private')}
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={!world.name}
                                    className="h-auto min-w-0 flex-1 justify-start overflow-hidden p-0 text-left text-lg leading-tight font-semibold whitespace-normal hover:bg-transparent disabled:pointer-events-none disabled:opacity-100"
                                    onClick={
                                        world.name ? onCopyWorldName : undefined
                                    }
                                >
                                    <span className="line-clamp-2 min-w-0 text-balance break-words">
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
                        className="text-muted-foreground hover:text-foreground h-auto max-w-full min-w-0 justify-start overflow-hidden p-0 text-left text-sm hover:bg-transparent disabled:pointer-events-none disabled:opacity-100"
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

            {world.isLabs || warnings.length || restrictions.length ? (
                <div className="flex flex-wrap gap-1.5">
                    {world.isLabs ? (
                        <Badge variant="outline" className="max-w-full">
                            <span className="truncate">
                                {t('dialog.world.tags.labs')}
                            </span>
                        </Badge>
                    ) : null}
                    {warnings.map((tag) => (
                        <Badge
                            key={tag.key}
                            variant="outline"
                            className="max-w-full"
                        >
                            <span className="truncate">{tag.label}</span>
                        </Badge>
                    ))}
                    {restrictions.length ? (
                        <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            className="rounded-full"
                            onClick={() => onChangeTab('info')}
                        >
                            {t('dialog.world.tags.restrictions_count', {
                                count: restrictions.length
                            })}
                        </Button>
                    ) : null}
                </div>
            ) : null}

            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <WorldRailStat
                    icon={UsersIcon}
                    label={t('dialog.world.rail.online')}
                    value={world.occupants}
                    detail={occupantSplitText}
                />
                <WorldRailStat
                    icon={StarIcon}
                    label={t('dialog.world.rail.favorites')}
                    value={world.favorites}
                    detail={
                        favoriteRate
                            ? t('dialog.world.info.favorite_rate', {
                                  rate: favoriteRate
                              })
                            : undefined
                    }
                />
                <WorldRailStat
                    icon={FootprintsIcon}
                    label={t('dialog.world.rail.visits')}
                    value={world.visits}
                />
                <WorldRailStat
                    icon={ArmchairIcon}
                    label={t('dialog.world.rail.capacity')}
                    value={
                        world.recommendedCapacity && world.capacity
                            ? `${world.recommendedCapacity}/${world.capacity}`
                            : world.recommendedCapacity || world.capacity
                    }
                />
            </div>

            {world.heat || world.popularity ? (
                <div className="flex flex-col gap-1.5">
                    <WorldRailMeter
                        label={t('dialog.world.info.heat')}
                        value={world.heat}
                    />
                    <WorldRailMeter
                        label={t('dialog.world.info.popularity')}
                        value={world.popularity}
                    />
                </div>
            ) : null}

            {lastVisitedText || platformRows.length ? (
                <EntityFactList className="border-t pt-3">
                    {lastVisitedText ? (
                        <EntityFactRow
                            label={t('dialog.world.rail.last_visited')}
                            value={lastVisitedText}
                        />
                    ) : null}
                    {platformRows.length ? (
                        <EntityFactRow label={t('dialog.world.info.platform')}>
                            <span className="text-muted-foreground/80 flex min-w-0 items-center gap-1">
                                {platformRows.map((platform, index) => {
                                    const name = platformDisplayName(platform);
                                    const size = fileAnalysisSizeForPlatform(
                                        world.fileAnalysis,
                                        platform
                                    );
                                    return (
                                        <span
                                            key={platform}
                                            className="flex shrink-0 items-center gap-1"
                                        >
                                            {index > 0 ? (
                                                <span className="opacity-50">
                                                    ·
                                                </span>
                                            ) : null}
                                            <HintTooltip
                                                label={
                                                    size
                                                        ? `${name} ${size}`
                                                        : name
                                                }
                                            >
                                                <span className="cursor-default">
                                                    {name}
                                                </span>
                                            </HintTooltip>
                                        </span>
                                    );
                                })}
                            </span>
                        </EntityFactRow>
                    ) : null}
                </EntityFactList>
            ) : null}

            {world.description ? (
                <TranslatableText
                    source={world.description}
                    entityId={world.id || ''}
                    density="icon"
                >
                    {({ action, meta, error, text }) => (
                        <>
                            <Separator />
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                    <span className="text-muted-foreground truncate text-xs font-medium">
                                        {t('dialog.world.info.description')}
                                    </span>
                                    {action}
                                </div>
                                {meta}
                                <div className="text-muted-foreground max-h-28 overflow-auto text-sm whitespace-pre-wrap">
                                    {text}
                                </div>
                                {error}
                            </div>
                        </>
                    )}
                </TranslatableText>
            ) : null}

            <WorldOverviewFacts
                onCopyVrcxWorldUrl={onCopyVrcxWorldUrl}
                onCopyWorldId={onCopyWorldId}
                onCopyWorldUrl={onCopyWorldUrl}
                onOpenWorldPage={onOpenWorldPage}
                vrcxWorldUrl={vrcxWorldUrl}
                world={world}
                worldUrl={worldUrl}
            />

            {detail ? (
                <div className="text-muted-foreground text-xs">
                    {isValidElement(detail)
                        ? detail
                        : userFacingErrorMessage(
                              detail,
                              t('common.error.failed_to_load_data')
                          )}
                </div>
            ) : null}
        </EntityOverviewCard>
    );
}
