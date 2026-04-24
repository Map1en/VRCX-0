import {
    CopyIcon,
    ExternalLinkIcon,
    LanguagesIcon,
    UserIcon
} from 'lucide-react';

import { InstanceActionBar } from '@/components/instances/InstanceActionBar.jsx';
import { Location } from '@/components/Location.jsx';
import { LocationWorld } from '@/components/LocationWorld.jsx';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/lib/entityMedia.js';
import { getFaviconUrl } from '@/shared/utils/urlUtils.js';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    EntityDialogTabContent,
    EntityInfoBlock,
    EntityInfoGrid
} from '../../EntityDialogScaffold.jsx';
import {
    formatDate,
    formatStatsDate,
    formatStatsDuration
} from '../userDialogRows.js';
import { useUserBioTranslation } from '../useUserBioTranslation.js';
import { EntityList } from '../UserDialogViewParts.jsx';

function UserDialogPresenceSection({ presence, presenceActions, profile, t }) {
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
        <div className="border-border mb-2 flex flex-col gap-2 border-b pb-2">
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
                        />
                        <InstanceActionBar
                            className="shrink-0"
                            location={visiblePresenceLocation}
                            launchLocation={visiblePresenceLocation}
                            inviteLocation={visiblePresenceLocation}
                            instanceLocation={visiblePresenceLocation}
                            instance={locationInstance}
                            worldName={locationWorldTitle}
                            friendCount={locationFriendCount}
                            playerCount={locationPlayerCount}
                            capacity={
                                locationInstance?.capacity ??
                                locationInstance?.recommendedCapacity
                            }
                            refreshTooltip={t(
                                'dialog.user.info.refresh_instance_info'
                            )}
                            showHistory={Boolean(previousInstances.length)}
                            onRefresh={presenceActions?.onRefreshLocation}
                            onHistory={presenceActions?.onShowInstanceHistory}
                        />
                    </>
                ) : (
                    <Location
                        location={visiblePresenceLocation}
                        hint={locationWorldTitle}
                        enableContextMenu
                        showLaunchActions
                    />
                )}
            </div>
            {locationInstanceUsers.length ? (
                <div className="max-h-36 overflow-auto">
                    <EntityList rows={locationInstanceUsers} kind="user" />
                </div>
            ) : null}
        </div>
    );
}

export function UserDialogInfoTab({
    presence,
    presenceActions,
    changeTab,
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
    visibleHomeLocationTarget,
    copyUserText,
    t
}) {
    const {
        visibleBio,
        bioTranslationLoading,
        translatedBioActive,
        toggleBioTranslation
    } = useUserBioTranslation({ profile, t });
    const previousInstances = presence?.previousInstances || [];

    return (
        <EntityDialogTabContent value="info">
            <UserDialogPresenceSection
                presence={presence}
                presenceActions={presenceActions}
                profile={profile}
                t={t}
            />
            <EntityInfoGrid>
                {profile.note && !hideUserNotes ? (
                    <EntityInfoBlock
                        label={t('dialog.user.generated.note')}
                        full
                        onClick={onEditMemo}
                    >
                        <pre className="text-muted-foreground max-h-52 font-sans text-xs whitespace-pre-wrap">
                            {profile.note}
                        </pre>
                    </EntityInfoBlock>
                ) : null}
                {memo && !hideUserMemos ? (
                    <EntityInfoBlock
                        label={t('dialog.user.generated.memo')}
                        full
                        onClick={onEditMemo}
                    >
                        <pre className="text-muted-foreground max-h-52 font-sans text-xs whitespace-pre-wrap">
                            {memo}
                        </pre>
                    </EntityInfoBlock>
                ) : null}
                <EntityInfoBlock
                    label={t('dialog.user.info.avatar_info')}
                    full
                >
                    {currentAvatarTarget ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="hover:text-primary h-auto justify-start p-0 text-left text-xs"
                            onClick={() =>
                                openAvatarDialog(currentAvatarDialogArgs)
                            }
                        >
                            <UserIcon data-icon="inline-start" />
                            {currentAvatarDisplayName || 'Avatar'}
                        </Button>
                    ) : (
                        <span className="block truncate text-xs">
                            {'\u2014'}
                        </span>
                    )}
                </EntityInfoBlock>
                <EntityInfoBlock
                    label={t('dialog.user.info.represented_group')}
                    full
                >
                    {representedGroupStatus === 'running' ? (
                        <span className="text-muted-foreground block text-xs">
                            {t('dialog.user.generated.loading')}
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
                                    seedData: {
                                        ...representedGroup,
                                        $memberId: representedGroup.id,
                                        id: representedGroup.groupId,
                                        myMember: {
                                            ...(representedGroup.myMember ||
                                                {}),
                                            id: representedGroup.id,
                                            groupId: representedGroup.groupId,
                                            isRepresenting: Boolean(
                                                representedGroup.isRepresenting
                                            ),
                                            isSubscribedToAnnouncements:
                                                Boolean(
                                                    representedGroup.isSubscribedToAnnouncements
                                                ),
                                            visibility:
                                                representedGroup.visibility ||
                                                representedGroup.memberVisibility ||
                                                'visible',
                                            membershipStatus:
                                                representedGroup.membershipStatus ||
                                                ''
                                        }
                                    }
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
                </EntityInfoBlock>
                <EntityInfoBlock
                    label={t('dialog.user.generated.bio')}
                    full
                >
                    <div className="flex items-start gap-2">
                        <pre className="text-muted-foreground max-h-52 min-w-0 flex-1 overflow-auto font-sans text-xs whitespace-pre-wrap">
                            {visibleBio}
                        </pre>
                        {profile.bio ? (
                            <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="shrink-0"
                                disabled={bioTranslationLoading}
                                title={
                                    translatedBioActive
                                        ? 'Show original bio'
                                        : 'Translate bio'
                                }
                                aria-label={
                                    translatedBioActive
                                        ? 'Show original bio'
                                        : 'Translate bio'
                                }
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
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {bioLinks.map((link) => (
                                <Button
                                    key={link}
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    title={link}
                                    aria-label={`Open ${link}`}
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
                </EntityInfoBlock>
                {!isCurrentUser ? (
                    <EntityInfoBlock
                        label={t('dialog.user.generated.last_seen')}
                        value={formatStatsDate(lastSeen)}
                    />
                ) : null}
                <EntityInfoBlock
                    label={t('dialog.user.generated.last_login')}
                    value={formatDate(
                        profile.last_login || profile.last_activity
                    )}
                />
                <EntityInfoBlock
                    label={t('dialog.user.generated.last_activity')}
                    value={formatDate(profile.last_activity)}
                />
                <EntityInfoBlock
                    label={t('dialog.user.generated.date_joined')}
                    value={profile.date_joined}
                />
                {isCurrentUser ? (
                    <EntityInfoBlock
                        label={t('dialog.user.info.play_time')}
                        value={formatStatsDuration(userTimeSpent)}
                        onClick={
                            previousInstances.length
                                ? () => changeTab('instance-history')
                                : undefined
                        }
                    />
                ) : (
                    <>
                        <EntityInfoBlock
                            label={t('dialog.user.generated.join_count')}
                            value={
                                userJoinCount ? String(userJoinCount) : '\u2014'
                            }
                            onClick={
                                previousInstances.length
                                    ? () => changeTab('instance-history')
                                    : undefined
                            }
                        />
                        <EntityInfoBlock
                            label={t('dialog.user.generated.time_together')}
                            value={formatStatsDuration(userTimeSpent)}
                        />
                    </>
                )}
                {!isCurrentUser ? (
                    <EntityInfoBlock
                        label={t('dialog.user.info.avatar_cloning')}
                        value={profile.allowAvatarCopying ? 'Allow' : 'Deny'}
                    />
                ) : null}
                {visibleHomeLocationTarget ? (
                    <EntityInfoBlock
                        label={t('dialog.user.generated.home_location')}
                        full
                    >
                        <Location
                            location={visibleHomeLocationTarget}
                            enableContextMenu
                            showLaunchActions
                        />
                    </EntityInfoBlock>
                ) : null}
                <EntityInfoBlock
                    label={t('dialog.user.generated.user_id')}
                    mono
                    full
                >
                    <span className="block truncate font-mono text-xs">
                        {profile.id || '\u2014'}
                        {profile.id ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        aria-label="Open user copy menu"
                                        title={t(
                                            'dialog.user.generated.copy_user_details'
                                        )}
                                        className="ml-1"
                                        size="icon-xs"
                                        variant="ghost"
                                        onClick={(event) =>
                                            event.stopPropagation()
                                        }
                                    >
                                        <CopyIcon data-icon="inline-start" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                    <DropdownMenuGroup>
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                void copyUserText(
                                                    profile.id,
                                                    'User ID'
                                                )
                                            }
                                        >
                                            {t(
                                                'dialog.user.generated.copy_user_id'
                                            )}
                                        </DropdownMenuItem>
                                        {profile.displayName ? (
                                            <DropdownMenuItem
                                                onSelect={() =>
                                                    void copyUserText(
                                                        profile.displayName,
                                                        'Display name'
                                                    )
                                                }
                                            >
                                                {t(
                                                    'dialog.user.generated.copy_display_name'
                                                )}
                                            </DropdownMenuItem>
                                        ) : null}
                                    </DropdownMenuGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : null}
                    </span>
                </EntityInfoBlock>
            </EntityInfoGrid>
        </EntityDialogTabContent>
    );
}
