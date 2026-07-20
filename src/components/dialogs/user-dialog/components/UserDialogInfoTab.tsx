import { ChevronRightIcon, ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { Location } from '@/components/Location';
import { LocationWorld } from '@/components/LocationWorld';
import { FadeInImage } from '@/components/media/FadeInImage';
import type {
    EntityRecord,
    UserProfileEntity
} from '@/domain/entities/profileEntities';
import { AvatarInfoLine } from '@/features/feed/components/FeedAvatarInfoLine';
import { TranslatableText } from '@/features/translation/components/TranslatableText';
import { formatDateTime } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import { getFaviconUrl } from '@/shared/utils/urlUtils';
import { Button } from '@/ui/shadcn/button';
import {
    Card,
    CardAction,
    CardContent,
    CardHeader,
    CardTitle
} from '@/ui/shadcn/card';
import { Separator } from '@/ui/shadcn/separator';

import { EntityDialogTabContent } from '../../EntityDialogScaffold';
import { formatStatsDuration } from '../userDialogRows';
import { EntityList } from '../UserDialogViewParts';

type OpenAvatarDialog =
    (typeof import('@/services/dialogService'))['openAvatarDialog'];
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
    previousInstances?: unknown[];
    locationInstanceUsers?: EntityRecord[];
};
type RepresentedGroup = NonNullable<
    Awaited<
        ReturnType<
            typeof import('@/repositories/userProfileRepository').getRepresentedGroup
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
        onRefreshLocation?: (requestLocation: unknown) => unknown;
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
    currentAvatarTarget: string;
    currentAvatarDialogArgs: Parameters<OpenAvatarDialog>[0];
    currentAvatarDisplayName: string;
    isCurrentUser: boolean;
    openAvatarDialog: OpenAvatarDialog;
    representedGroupStatus: string;
    representedGroup: RepresentedGroup | null;
    openGroupDialog: OpenGroupDialog;
    profile: UserDialogInfoProfile;
    visibleHomeLocationTarget: string;
};

export type UserDialogActivitySummarySectionProps = {
    friendedAt: string | null | undefined;
    isCurrentUser: boolean;
    lastSeen: string | null | undefined;
    onOpenInstanceHistory?: () => void;
    presenceActivityAt: string | null | undefined;
    profile: UserDialogInfoProfile;
    userTimeSpent: number | null | undefined;
    userJoinCount: number | null | undefined;
    previousInstances: unknown[];
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
            className={cn('min-w-0 border shadow-none ring-0', className)}
        >
            <CardHeader className="border-b pb-3">
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
                                ...(locationInstance || {}),
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
                    <EntityList rows={locationInstanceUsers} kind="user" />
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
            ...(representedGroup.myMember || {}),
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
                        className="hover:text-primary h-auto max-w-full justify-start gap-2 p-0 text-left text-xs font-normal whitespace-normal text-inherit"
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
                                    {getFaviconUrl(link) ? (
                                        <FadeInImage
                                            src={getFaviconUrl(link)}
                                            alt=""
                                            className="size-4"
                                        />
                                    ) : (
                                        <ExternalLinkIcon data-icon="inline-start" />
                                    )}
                                </Button>
                            ))}
                        </div>
                    ) : null}
                </InfoPanel>
            )}
        </TranslatableText>
    );
}

function UserDialogActivitySummaryPanel({
    friendedAt,
    isCurrentUser,
    lastSeen,
    onOpenInstanceHistory,
    presenceActivityAt,
    profile,
    userTimeSpent,
    userJoinCount,
    previousInstances
}: UserDialogActivitySummarySectionProps) {
    const { i18n, t } = useTranslation();
    const dateLocale = i18n.resolvedLanguage || i18n.language;
    const openHistory = previousInstances.length
        ? onOpenInstanceHistory
        : undefined;

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
                    subtle
                />
                <InfoStat
                    label={t('dialog.user.info.friended')}
                    value={formatLocalizedActivityDate(friendedAt, dateLocale)}
                    subtle
                />
                <InfoStat
                    label={t('dialog.user.info.date_joined')}
                    value={formatLocalizedActivityDate(
                        profile.date_joined,
                        dateLocale,
                        true
                    )}
                    subtle
                />
                {isCurrentUser ? (
                    <InfoStat
                        label={t('dialog.user.info.play_time')}
                        value={formatStatsDuration(userTimeSpent)}
                        onClick={openHistory}
                        subtle
                    />
                ) : (
                    <>
                        <InfoStat
                            label={t('dialog.user.info.join_count')}
                            value={
                                userJoinCount ? String(userJoinCount) : '\u2014'
                            }
                            onClick={openHistory}
                            subtle
                        />
                        <InfoStat
                            label={t('dialog.user.info.time_together')}
                            value={formatStatsDuration(userTimeSpent)}
                            onClick={openHistory}
                            subtle
                        />
                    </>
                )}
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
                        currentAvatarTarget={
                            profileLinksSection.currentAvatarTarget
                        }
                        currentAvatarDialogArgs={
                            profileLinksSection.currentAvatarDialogArgs
                        }
                        currentAvatarDisplayName={
                            profileLinksSection.currentAvatarDisplayName
                        }
                        isCurrentUser={profileLinksSection.isCurrentUser}
                        openAvatarDialog={profileLinksSection.openAvatarDialog}
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
                        isCurrentUser={activitySummarySection.isCurrentUser}
                        lastSeen={activitySummarySection.lastSeen}
                        onOpenInstanceHistory={
                            activitySummarySection.onOpenInstanceHistory
                        }
                        presenceActivityAt={
                            activitySummarySection.presenceActivityAt
                        }
                        profile={activitySummarySection.profile}
                        userTimeSpent={activitySummarySection.userTimeSpent}
                        userJoinCount={activitySummarySection.userJoinCount}
                        previousInstances={
                            activitySummarySection.previousInstances
                        }
                    />
                </div>
            </div>
        </EntityDialogTabContent>
    );
}
