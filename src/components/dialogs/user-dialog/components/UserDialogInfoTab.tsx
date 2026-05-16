// @ts-nocheck
import {
    ChevronRightIcon,
    ExternalLinkIcon,
    LanguagesIcon,
    UserIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { InstanceActionBar } from '@/components/instances/InstanceActionBar';
import { Location } from '@/components/Location';
import { LocationWorld } from '@/components/LocationWorld';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { getFaviconUrl } from '@/shared/utils/urlUtils.js';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Separator } from '@/ui/shadcn/separator';
import { Spinner } from '@/ui/shadcn/spinner';

import { EntityDialogTabContent } from '../../EntityDialogScaffold';
import {
    formatDate,
    formatDateOnly,
    formatStatsDate,
    formatStatsDuration
} from '../userDialogRows.js';
import { EntityList } from '../UserDialogViewParts';
import { useUserBioTranslation } from '../useUserBioTranslation.js';

function InfoPanel({ title, children, className, contentClassName }) {
    return (
        <Card
            size="sm"
            className={cn('min-w-0 border shadow-none ring-0', className)}
        >
            <CardHeader className="border-b pb-3">
                <CardTitle className="text-sm">{title}</CardTitle>
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

function InfoStatGrid({ children, className }) {
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

function TextScroll({ children, className = 'h-52' }) {
    return (
        <div className={cn('overflow-auto rounded-md', className)}>
            <pre className="text-muted-foreground m-0 min-w-0 font-sans text-xs whitespace-pre-wrap">
                {children || '\u2014'}
            </pre>
        </div>
    );
}

function AdaptiveTextBlock({ children, className }) {
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

function handlePanelKeyDown(event, onClick) {
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }
    event.preventDefault();
    onClick?.();
}

function UserDialogPresenceSection({ presence, presenceActions, profile }) {
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
                            onRefresh={presenceActions?.onRefreshLocation}
                            onHistory={presenceActions?.onShowInstanceHistory}
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
}) {
    const { t } = useTranslation();
    const showNote = Boolean(profile.note && !hideUserNotes);
    const showMemo = Boolean(memo && !hideUserMemos);

    if (!showNote && !showMemo) {
        return null;
    }

    return (
        <InfoPanel title={t('dialog.user.info.notes_memo')}>
            {showNote ? (
                <div
                    role="button"
                    tabIndex={0}
                    className="hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 rounded-md p-2 text-left transition-colors outline-none focus-visible:ring-3"
                    onClick={onEditMemo}
                    onKeyDown={(event) => handlePanelKeyDown(event, onEditMemo)}
                >
                    <div className="min-w-0 flex-1">
                        <span className="text-muted-foreground block truncate text-xs">
                            {t('dialog.user.info.note')}
                        </span>
                        <AdaptiveTextBlock className="mt-1">
                            {profile.note}
                        </AdaptiveTextBlock>
                    </div>
                </div>
            ) : null}
            {showNote && showMemo ? <Separator /> : null}
            {showMemo ? (
                <div
                    role="button"
                    tabIndex={0}
                    className="hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 rounded-md p-2 text-left transition-colors outline-none focus-visible:ring-3"
                    onClick={onEditMemo}
                    onKeyDown={(event) => handlePanelKeyDown(event, onEditMemo)}
                >
                    <div className="min-w-0 flex-1">
                        <span className="text-muted-foreground block truncate text-xs">
                            {t('dialog.user.info.memo')}
                        </span>
                        <AdaptiveTextBlock className="mt-1">
                            {memo}
                        </AdaptiveTextBlock>
                    </div>
                </div>
            ) : null}
        </InfoPanel>
    );
}

function buildRepresentedGroupSeedData(representedGroup) {
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
    currentAvatarTarget,
    currentAvatarDialogArgs,
    currentAvatarDisplayName,
    openAvatarDialog,
    representedGroupStatus,
    representedGroup,
    openGroupDialog,
    profile,
    visibleHomeLocationTarget
}) {
    const { t } = useTranslation();

    return (
        <InfoPanel title={t('dialog.user.info.profile_details')}>
            <InfoStat label={t('dialog.user.info.avatar_info')}>
                {currentAvatarTarget ? (
                    <Button
                        type="button"
                        variant="ghost"
                        className="hover:text-primary h-auto max-w-full justify-start p-0 text-left text-xs"
                        onClick={() =>
                            openAvatarDialog(currentAvatarDialogArgs)
                        }
                    >
                        <UserIcon data-icon="inline-start" />
                        <span className="truncate">
                            {currentAvatarDisplayName ||
                                t('dialog.user.info.unknown_avatar')}
                        </span>
                    </Button>
                ) : (
                    <span className="block truncate text-xs">{'\u2014'}</span>
                )}
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
                            <img
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

function UserDialogBioPanel({
    profile,
    bioLinks,
    visibleBio,
    bioTranslationLoading,
    translatedBioActive,
    toggleBioTranslation
}) {
    const { t } = useTranslation();
    const translateBioLabel = t('dialog.user.info.translate_bio');
    const showOriginalBioLabel = t('dialog.user.info.show_original_bio');
    const bioActionLabel = translatedBioActive
        ? showOriginalBioLabel
        : translateBioLabel;

    return (
        <InfoPanel title={t('dialog.user.info.bio')}>
            <div className="relative min-w-0">
                <TextScroll className="h-52 min-w-0 pr-8">
                    {visibleBio}
                </TextScroll>
                {profile.bio ? (
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="absolute top-1 right-1"
                        disabled={bioTranslationLoading}
                        aria-label={bioActionLabel}
                        title={bioActionLabel}
                        onClick={() => void toggleBioTranslation()}
                    >
                        {bioTranslationLoading ? (
                            <Spinner data-icon="inline-start" />
                        ) : (
                            <LanguagesIcon data-icon="inline-start" />
                        )}
                    </Button>
                ) : null}
            </div>
            {bioLinks.length ? (
                <div className="flex flex-wrap gap-1.5">
                    {bioLinks.map((link) => (
                        <Button
                            key={link}
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t('dialog.user.info.open_bio_link', {
                                link
                            })}
                            title={link}
                            onClick={() => openExternalLink(link)}
                        >
                            {getFaviconUrl(link) ? (
                                <img
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
    );
}

function UserDialogActivitySummaryPanel({
    isCurrentUser,
    lastSeen,
    onOpenInstanceHistory,
    profile,
    userTimeSpent,
    userJoinCount,
    previousInstances
}) {
    const { t } = useTranslation();
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
                        value={formatStatsDate(lastSeen)}
                        subtle
                    />
                ) : null}
                <InfoStat
                    label={t('dialog.user.info.last_login')}
                    value={formatDate(
                        profile.last_login || profile.last_activity
                    )}
                    subtle
                />
                <InfoStat
                    label={t('dialog.user.info.last_activity')}
                    value={formatDate(profile.last_activity)}
                    subtle
                />
                <InfoStat
                    label={t('dialog.user.info.date_joined')}
                    value={formatDateOnly(profile.date_joined)}
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
    presence,
    presenceActions,
    onOpenInstanceHistory,
    profile,
    hideUserNotes,
    onEditMemo,
    memo,
    hideUserMemos,
    currentAvatarTarget,
    currentAvatarDialogArgs,
    currentAvatarDisplayName,
    openAvatarDialog,
    representedGroupStatus,
    representedGroup,
    openGroupDialog,
    bioLinks,
    isCurrentUser,
    lastSeen,
    userTimeSpent,
    userJoinCount,
    visibleHomeLocationTarget
}) {
    const {
        visibleBio,
        bioTranslationLoading,
        translatedBioActive,
        toggleBioTranslation
    } = useUserBioTranslation({ profile });
    const previousInstances = presence?.previousInstances || [];

    return (
        <EntityDialogTabContent value="info" className="px-px pt-3 pb-px">
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="flex min-w-0 flex-col gap-4">
                    <UserDialogPresenceSection
                        presence={presence}
                        presenceActions={presenceActions}
                        profile={profile}
                    />
                    <UserDialogNotesPanel
                        profile={profile}
                        hideUserNotes={hideUserNotes}
                        memo={memo}
                        hideUserMemos={hideUserMemos}
                        onEditMemo={onEditMemo}
                    />
                    <UserDialogBioPanel
                        profile={profile}
                        bioLinks={bioLinks}
                        visibleBio={visibleBio}
                        bioTranslationLoading={bioTranslationLoading}
                        translatedBioActive={translatedBioActive}
                        toggleBioTranslation={toggleBioTranslation}
                    />
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                    <UserDialogProfileLinksPanel
                        currentAvatarTarget={currentAvatarTarget}
                        currentAvatarDialogArgs={currentAvatarDialogArgs}
                        currentAvatarDisplayName={currentAvatarDisplayName}
                        openAvatarDialog={openAvatarDialog}
                        representedGroupStatus={representedGroupStatus}
                        representedGroup={representedGroup}
                        openGroupDialog={openGroupDialog}
                        profile={profile}
                        visibleHomeLocationTarget={visibleHomeLocationTarget}
                    />
                    <UserDialogActivitySummaryPanel
                        isCurrentUser={isCurrentUser}
                        lastSeen={lastSeen}
                        onOpenInstanceHistory={onOpenInstanceHistory}
                        profile={profile}
                        userTimeSpent={userTimeSpent}
                        userJoinCount={userJoinCount}
                        previousInstances={previousInstances}
                    />
                </div>
            </div>
        </EntityDialogTabContent>
    );
}
