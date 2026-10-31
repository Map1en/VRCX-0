import {
    type ComponentProps,
    type UIEvent,
    useLayoutEffect,
    useRef
} from 'react';

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
import { UserDialogFeedTab } from './UserDialogFeedTab';
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

type UserDialogTabsSectionProps = {
    tabsModel: {
        root: {
            activeTab: string;
            tabCounts: Record<string, unknown>;
            tabs: Array<EntityDialogTab & { hidden?: boolean }>;
        };
        info: Omit<UserDialogProfileLinksSectionProps, 'openGroupDialog'> &
            Omit<UserDialogNotesSectionProps, 'onEditMemo'> &
            Omit<UserDialogBioSectionProps, 'onEditBio'> &
            Omit<
                UserDialogActivitySummarySectionProps,
                'onOpenFeed' | 'onOpenInstanceHistory' | 'previousInstances'
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
        history: Pick<
            HistoryTabProps,
            | 'previousInstances'
            | 'previousInstancesError'
            | 'previousInstancesStatus'
        >;
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
            onEditSelfProfileDetails: () => void;
            onOpenFeed: () => void;
            onOpenInstanceHistory: () => void;
            onPreviousInstancesChange: HistoryTabProps['onPreviousInstancesChange'];
            onRefreshLocation: UserDialogPresenceSectionProps['actions']['onRefreshLocation'];
            openGroupDialog: UserDialogProfileLinksSectionProps['openGroupDialog'];
        };
};

function useTabScrollMemory(activeTab: string, resetKey: string) {
    const containerRef = useRef<HTMLDivElement>(null);
    const positionsRef = useRef(new Map<string, number>());
    const resetKeyRef = useRef(resetKey);
    const activeTabRef = useRef(activeTab);

    useLayoutEffect(() => {
        if (resetKeyRef.current !== resetKey) {
            resetKeyRef.current = resetKey;
            positionsRef.current = new Map();
        }
        activeTabRef.current = activeTab;
        const panel = containerRef.current?.querySelector<HTMLElement>(
            '[data-slot="tabs-content"]:not([hidden])'
        );
        if (panel) {
            panel.scrollTop = positionsRef.current.get(activeTab) ?? 0;
        }
    }, [activeTab, resetKey]);

    function onScrollCapture(event: UIEvent<HTMLDivElement>) {
        const target = event.target;
        if (
            target instanceof HTMLElement &&
            target.dataset.slot === 'tabs-content'
        ) {
            positionsRef.current.set(activeTabRef.current, target.scrollTop);
        }
    }

    return { containerRef, onScrollCapture };
}

export function UserDialogTabsSection({
    tabsModel: model,
    tabsCommands: commands
}: UserDialogTabsSectionProps) {
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
        history
    } = model;
    const { activeTab, tabCounts = {}, tabs = [] } = root;
    const {
        bioLinks,
        currentAvatarDisplayName,
        hideUserMemos,
        hideUserNotes,
        isCurrentUser,
        isFriend,
        lastSeen,
        memo,
        friendedAt,
        relationshipHistory,
        presenceActivityAt,
        profile,
        representedGroup,
        representedGroupStatus,
        userJoinCount,
        userTimeSpent,
        visibleHomeLocationTarget
    } = info;
    const { loadTab, remoteData, remoteErrors, remoteStatus, search } = remote;
    const tabScrollMemory = useTabScrollMemory(
        activeTab,
        String(profile?.id ?? '')
    );
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
    const {
        previousInstances = [],
        previousInstancesError = '',
        previousInstancesStatus = 'idle'
    } = history;
    const {
        changeAvatarReleaseStatus,
        changeAvatarSort,
        changeTab,
        changeWorldOrder,
        changeWorldSort,
        onEditMemo,
        onEditSelfProfileDetails,
        onOpenFeed,
        onOpenInstanceHistory,
        onPreviousInstancesChange,
        onRefreshLocation,
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
        }
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
        bioLinks,
        onEditBio: isCurrentUser ? onEditSelfProfileDetails : undefined
    };
    const profileLinksSection: UserDialogProfileLinksSectionProps = {
        currentAvatarDisplayName,
        isCurrentUser,
        representedGroupStatus,
        representedGroup,
        openGroupDialog,
        profile,
        visibleHomeLocationTarget
    };
    const activitySummarySection: UserDialogActivitySummarySectionProps = {
        friendedAt,
        relationshipHistory,
        isCurrentUser,
        isFriend,
        lastSeen,
        onOpenFeed,
        onOpenInstanceHistory,
        presenceActivityAt,
        profile,
        userTimeSpent,
        userJoinCount
    };

    return (
        <div
            ref={tabScrollMemory.containerRef}
            className="contents"
            onScrollCapture={tabScrollMemory.onScrollCapture}
        >
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
                    profile={profile}
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
                    previousInstances={previousInstances}
                    previousInstancesError={previousInstancesError}
                    previousInstancesStatus={previousInstancesStatus}
                    profile={profile}
                    onPreviousInstancesChange={onPreviousInstancesChange}
                />
                <UserDialogFeedTab
                    active={activeTab === 'feed'}
                    currentUserId={presence.currentUserId || null}
                    profile={profile}
                />
                <UserDialogActivityTab
                    profile={profile}
                    active={activeTab === 'activity'}
                />
                <UserDialogJsonTab profile={profile} />
            </EntityDialogTabs>
        </div>
    );
}
