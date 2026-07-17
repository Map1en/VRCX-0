import { type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import {
    EntityDialogTabs,
    type EntityDialogTab
} from '../../EntityDialogScaffold';
import { formatPreviousInstanceCount } from '../../previous-instances-table/previousInstancesRows';
import {
    UserDialogActivityTab,
    UserDialogAvatarsTab,
    UserDialogFavoriteWorldsTab,
    UserDialogInstanceHistoryTab,
    UserDialogJsonTab,
    UserDialogMutualTab,
    UserDialogWorldsTab
} from './UserDialogDataTabs';
import { UserDialogGroupsTab } from './UserDialogGroupsTab';
import {
    UserDialogInfoTab,
    type UserDialogActivitySummarySectionProps,
    type UserDialogBioSectionProps,
    type UserDialogNotesSectionProps,
    type UserDialogPresenceSectionProps,
    type UserDialogProfileLinksSectionProps
} from './UserDialogInfoTab';

type MutualTabProps = ComponentProps<typeof UserDialogMutualTab>;
type GroupsTabProps = ComponentProps<typeof UserDialogGroupsTab>;
type WorldsTabProps = ComponentProps<typeof UserDialogWorldsTab>;
type FavoriteWorldsTabProps = ComponentProps<
    typeof UserDialogFavoriteWorldsTab
>;
type AvatarsTabProps = ComponentProps<typeof UserDialogAvatarsTab>;
type HistoryTabProps = ComponentProps<typeof UserDialogInstanceHistoryTab>;
type JsonTabProps = ComponentProps<typeof UserDialogJsonTab>;

type UserDialogTabsSectionProps = {
    tabsModel: {
        root: {
            activeTab: string;
            tabCounts: Record<string, unknown>;
            tabs: Array<EntityDialogTab & { hidden?: boolean }>;
        };
        info: Omit<
            UserDialogProfileLinksSectionProps,
            'openAvatarDialog' | 'openGroupDialog'
        > &
            Omit<UserDialogNotesSectionProps, 'onEditMemo'> &
            UserDialogBioSectionProps &
            Omit<
                UserDialogActivitySummarySectionProps,
                'onOpenInstanceHistory' | 'previousInstances'
            >;
        presence: Omit<
            UserDialogPresenceSectionProps['presence'],
            'currentUserId' | 'locationInstance'
        > & {
            currentUserId?: string | null;
            locationInstance?: unknown;
        };
        remote: Pick<
            MutualTabProps,
            'loadTab' | 'remoteErrors' | 'remoteStatus' | 'search'
        > &
            Pick<FavoriteWorldsTabProps, 'remoteData'>;
        mutual: Pick<
            MutualTabProps,
            | 'filteredMutualFriends'
            | 'mutualFriends'
            | 'mutualSort'
            | 'visibleMutualFriends'
        >;
        groups: Pick<
            GroupsTabProps,
            | 'effectiveGroupSort'
            | 'filteredProfileGroups'
            | 'groupSearchActive'
            | 'ownGroupCountText'
            | 'profileGroups'
            | 'remainingGroupCountText'
            | 'userGroupSections'
        >;
        worlds: Pick<
            WorldsTabProps,
            | 'filteredProfileWorlds'
            | 'profileWorlds'
            | 'worldOrder'
            | 'worldSort'
        >;
        favoriteWorlds: Pick<
            FavoriteWorldsTabProps,
            'favoriteWorlds' | 'filteredFavoriteWorlds'
        >;
        avatars: Pick<
            AvatarsTabProps,
            | 'avatarReleaseStatus'
            | 'avatarSort'
            | 'currentUserId'
            | 'profileAvatars'
            | 'visibleProfileAvatars'
        >;
        history: Pick<HistoryTabProps, 'previousInstances'>;
        json: Pick<JsonTabProps, 'isFavorite' | 'isFriend' | 'moderationState'>;
    };
    tabsCommands: Pick<MutualTabProps, 'setMutualSort' | 'setSearch'> &
        Pick<GroupsTabProps, 'setGroupSort'> &
        Pick<WorldsTabProps, 'changeWorldOrder' | 'changeWorldSort'> &
        Pick<
            AvatarsTabProps,
            'changeAvatarReleaseStatus' | 'changeAvatarSort'
        > & {
            changeTab: (value: string) => void;
            onEditMemo: UserDialogNotesSectionProps['onEditMemo'];
            onOpenInstanceHistory: () => void;
            onPreviousInstancesChange: HistoryTabProps['onPreviousInstancesChange'];
            onRefreshLocation: UserDialogPresenceSectionProps['actions']['onRefreshLocation'];
            openAvatarDialog: UserDialogProfileLinksSectionProps['openAvatarDialog'];
            openGroupDialog: UserDialogProfileLinksSectionProps['openGroupDialog'];
        };
};

export function UserDialogTabsSection({
    tabsModel: model,
    tabsCommands: commands
}: UserDialogTabsSectionProps) {
    const { t } = useTranslation();
    const {
        root,
        info,
        presence,
        remote,
        mutual,
        groups,
        worlds,
        favoriteWorlds,
        avatars,
        history,
        json
    } = model;
    const { activeTab, tabCounts = {}, tabs = [] } = root;
    const {
        bioLinks,
        currentAvatarDialogArgs,
        currentAvatarDisplayName,
        currentAvatarTarget,
        hideUserMemos,
        hideUserNotes,
        isCurrentUser,
        lastSeen,
        memo,
        friendedAt,
        presenceActivityAt,
        profile,
        representedGroup,
        representedGroupStatus,
        userJoinCount,
        userTimeSpent,
        visibleHomeLocationTarget
    } = info;
    const { loadTab, remoteData, remoteErrors, remoteStatus, search } = remote;
    const {
        filteredMutualFriends,
        mutualFriends,
        mutualSort,
        visibleMutualFriends
    } = mutual;
    const {
        effectiveGroupSort,
        filteredProfileGroups,
        groupSearchActive,
        ownGroupCountText,
        profileGroups,
        remainingGroupCountText,
        userGroupSections
    } = groups;
    const { filteredProfileWorlds, profileWorlds, worldOrder, worldSort } =
        worlds;
    const { favoriteWorlds: favoriteWorldRows, filteredFavoriteWorlds } =
        favoriteWorlds;
    const {
        avatarReleaseStatus,
        avatarSort,
        currentUserId,
        profileAvatars,
        visibleProfileAvatars
    } = avatars;
    const { previousInstances = [] } = history;
    const { isFavorite, isFriend, moderationState } = json;
    const {
        changeAvatarReleaseStatus,
        changeAvatarSort,
        changeTab,
        changeWorldOrder,
        changeWorldSort,
        onEditMemo,
        onOpenInstanceHistory,
        onPreviousInstancesChange,
        onRefreshLocation,
        openAvatarDialog,
        openGroupDialog,
        setGroupSort,
        setMutualSort,
        setSearch
    } = commands;
    const locationInstanceSource =
        presence.locationInstance &&
        typeof presence.locationInstance === 'object'
            ? Object.fromEntries(Object.entries(presence.locationInstance))
            : undefined;
    const locationInstance = locationInstanceSource
        ? {
              ...locationInstanceSource,
              capacity:
                  typeof locationInstanceSource.capacity === 'number'
                      ? locationInstanceSource.capacity
                      : undefined,
              groupName:
                  typeof locationInstanceSource.groupName === 'string'
                      ? locationInstanceSource.groupName
                      : undefined,
              recommendedCapacity:
                  typeof locationInstanceSource.recommendedCapacity === 'number'
                      ? locationInstanceSource.recommendedCapacity
                      : undefined,
              shortName:
                  typeof locationInstanceSource.shortName === 'string'
                      ? locationInstanceSource.shortName
                      : undefined
          }
        : undefined;
    const tabsWithCounts = tabs
        .filter((tab: EntityDialogTab & { hidden?: boolean }) => !tab.hidden)
        .map((tab: EntityDialogTab & { hidden?: boolean }) => {
            const count = Number(tabCounts[tab.value]);
            const countText =
                tab.value === 'instance-history'
                    ? formatPreviousInstanceCount(count)
                    : String(count);
            return Number.isFinite(count) && count >= 0
                ? {
                      ...tab,
                      label: (
                          <span className="inline-flex items-baseline gap-1.5">
                              <span>{tab.label}</span>
                              <span className="text-muted-foreground text-[11px] leading-none font-medium tabular-nums">
                                  {countText}
                              </span>
                          </span>
                      )
                  }
                : tab;
        });
    const presenceSection: UserDialogPresenceSectionProps = {
        presence: {
            ...presence,
            currentUserId: presence.currentUserId || '',
            locationInstance
        },
        actions: {
            onRefreshLocation,
            onShowInstanceHistory: onOpenInstanceHistory
        },
        profile
    };
    const notesSection: UserDialogNotesSectionProps = {
        profile,
        hideUserNotes,
        memo,
        hideUserMemos,
        onEditMemo
    };
    const bioSection: UserDialogBioSectionProps = {
        profile,
        bioLinks
    };
    const profileLinksSection: UserDialogProfileLinksSectionProps = {
        currentAvatarTarget,
        currentAvatarDialogArgs,
        currentAvatarDisplayName,
        isCurrentUser,
        openAvatarDialog,
        representedGroupStatus,
        representedGroup,
        openGroupDialog,
        profile,
        visibleHomeLocationTarget
    };
    const activitySummarySection: UserDialogActivitySummarySectionProps = {
        friendedAt,
        isCurrentUser,
        lastSeen,
        onOpenInstanceHistory,
        presenceActivityAt,
        profile,
        userTimeSpent,
        userJoinCount,
        previousInstances: presence?.previousInstances || []
    };

    return (
        <EntityDialogTabs
            value={activeTab}
            onValueChange={changeTab}
            tabs={tabsWithCounts}
        >
            <UserDialogInfoTab
                presenceSection={presenceSection}
                notesSection={notesSection}
                bioSection={bioSection}
                profileLinksSection={profileLinksSection}
                activitySummarySection={activitySummarySection}
            />
            <UserDialogMutualTab
                mutualFriends={mutualFriends}
                filteredMutualFriends={filteredMutualFriends}
                visibleMutualFriends={visibleMutualFriends}
                remoteStatus={remoteStatus}
                remoteErrors={remoteErrors}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                mutualSort={mutualSort}
                setMutualSort={setMutualSort}
            />
            <UserDialogGroupsTab
                profileGroups={profileGroups}
                filteredProfileGroups={filteredProfileGroups}
                remoteStatus={remoteStatus}
                remoteErrors={remoteErrors}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                effectiveGroupSort={effectiveGroupSort}
                setGroupSort={setGroupSort}
                isCurrentUser={isCurrentUser}
                groupSearchActive={groupSearchActive}
                userGroupSections={userGroupSections}
                ownGroupCountText={ownGroupCountText}
                remainingGroupCountText={remainingGroupCountText}
            />
            <UserDialogWorldsTab
                filteredProfileWorlds={filteredProfileWorlds}
                profileWorlds={profileWorlds}
                remoteStatus={remoteStatus}
                remoteErrors={remoteErrors}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                worldSort={worldSort}
                changeWorldSort={changeWorldSort}
                worldOrder={worldOrder}
                changeWorldOrder={changeWorldOrder}
            />
            <UserDialogFavoriteWorldsTab
                remoteData={remoteData}
                favoriteWorlds={favoriteWorldRows}
                filteredFavoriteWorlds={filteredFavoriteWorlds}
                remoteStatus={remoteStatus}
                remoteErrors={remoteErrors}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
            />
            <UserDialogAvatarsTab
                visibleProfileAvatars={visibleProfileAvatars}
                profileAvatars={profileAvatars}
                remoteStatus={remoteStatus}
                remoteErrors={remoteErrors}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                profile={profile}
                currentUserId={currentUserId}
                avatarSort={avatarSort}
                changeAvatarSort={changeAvatarSort}
                avatarReleaseStatus={avatarReleaseStatus}
                changeAvatarReleaseStatus={changeAvatarReleaseStatus}
            />
            <UserDialogInstanceHistoryTab
                title={t('dialog.previous_instances.header')}
                previousInstances={previousInstances}
                profile={profile}
                onPreviousInstancesChange={onPreviousInstancesChange}
            />
            <UserDialogActivityTab
                profile={profile}
                isCurrentUser={isCurrentUser}
                active={activeTab === 'activity'}
            />
            <UserDialogJsonTab
                profile={profile}
                memo={memo}
                moderationState={moderationState}
                isFriend={isFriend}
                isFavorite={isFavorite}
            />
        </EntityDialogTabs>
    );
}
