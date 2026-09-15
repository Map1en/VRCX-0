import { ChevronRightIcon, ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AvatarInfoLine } from '@/components/feed/FeedAvatarInfoLine';
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
import { cn } from '@/lib/utils';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import type { UserDialogPreviousInstance } from '@/services/userDialogSessionCacheService';
import type { UserDialogRelationshipEvent } from '@/services/userDialogSessionCacheService';
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

import { EntityDialogTabContent } from '../../EntityDialogScaffold';
import { formatStatsDuration } from '../userDialogRows';
import { EntityList } from '../UserDialogViewParts';

type OpenGroupDialog =
    (typeof import('@/services/dialogService'))['openGroupDialog'];
type UserDialogInfoProfile = UserProfileEntity & {
    $location?: { groupName?: string; shortName?: string };
};
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
    profile: UserDialogInfoProfile;
};

export type UserDialogNotesSectionProps = {
    profile: UserDialogInfoProfile;
    hideUserNotes: boolean;
    memo: string;
    hideUserMemos: boolean;
    onEditMemo?: () => void;
};

export type UserDialogBioSectionProps = {
    profile: UserDialogInfoProfile;
    bioLinks: string[];
};

export type UserDialogProfileLinksSectionProps = {
    currentAvatarDisplayName: string;
    isCurrentUser: boolean;
    representedGroupStatus: string;
    representedGroup: RepresentedGroup | null;
    openGroupDialog: OpenGroupDialog;
    profile: UserDialogInfoProfile;
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
    profile: UserDialogInfoProfile;
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
            <CardHeader className="border-stroke-subtle border-b pb-3">
                <CardTitle className="min-w-0 truncate text-sm">
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
    subtle = false
}: {
    label?: ReactNode;
    value?: string;
    children?: ReactNode;
    mono?: boolean;
    onClick?: () => void;
    subtle?: boolean;
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
                    className="text-muted-foreground ml-2 shrink-0 opacity-70 transition-transform group-hover/info-stat:translate-x-0.5"
                />
            ) : null}
        </>
    );

    if (onClick) {
        return (
            <Button
                type="button"
                variant="ghost"
                className="group/info-stat h-auto w-full justify-start px-2 py-1.5 text-left"
                onClick={onClick}
            >
                {body}
            </Button>
        );
    }

    return <div className="flex min-w-0 items-start px-2 py-1.5">{body}</div>;
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
    className = 'h-52'
}: {
    children?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('overflow-auto', className)}>
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
    actions,
    profile
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

    if (!visiblePresenceLocation) {
        return null;
    }

    return (
        <InfoPanel title={t('dialog.user.info.current_status')}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {visiblePresenceLocation.includes(':') ? (
                    <>
                        <LocationWorld
                            className="min-w-0"
                            locationObject={{
                                ...locationInstance,
                                tag: visiblePresenceLocation,
                                location: visiblePresenceLocation,
                                userId: locationOwnerId,
                                playerCount: locationPlayerCount,
                                capacity:
                                    locationInstance?.capacity ??
                                    locationInstance?.recommendedCapacity
                            }}
                            currentUserId={currentUserId}
                            grouphint={
                                locationInstance?.groupName ||
                                profile.$location?.groupName ||
                                ''
                            }
                            endpoint={currentEndpoint}
                            hint={locationWorldTitle}
                            instanceClickAction="world"
                            disableTooltip
                            showPlayerSummary={false}
                        />
                        <InstanceActionBar
                            className="min-w-0 flex-wrap"
                            target={{
                                location: visiblePresenceLocation,
                                shortName:
                                    locationInstance?.shortName ||
                                    profile?.$location?.shortName ||
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
                            refreshTooltip={t(
                                'dialog.user.info.refresh_instance_info'
                            )}
                            disableTooltip
                            disableInstanceInfoTooltip={false}
                            showHistory={Boolean(previousInstances.length)}
                            onRefresh={() =>
                                actions?.onRefreshLocation?.(
                                    visiblePresenceLocation
                                )
                            }
                            onHistory={actions?.onShowInstanceHistory}
                        />
                    </>
                ) : (
                    <Location
                        location={visiblePresenceLocation}
                        hint={locationWorldTitle}
                        disableTooltip
                        enableContextMenu
                        showLaunchActions
                    />
                )}
            </div>
            {locationInstanceUsers.length ? (
                <div className="max-h-60 min-h-10 overflow-auto rounded-md">
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

    return (
        <InfoPanel title={t('dialog.user.info.notes_memo')}>
            <div
                role="button"
                tabIndex={0}
                className="hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 rounded-md p-2 text-left transition-colors outline-none focus-visible:ring-3"
                onClick={onEditMemo}
                onKeyDown={(event) => handlePanelKeyDown(event, onEditMemo)}
            >
                <div className="flex min-w-0 flex-col gap-3">
                    {showNote ? (
                        <div className="min-w-0">
                            <span className="text-muted-foreground block truncate text-xs">
                                {t('dialog.user.info.note')}
                            </span>
                            <AdaptiveTextBlock className="mt-1">
                                {profile.note}
                            </AdaptiveTextBlock>
                        </div>
                    ) : null}
                    {showNote && showMemo ? <Separator /> : null}
                    {showMemo ? (
                        <div className="min-w-0">
                            <span className="text-muted-foreground block truncate text-xs">
                                {t('dialog.user.info.memo')}
                            </span>
                            <AdaptiveTextBlock className="mt-1">
                                {memo}
                            </AdaptiveTextBlock>
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
    const avatarInfoTitle =
        !isCurrentUser &&
        profile?.profilePicOverride &&
        profile?.currentAvatarImageUrl
            ? t('dialog.user.info.avatar_info_last_seen')
            : t('dialog.user.info.avatar_info');
    const currentAvatarImageUrl =
        profile?.currentAvatarImageUrl ||
        profile?.currentAvatarThumbnailImageUrl;

    return (
        <InfoPanel title={t('dialog.user.info.profile_details')}>
            <InfoStat label={avatarInfoTitle}>
                <AvatarInfoLine
                    avatarName={
                        isCurrentUser ? currentAvatarDisplayName : undefined
                    }
                    avatarTags={profile?.currentAvatarTags}
                    compact
                    imageUrl={currentAvatarImageUrl}
                    userId={profile?.id}
                />
            </InfoStat>

            <Separator />

            <InfoStat label={t('dialog.user.info.represented_group')}>
                {representedGroupStatus === 'running' ? (
                    <span className="text-muted-foreground block text-xs">
                        {t('dialog.user.loading.loading')}
                    </span>
                ) : representedGroup?.isRepresenting ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="hover:text-primary h-auto max-w-full justify-start gap-2 p-0 text-left text-xs font-normal whitespace-normal text-inherit hover:bg-transparent"
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
                            />
                        ) : null}
                        <span className="min-w-0">
                            <span className="block truncate">
                                {representedGroup.ownerId === profile.id
                                    ? 'Owner - '
                                    : ''}
                                {representedGroup.name || 'Group'}
                            </span>
                            <span className="text-muted-foreground block truncate">
                                {representedGroup.memberCount
                                    ? `${representedGroup.memberCount} members`
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

function UserDialogBioPanel({ profile, bioLinks }: UserDialogBioSectionProps) {
    const { t } = useTranslation();

    return (
        <TranslatableText
            source={profile.bio || ''}
            entityId={profile.id || ''}
            density="button"
        >
            {({ action, meta, error, text }) => (
                <InfoPanel title={t('dialog.user.info.bio')} action={action}>
                    {meta}
                    <div className="min-w-0">
                        <TextScroll className="h-52 min-w-0">{text}</TextScroll>
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
                        className="group/info-stat h-auto w-full justify-start p-0 text-left"
                    />
                }
            >
                <div className="min-w-0 flex-1">{stat}</div>
                <ChevronRightIcon
                    aria-hidden="true"
                    className="text-muted-foreground mr-2 shrink-0 opacity-70 transition-transform group-hover/info-stat:translate-x-0.5"
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
                <InfoStat
                    label={t('dialog.user.info.date_joined')}
                    value={formatLocalizedActivityDate(
                        profile.date_joined,
                        dateLocale,
                        true
                    )}
                    subtle
                />
            </InfoStatGrid>
        </InfoPanel>
    );
}

export function UserDialogInfoTab({
    presenceSection,
    notesSection,
    bioSection,
    profileLinksSection,
    activitySummarySection
}: UserDialogInfoTabProps) {
    const { profile, bioLinks } = bioSection;

    return (
        <EntityDialogTabContent value="info" className="px-px pt-3 pb-px">
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="flex min-w-0 flex-col gap-4">
                    <UserDialogPresenceSection
                        presence={presenceSection.presence}
                        actions={presenceSection.actions}
                        profile={presenceSection.profile}
                    />
                    <UserDialogNotesPanel
                        profile={notesSection.profile}
                        hideUserNotes={notesSection.hideUserNotes}
                        memo={notesSection.memo}
                        hideUserMemos={notesSection.hideUserMemos}
                        onEditMemo={notesSection.onEditMemo}
                    />
                    <UserDialogBioPanel profile={profile} bioLinks={bioLinks} />
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                    <UserDialogProfileLinksPanel
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
                    <UserDialogActivitySummaryPanel
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
