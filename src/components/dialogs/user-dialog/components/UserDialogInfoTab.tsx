import {
    ChevronRightIcon,
    CrownIcon,
    ExternalLinkIcon,
    ImageIcon,
    PencilIcon,
    SparklesIcon,
    UsersRoundIcon
} from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';

import { formatCredits } from '@/components/economy/economyDisplay';
import { useEconomyBalance } from '@/components/economy/useEconomyBalance';
import { AvatarInfoLine } from '@/components/feed/FeedAvatarInfoLine';
import { useAvatarImageInfo } from '@/components/feed/useAvatarImageInfo';
import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { Location } from '@/components/Location';
import { LocationWorld } from '@/components/LocationWorld';
import { BioLinkFavicon } from '@/components/media/BioLinkFavicon';
import { FadeInImage } from '@/components/media/FadeInImage';
import {
    Timeline,
    TimelineDate,
    TimelineHeader,
    TimelineIndicator,
    TimelineItem,
    TimelineSeparator,
    TimelineTitle
} from '@/components/reui/timeline';
import { TranslatableText } from '@/components/translation/TranslatableText';
import type { EntityRecord } from '@/domain/entities/shared';
import type { UserProfileEntity } from '@/domain/entities/user';
import { formatDateTime } from '@/lib/dateTime';
import { useWorldSummaries } from '@/lib/useWorldSummaries';
import { cn } from '@/lib/utils';
import { openWorldDialog } from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import type { UserDialogPreviousInstance } from '@/services/userDialogSessionCacheService';
import type { UserDialogRelationshipEvent } from '@/services/userDialogSessionCacheService';
import { parseLocation } from '@/shared/utils/location';
import { replaceBioSymbols } from '@/shared/utils/string';
import { useAssistantChatStore } from '@/state/assistantChatStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardAction,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import {
    Popover,
    PopoverContent,
    PopoverTitle,
    PopoverTrigger
} from '@/ui/shadcn/popover';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { EntityDialogTabContent } from '../../EntityDialogScaffold';
import { formatStatsDuration } from '../userDialogRows';
import { EntityList } from '../UserDialogViewParts';

type OpenGroupDialog =
    (typeof import('@/services/dialogService'))['openGroupDialog'];
type PresenceModel = {
    visiblePresenceLocation?: string;
    locationInstance?: EntityRecord & {
        capacity?: number;
        groupName?: string;
        recommendedCapacity?: number;
        shortName?: string;
    };
    locationOwnerId?: string;
    locationPlayerCount?: number;
    currentUserId?: string;
    currentEndpoint?: string;
    locationWorldTitle?: string;
    locationFriendCount?: number;
    previousInstances?: UserDialogPreviousInstance[];
    locationInstanceUsers?: EntityRecord[];
};
type RepresentedGroup = NonNullable<
    Awaited<
        ReturnType<
            typeof import('@/repositories/userProfileRepository').default.getRepresentedGroup
        >
    >
> & {
    id?: string;
    name?: string;
    iconUrl?: string;
    ownerId?: string;
    memberCount?: number;
    myMember?: EntityRecord;
    isRepresenting?: boolean;
    isSubscribedToAnnouncements?: boolean;
    visibility?: string;
    memberVisibility?: string;
    membershipStatus?: string;
};

export type UserDialogPresenceSectionProps = {
    presence: PresenceModel;
    actions: {
        onRefreshLocation?: (requestLocation: string) => void;
        onShowInstanceHistory?: () => void;
    };
};

export type UserDialogNotesSectionProps = {
    profile: UserProfileEntity;
    hideUserNotes: boolean;
    memo: string;
    hideUserMemos: boolean;
    onEditMemo?: () => void;
};

export type UserDialogBioSectionProps = {
    profile: UserProfileEntity;
    bioLinks: string[];
    onEditBio?: () => void;
};

export type UserDialogProfileLinksSectionProps = {
    currentAvatarDisplayName: string;
    isCurrentUser: boolean;
    representedGroupStatus: string;
    representedGroup: RepresentedGroup | null;
    openGroupDialog: OpenGroupDialog;
    profile: UserProfileEntity;
    visibleHomeLocationTarget: string;
};

export type UserDialogActivitySummarySectionProps = {
    friendedAt: string | null | undefined;
    relationshipHistory?: UserDialogRelationshipEvent[];
    isCurrentUser: boolean;
    isFriend: boolean;
    lastSeen: string | null | undefined;
    onOpenFeed?: () => void;
    onOpenInstanceHistory?: () => void;
    presenceActivityAt: string | null | undefined;
    profile: UserProfileEntity;
    userTimeSpent: number | null | undefined;
    userJoinCount: number | null | undefined;
};

export type UserDialogInfoTabProps = {
    presenceSection: UserDialogPresenceSectionProps;
    notesSection: UserDialogNotesSectionProps;
    bioSection: UserDialogBioSectionProps;
    profileLinksSection: UserDialogProfileLinksSectionProps;
    activitySummarySection: UserDialogActivitySummarySectionProps;
};

function InfoPanel({
    title,
    action,
    children,
    className,
    contentClassName
}: {
    title: ReactNode;
    action?: ReactNode;
    children?: ReactNode;
    className?: string;
    contentClassName?: string;
}) {
    return (
        <Card
            size="sm"
            className={cn(
                'ring-stroke-subtle min-w-0 border-0 shadow-none',
                className
            )}
        >
            <CardHeader>
                <CardTitle className="text-muted-foreground min-w-0 truncate text-xs font-medium">
                    {title}
                </CardTitle>
                {action ? <CardAction>{action}</CardAction> : null}
            </CardHeader>
            <CardContent
                className={cn('flex flex-col gap-3', contentClassName)}
            >
                {children}
            </CardContent>
        </Card>
    );
}

function InfoStat({
    label,
    value,
    children,
    mono = false,
    onClick,
    subtle = false,
    className
}: {
    label?: ReactNode;
    value?: string;
    children?: ReactNode;
    mono?: boolean;
    onClick?: () => void;
    subtle?: boolean;
    className?: string;
}) {
    const body = (
        <>
            <div className="min-w-0 flex-1">
                <span className="text-muted-foreground block truncate text-xs leading-snug">
                    {label}
                </span>
                {children || (
                    <span
                        className={cn(
                            'block truncate text-sm leading-snug font-medium',
                            mono ? 'font-mono text-xs font-normal' : '',
                            subtle
                                ? 'text-muted-foreground text-xs font-normal'
                                : ''
                        )}
                    >
                        {value || '\u2014'}
                    </span>
                )}
            </div>
            {onClick ? (
                <ChevronRightIcon
                    data-icon="inline-end"
                    className="text-muted-foreground ml-2 shrink-0 opacity-40 transition-[opacity,transform] group-hover/info-stat:translate-x-0.5 group-hover/info-stat:opacity-80 group-focus-visible/info-stat:opacity-80"
                />
            ) : null}
        </>
    );

    if (onClick) {
        return (
            <Button
                type="button"
                variant="ghost"
                className={cn(
                    'group/info-stat -mx-2 h-auto justify-start px-2 py-1.5 text-left font-normal',
                    className
                )}
                onClick={onClick}
            >
                {body}
            </Button>
        );
    }

    return (
        <div
            className={cn(
                '-mx-2 flex min-w-0 items-start px-2 py-1.5',
                className
            )}
        >
            {body}
        </div>
    );
}

function InfoStatGrid({
    children,
    className
}: {
    children?: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-1',
                className
            )}
        >
            {children}
        </div>
    );
}

function formatLocalizedActivityDate(
    value: unknown,
    locale: string | null | undefined,
    dateOnly = false
) {
    return formatDateTime(
        value,
        {
            dateStyle: 'medium',
            ...(dateOnly ? {} : { timeStyle: 'medium' })
        },
        {
            appLocale: locale || undefined,
            fallback: '\u2014'
        }
    );
}

function TextScroll({
    children,
    className
}: {
    children?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('max-h-52 overflow-auto', className)}>
            <pre className="text-muted-foreground m-0 min-w-0 font-sans text-xs whitespace-pre-wrap">
                {children || '\u2014'}
            </pre>
        </div>
    );
}

function AdaptiveTextBlock({
    children,
    className
}: {
    children?: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'max-h-40 min-h-7 overflow-auto rounded-md',
                className
            )}
        >
            <pre className="text-muted-foreground m-0 min-w-0 font-sans text-xs whitespace-pre-wrap">
                {children || '\u2014'}
            </pre>
        </div>
    );
}

function handlePanelKeyDown(
    event: { key: string; preventDefault(): void },
    onClick: (() => void) | undefined
) {
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }
    event.preventDefault();
    onClick?.();
}

function UserDialogPresenceSection({
    presence,
    actions
}: UserDialogPresenceSectionProps) {
    const { t } = useTranslation();
    const {
        visiblePresenceLocation = '',
        locationInstance = null,
        locationOwnerId = '',
        locationPlayerCount = 0,
        currentUserId = '',
        currentEndpoint = '',
        locationWorldTitle = '',
        locationFriendCount = 0,
        previousInstances = [],
        locationInstanceUsers = []
    } = presence || {};

    const isInstanceLocation = visiblePresenceLocation.includes(':');
    const worldId = isInstanceLocation
        ? parseLocation(visiblePresenceLocation).worldId
        : '';
    const worldIds = useMemo(() => (worldId ? [worldId] : []), [worldId]);
    const worldSummary = useWorldSummaries(worldIds).get(worldId);
    const worldThumbnailUrl = convertFileUrlToImageUrl(
        worldSummary?.thumbnailUrl,
        256
    );
    const worldTitle = locationWorldTitle || worldSummary?.name || worldId;

    if (!visiblePresenceLocation) {
        return null;
    }

    function openPresenceWorld() {
        openWorldDialog({
            worldId: visiblePresenceLocation,
            title: worldTitle || undefined
        });
    }

    return (
        <InfoPanel title={t('dialog.user.info.current_status')}>
            {isInstanceLocation ? (
                <InstanceActionBar
                    target={{
                        location: visiblePresenceLocation,
                        shortName:
                            locationInstance?.shortName ||
                            parseLocation(visiblePresenceLocation).shortName ||
                            '',
                        worldName: locationWorldTitle
                    }}
                    instance={locationInstance}
                    friendCount={locationFriendCount}
                    playerCount={locationPlayerCount}
                    capacity={
                        locationInstance?.capacity ??
                        locationInstance?.recommendedCapacity
                    }
                    refreshTooltip={t('dialog.user.info.refresh_instance_info')}
                    disableInstanceInfoTooltip={false}
                    instanceCountAlign="left"
                    actionVariant="prominent"
                    showHistory={Boolean(previousInstances.length)}
                    onRefresh={() =>
                        actions?.onRefreshLocation?.(visiblePresenceLocation)
                    }
                    onHistory={actions?.onShowInstanceHistory}
                    renderLayout={({ summary, actions: instanceActions }) => (
                        <div className="flex min-w-0 gap-3">
                            <button
                                type="button"
                                aria-label={worldTitle}
                                className="bg-muted focus-visible:ring-ring/50 flex h-18 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md transition-[filter] outline-none hover:brightness-110 focus-visible:ring-3"
                                onClick={openPresenceWorld}
                            >
                                {worldThumbnailUrl ? (
                                    <FadeInImage
                                        src={worldThumbnailUrl}
                                        alt=""
                                        className="size-full object-cover"
                                        fallback={
                                            <ImageIcon className="text-muted-foreground size-6 opacity-50" />
                                        }
                                    />
                                ) : (
                                    <ImageIcon className="text-muted-foreground size-6 opacity-50" />
                                )}
                            </button>
                            <div className="flex min-h-18 min-w-0 flex-1 flex-col justify-between gap-1.5">
                                <div className="flex min-w-0 flex-col gap-1">
                                    <button
                                        type="button"
                                        className="text-foreground/90 hover:text-foreground line-clamp-1 cursor-pointer text-left text-sm font-medium break-words transition-colors outline-none focus-visible:underline"
                                        title={worldTitle}
                                        onClick={openPresenceWorld}
                                    >
                                        {worldTitle}
                                    </button>
                                    <div className="text-muted-foreground flex min-w-0 items-center gap-3 text-xs">
                                        <LocationWorld
                                            className="min-w-0 shrink"
                                            locationObject={{
                                                ...locationInstance,
                                                tag: visiblePresenceLocation,
                                                location:
                                                    visiblePresenceLocation,
                                                userId: locationOwnerId,
                                                playerCount:
                                                    locationPlayerCount,
                                                capacity:
                                                    locationInstance?.capacity ??
                                                    locationInstance?.recommendedCapacity
                                            }}
                                            currentUserId={currentUserId}
                                            grouphint={
                                                locationInstance?.groupName ||
                                                ''
                                            }
                                            endpoint={currentEndpoint}
                                            hint={locationWorldTitle}
                                            instanceClickAction="world"
                                            showPlayerSummary={false}
                                            showWorldName={false}
                                        />
                                        <span className="shrink-0">
                                            {summary}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {instanceActions}
                                </div>
                            </div>
                        </div>
                    )}
                />
            ) : (
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Location
                        location={visiblePresenceLocation}
                        hint={locationWorldTitle}
                        disableTooltip
                        enableContextMenu
                        showLaunchActions
                    />
                </div>
            )}
            {locationInstanceUsers.length ? (
                <div className="-mx-2 max-h-60 min-h-10 overflow-auto rounded-md">
                    <EntityList
                        rows={locationInstanceUsers}
                        kind="user"
                        instanceLocation={visiblePresenceLocation}
                        showInstanceDuration
                    />
                </div>
            ) : null}
        </InfoPanel>
    );
}

function UserDialogNotesPanel({
    profile,
    hideUserNotes,
    memo,
    hideUserMemos,
    onEditMemo
}: UserDialogNotesSectionProps) {
    const { t } = useTranslation();
    const showNote = Boolean(profile.note && !hideUserNotes);
    const showMemo = Boolean(memo && !hideUserMemos);

    if (!showNote && !showMemo) {
        return null;
    }

    const showBoth = showNote && showMemo;
    const title = showBoth
        ? t('dialog.user.info.notes_memo')
        : showNote
          ? t('dialog.user.info.note')
          : t('dialog.user.info.memo');

    return (
        <InfoPanel title={title}>
            <div
                role="button"
                tabIndex={0}
                className="focus-visible:border-ring focus-visible:ring-ring/50 -mx-2 rounded-md p-2 text-left transition-colors outline-none hover:bg-(--state-hover-surface) focus-visible:ring-3"
                onClick={onEditMemo}
                onKeyDown={(event) => handlePanelKeyDown(event, onEditMemo)}
            >
                <div className="flex min-w-0 flex-col gap-3">
                    {showNote ? (
                        <div className="min-w-0">
                            {showBoth ? (
                                <span className="text-muted-foreground mb-1 block truncate text-xs">
                                    {t('dialog.user.info.note')}
                                </span>
                            ) : null}
                            <AdaptiveTextBlock>
                                {profile.note}
                            </AdaptiveTextBlock>
                        </div>
                    ) : null}
                    {showBoth ? <Separator /> : null}
                    {showMemo ? (
                        <div className="min-w-0">
                            {showBoth ? (
                                <span className="text-muted-foreground mb-1 block truncate text-xs">
                                    {t('dialog.user.info.memo')}
                                </span>
                            ) : null}
                            <AdaptiveTextBlock>{memo}</AdaptiveTextBlock>
                        </div>
                    ) : null}
                </div>
            </div>
        </InfoPanel>
    );
}

function buildRepresentedGroupSeedData(representedGroup: RepresentedGroup) {
    return {
        ...representedGroup,
        $memberId: representedGroup.id,
        id: representedGroup.groupId,
        myMember: {
            ...representedGroup.myMember,
            id: representedGroup.id,
            groupId: representedGroup.groupId,
            isRepresenting: Boolean(representedGroup.isRepresenting),
            isSubscribedToAnnouncements: Boolean(
                representedGroup.isSubscribedToAnnouncements
            ),
            visibility:
                representedGroup.visibility ||
                representedGroup.memberVisibility ||
                'visible',
            membershipStatus: representedGroup.membershipStatus || ''
        }
    };
}

function UserDialogProfileLinksPanel({
    currentAvatarDisplayName,
    isCurrentUser,
    representedGroupStatus,
    representedGroup,
    openGroupDialog,
    profile,
    visibleHomeLocationTarget
}: UserDialogProfileLinksSectionProps) {
    const { t } = useTranslation();
    const iconInfo = useAvatarImageInfo({
        imageUrl: isCurrentUser ? '' : profile?.iconUrl
    });
    const avatarInfo = isCurrentUser
        ? {
              avatarName: currentAvatarDisplayName,
              avatarTags: profile?.currentAvatarTags,
              imageUrl:
                  profile?.currentAvatarImageUrl ||
                  profile?.currentAvatarThumbnailImageUrl
          }
        : iconInfo.status === 'ready' && iconInfo.avatarName
          ? {
                avatarName: iconInfo.avatarName,
                ownerId: iconInfo.ownerId,
                imageUrl: profile?.iconUrl
            }
          : null;

    const representedGroupIconFallback = (
        <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
            <UsersRoundIcon aria-hidden="true" className="size-5" />
        </span>
    );

    return (
        <InfoPanel title={t('dialog.user.info.profile_details')}>
            {avatarInfo ? (
                <>
                    <InfoStat label={t('dialog.user.info.avatar_info')}>
                        <AvatarInfoLine
                            {...avatarInfo}
                            compact
                            userId={profile?.id}
                        />
                    </InfoStat>
                </>
            ) : null}
            {isCurrentUser ? null : (
                <InfoStat
                    label={t('dialog.user.info.avatar_cloning')}
                    value={t(
                        profile.allowAvatarCopying
                            ? 'dialog.user.info.avatar_cloning_allow'
                            : 'dialog.user.info.avatar_cloning_deny'
                    )}
                    subtle
                />
            )}
            {avatarInfo || !isCurrentUser ? <Separator /> : null}

            <InfoStat label={t('dialog.user.info.represented_group')}>
                {representedGroupStatus === 'running' ? (
                    <span className="text-muted-foreground block text-xs">
                        {t('dialog.user.loading.loading')}
                    </span>
                ) : representedGroup?.isRepresenting ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="hover:text-foreground h-auto max-w-full justify-start gap-2 p-0 text-left text-xs font-normal whitespace-normal text-inherit hover:bg-transparent"
                        onClick={() =>
                            openGroupDialog({
                                groupId: representedGroup.groupId,
                                title: representedGroup.name || undefined,
                                seedData:
                                    buildRepresentedGroupSeedData(
                                        representedGroup
                                    )
                            })
                        }
                    >
                        {representedGroup.iconUrl ? (
                            <FadeInImage
                                src={convertFileUrlToImageUrl(
                                    representedGroup.iconUrl,
                                    128
                                )}
                                alt=""
                                className="size-10 shrink-0 rounded-md object-cover"
                                fallback={representedGroupIconFallback}
                            />
                        ) : (
                            representedGroupIconFallback
                        )}
                        <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-1.5">
                                {representedGroup.ownerId === profile.id && (
                                    <HintTooltip
                                        label={t('dialog.group.label.owner_2')}
                                    >
                                        <span
                                            role="img"
                                            className="inline-flex shrink-0"
                                        >
                                            <CrownIcon className="text-muted-foreground size-3.5 shrink-0" />
                                        </span>
                                    </HintTooltip>
                                )}
                                <span className="truncate">
                                    {representedGroup.name || 'Group'}
                                </span>
                            </span>
                            <span className="text-muted-foreground block truncate">
                                {representedGroup.memberCount
                                    ? t(
                                          'host.tools_dialogs.group_moderation.member_count',
                                          {
                                              count: representedGroup.memberCount
                                          }
                                      )
                                    : ''}
                            </span>
                        </span>
                    </Button>
                ) : (
                    <span className="text-muted-foreground block text-xs">
                        {'\u2014'}
                    </span>
                )}
            </InfoStat>

            {visibleHomeLocationTarget ? (
                <>
                    <Separator />
                    <InfoStat label={t('dialog.user.info.home_location')}>
                        <Location
                            location={visibleHomeLocationTarget}
                            disableTooltip
                            enableContextMenu
                            showLaunchActions
                        />
                    </InfoStat>
                </>
            ) : null}
        </InfoPanel>
    );
}

export function UserDialogBioPanel({
    profile,
    bioLinks,
    onEditBio
}: UserDialogBioSectionProps) {
    const { t } = useTranslation();
    const editLabel = t('dialog.user.actions.edit_profile');

    if (!profile.bio?.trim() && !bioLinks.length && !onEditBio) {
        return null;
    }

    return (
        <TranslatableText
            source={replaceBioSymbols(profile.bio)}
            entityId={profile.id || ''}
            density="button"
        >
            {({ action, meta, error, text }) => (
                <InfoPanel
                    title={t('dialog.user.info.bio')}
                    action={
                        onEditBio ? (
                            <div className="flex items-center gap-1">
                                {action}
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                type="button"
                                                size="icon-xs"
                                                variant="ghost"
                                                className="text-muted-foreground"
                                                aria-label={editLabel}
                                                onClick={onEditBio}
                                            >
                                                <PencilIcon data-icon="inline-start" />
                                            </Button>
                                        }
                                    />
                                    <TooltipContent>{editLabel}</TooltipContent>
                                </Tooltip>
                            </div>
                        ) : (
                            action
                        )
                    }
                >
                    {meta}
                    <div className="min-w-0">
                        <TextScroll className="min-w-0">{text}</TextScroll>
                        {error}
                    </div>
                    {bioLinks.length ? (
                        <div className="flex flex-wrap gap-1.5">
                            {bioLinks.map((link) => (
                                <Button
                                    key={link}
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={t(
                                        'dialog.user.info.open_bio_link',
                                        {
                                            link
                                        }
                                    )}
                                    title={link}
                                    onClick={() => openExternalLink(link)}
                                >
                                    <BioLinkFavicon
                                        link={link}
                                        fallback={
                                            <ExternalLinkIcon data-icon="inline-start" />
                                        }
                                    />
                                </Button>
                            ))}
                        </div>
                    ) : null}
                </InfoPanel>
            )}
        </TranslatableText>
    );
}

function UserRelationshipStat({
    friendedAt,
    history
}: {
    friendedAt: string | null | undefined;
    history: UserDialogRelationshipEvent[];
}) {
    const { i18n, t } = useTranslation();
    const locale = i18n.resolvedLanguage || i18n.language;
    const latest = history[0];
    const stat = (
        <InfoStat
            label={t(
                latest?.type === 'Unfriend'
                    ? 'dialog.user.info.unfriended'
                    : 'dialog.user.info.friended'
            )}
            value={formatLocalizedActivityDate(
                latest?.created_at || friendedAt,
                locale
            )}
            subtle
            className={latest ? 'mx-0' : undefined}
        />
    );
    if (!latest) {
        return stat;
    }
    return (
        <Popover>
            <PopoverTrigger
                render={
                    <Button
                        variant="ghost"
                        className="group/info-stat -mx-2 h-auto justify-start p-0 text-left font-normal"
                    />
                }
            >
                <div className="min-w-0 flex-1">{stat}</div>
                <ChevronRightIcon
                    aria-hidden="true"
                    className="text-muted-foreground mr-2 shrink-0 opacity-40 transition-[opacity,transform] group-hover/info-stat:translate-x-0.5 group-hover/info-stat:opacity-80 group-focus-visible/info-stat:opacity-80 group-aria-expanded/info-stat:opacity-80"
                />
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-64 max-w-[calc(100vw-2rem)] gap-3 p-3"
            >
                <PopoverTitle className="text-xs">
                    {t('dialog.user.info.relationship_history')}
                </PopoverTitle>
                <Timeline
                    value={0}
                    className="max-h-72 overflow-y-auto overscroll-contain"
                    render={<ol />}
                >
                    {history.map((entry, index) => (
                        <TimelineItem
                            key={entry.rowId}
                            step={index + 1}
                            render={<li />}
                            className="group-data-[orientation=vertical]/timeline:ms-5 group-data-[orientation=vertical]/timeline:not-last:pb-3"
                        >
                            <TimelineHeader>
                                <TimelineTitle className="text-xs">
                                    {t(`view.friend_log.filters.${entry.type}`)}
                                </TimelineTitle>
                                <TimelineDate
                                    dateTime={entry.created_at}
                                    className="mt-0.5 mb-0 font-normal group-data-[orientation=vertical]/timeline:max-sm:h-auto"
                                >
                                    {formatLocalizedActivityDate(
                                        entry.created_at,
                                        locale
                                    )}
                                </TimelineDate>
                            </TimelineHeader>
                            <TimelineIndicator className="size-2 group-data-[orientation=vertical]/timeline:top-1 group-data-[orientation=vertical]/timeline:-left-3.5" />
                            <TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-3.5 group-data-[orientation=vertical]/timeline:h-[calc(100%-0.75rem)] group-data-[orientation=vertical]/timeline:translate-y-3.5" />
                        </TimelineItem>
                    ))}
                </Timeline>
            </PopoverContent>
        </Popover>
    );
}

function UserCreditsStat({ userId }: { userId: string }) {
    const { t } = useTranslation();
    const balance = useEconomyBalance(userId, true);

    return (
        <InfoStat
            label={t('dialog.user.info.vrc_credits')}
            value={
                typeof balance.data === 'number'
                    ? formatCredits(balance.data)
                    : ''
            }
            onClick={() => {
                void balance.refetch();
                useRuntimeStore
                    .getState()
                    .setSystemHostOpen('purchaseHistoryOpen', true);
            }}
            subtle
        />
    );
}

export function UserDialogActivitySummaryPanel({
    friendedAt,
    relationshipHistory = [],
    isCurrentUser,
    isFriend,
    lastSeen,
    onOpenFeed,
    onOpenInstanceHistory,
    presenceActivityAt,
    profile,
    userTimeSpent,
    userJoinCount
}: UserDialogActivitySummarySectionProps) {
    const { i18n, t } = useTranslation();
    const dateLocale = i18n.resolvedLanguage || i18n.language;

    return (
        <InfoPanel
            title={t('dialog.user.info.activity_summary')}
            contentClassName="gap-1"
            action={
                !isCurrentUser && profile.id ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    size="icon-xs"
                                    variant="ghost"
                                    className="text-muted-foreground"
                                    aria-label={t('assistant.title')}
                                    onClick={() =>
                                        useAssistantChatStore
                                            .getState()
                                            .startAssistantDraft({
                                                topic: 'profile',
                                                target: {
                                                    kind: 'user',
                                                    id: profile.id ?? '',
                                                    name:
                                                        profile.displayName ||
                                                        profile.id ||
                                                        ''
                                                }
                                            })
                                    }
                                >
                                    <SparklesIcon data-icon="inline-start" />
                                </Button>
                            }
                        />
                        <TooltipContent>{t('assistant.title')}</TooltipContent>
                    </Tooltip>
                ) : null
            }
        >
            <InfoStatGrid className="sm:grid-cols-1">
                {!isCurrentUser ? (
                    <InfoStat
                        label={t('dialog.user.info.last_seen')}
                        value={formatLocalizedActivityDate(
                            lastSeen,
                            dateLocale
                        )}
                        subtle
                    />
                ) : null}
                <InfoStat
                    label={t('dialog.user.info.last_activity')}
                    value={formatLocalizedActivityDate(
                        presenceActivityAt,
                        dateLocale
                    )}
                    onClick={isFriend ? onOpenFeed : undefined}
                    subtle
                />
                {isCurrentUser ? (
                    <InfoStat
                        label={t('dialog.user.info.play_time')}
                        value={formatStatsDuration(userTimeSpent)}
                        onClick={onOpenInstanceHistory}
                        subtle
                    />
                ) : (
                    <>
                        <InfoStat
                            label={t('dialog.user.info.join_count')}
                            value={
                                userJoinCount ? String(userJoinCount) : '\u2014'
                            }
                            onClick={onOpenInstanceHistory}
                            subtle
                        />
                        <InfoStat
                            label={t('dialog.user.info.time_together')}
                            value={formatStatsDuration(userTimeSpent)}
                            subtle
                        />
                        <UserRelationshipStat
                            friendedAt={friendedAt}
                            history={relationshipHistory}
                        />
                    </>
                )}
                {isCurrentUser && profile.id ? (
                    <UserCreditsStat userId={profile.id} />
                ) : null}
            </InfoStatGrid>
        </InfoPanel>
    );
}

const MemoPresenceSection = memo(
    UserDialogPresenceSection,
    (prev, next) =>
        shallow(prev.presence, next.presence) &&
        shallow(prev.actions, next.actions)
);
const MemoNotesPanel = memo(UserDialogNotesPanel);
const MemoBioPanel = memo(UserDialogBioPanel);
const MemoProfileLinksPanel = memo(UserDialogProfileLinksPanel);
const MemoActivitySummaryPanel = memo(UserDialogActivitySummaryPanel);

export function UserDialogInfoTab({
    presenceSection,
    notesSection,
    bioSection,
    profileLinksSection,
    activitySummarySection
}: UserDialogInfoTabProps) {
    const { profile, bioLinks, onEditBio } = bioSection;

    return (
        <EntityDialogTabContent value="info" className="pt-3">
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="flex min-w-0 flex-col gap-4">
                    <MemoPresenceSection
                        presence={presenceSection.presence}
                        actions={presenceSection.actions}
                    />
                    <MemoNotesPanel
                        profile={notesSection.profile}
                        hideUserNotes={notesSection.hideUserNotes}
                        memo={notesSection.memo}
                        hideUserMemos={notesSection.hideUserMemos}
                        onEditMemo={notesSection.onEditMemo}
                    />
                    <MemoBioPanel
                        profile={profile}
                        bioLinks={bioLinks}
                        onEditBio={onEditBio}
                    />
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                    <MemoProfileLinksPanel
                        currentAvatarDisplayName={
                            profileLinksSection.currentAvatarDisplayName
                        }
                        isCurrentUser={profileLinksSection.isCurrentUser}
                        representedGroupStatus={
                            profileLinksSection.representedGroupStatus
                        }
                        representedGroup={profileLinksSection.representedGroup}
                        openGroupDialog={profileLinksSection.openGroupDialog}
                        profile={profileLinksSection.profile}
                        visibleHomeLocationTarget={
                            profileLinksSection.visibleHomeLocationTarget
                        }
                    />
                    <MemoActivitySummaryPanel
                        friendedAt={activitySummarySection.friendedAt}
                        relationshipHistory={
                            activitySummarySection.relationshipHistory
                        }
                        isCurrentUser={activitySummarySection.isCurrentUser}
                        isFriend={activitySummarySection.isFriend}
                        lastSeen={activitySummarySection.lastSeen}
                        onOpenFeed={activitySummarySection.onOpenFeed}
                        onOpenInstanceHistory={
                            activitySummarySection.onOpenInstanceHistory
                        }
                        presenceActivityAt={
                            activitySummarySection.presenceActivityAt
                        }
                        profile={activitySummarySection.profile}
                        userTimeSpent={activitySummarySection.userTimeSpent}
                        userJoinCount={activitySummarySection.userJoinCount}
                    />
                </div>
            </div>
        </EntityDialogTabContent>
    );
}
