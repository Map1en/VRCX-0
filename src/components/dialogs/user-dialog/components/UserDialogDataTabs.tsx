import {
    ArrowDownWideNarrowIcon,
    ArrowUpNarrowWideIcon,
    ListIcon,
    WaypointsIcon
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { InstanceHistoryListPanel } from '@/components/dialogs/previous-instances-table/InstanceHistoryListPanel';
import { DialogErrorState } from '@/components/dialogs/previous-instances-table/PreviousInstancesViewParts';
import { UserActivityPanel } from '@/components/dialogs/UserActivityPanel';
import { useHasLicensedAvatars } from '@/components/economy/useHasLicensedAvatars';
import {
    ToolbarIconButton,
    ToolbarSegmented,
    type ToolbarSegmentOption
} from '@/components/layout/ToolbarControls';
import type { UserProfileEntity } from '@/domain/entities/user';
import { useDialogStore } from '@/state/dialogStore';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    EntityDialogTabContent,
    EntityRawJson
} from '../../EntityDialogScaffold';
import {
    userDialogAvatarReleaseStatusOptions,
    userDialogAvatarSortingOptions,
    userDialogMutualFriendSortingOptions,
    userDialogWorldSortingOptions,
    readUserDialogMutualView,
    writeUserDialogMutualView,
    type UserDialogMutualView
} from '../userDialogListOptions';
import { EntityList, FavoriteWorldGroups } from '../UserDialogViewParts';
import type { UserDialogProfileRecord } from '../useUserDialogProfileResource';
import {
    USER_DIALOG_INSTANCE_HISTORY_LIMIT,
    type useUserDialogSupplementalData
} from '../useUserDialogSupplementalData';
import type { useUserDialogTabData } from '../useUserDialogTabData';
import { UserDialogMutualGraph } from './UserDialogMutualGraph';
import {
    UserDialogSearchHeader,
    UserDialogSortSelect
} from './UserDialogSearchHeader';

type UserTabData = ReturnType<typeof useUserDialogTabData>;
type SupplementalData = ReturnType<typeof useUserDialogSupplementalData>;
type RemoteTabProps = Pick<
    UserTabData,
    'remoteStatus' | 'remoteErrors' | 'loadTab' | 'search' | 'setSearch'
>;

export function UserDialogMutualTab({
    profile,
    mutualFriends,
    filteredMutualFriends,
    visibleMutualFriends,
    remoteStatus,
    remoteErrors,
    loadTab,
    search,
    setSearch,
    mutualSort,
    setMutualSort
}: RemoteTabProps & {
    profile: UserDialogProfileRecord;
} & Pick<
        UserTabData,
        | 'mutualFriends'
        | 'filteredMutualFriends'
        | 'visibleMutualFriends'
        | 'mutualSort'
        | 'setMutualSort'
    >) {
    const { t } = useTranslation();
    const [view, setView] = useState(readUserDialogMutualView);
    const showGraph =
        view === 'graph' &&
        (remoteStatus.mutual !== 'running' || mutualFriends.length > 0) &&
        !remoteErrors.mutual &&
        filteredMutualFriends.length > 0;
    const viewOptions = [
        {
            value: 'list',
            label: t('dialog.user.mutual_friends.view.list'),
            icon: ListIcon
        },
        {
            value: 'graph',
            label: t('view.charts.mutual_friend.tab_label'),
            icon: WaypointsIcon
        }
    ] satisfies ToolbarSegmentOption<UserDialogMutualView>[];

    return (
        <EntityDialogTabContent
            value="mutual"
            className="flex min-h-0 flex-col gap-2"
        >
            <UserDialogSearchHeader
                searchKey="mutual"
                tab="mutual"
                rows={mutualFriends}
                filteredRows={filteredMutualFriends}
                placeholder={t('dialog.user.action.search_mutual_friends')}
                remoteStatus={remoteStatus}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                views={
                    <>
                        <ToolbarSegmented
                            iconOnly
                            value={view}
                            options={viewOptions}
                            onValueChange={(nextView) => {
                                setView(nextView);
                                writeUserDialogMutualView(nextView);
                            }}
                        />
                        <UserDialogSortSelect
                            value={mutualSort}
                            options={userDialogMutualFriendSortingOptions}
                            onValueChange={setMutualSort}
                            disabled={
                                remoteStatus.mutual === 'running' ||
                                view === 'graph'
                            }
                        />
                    </>
                }
            />
            {showGraph ? (
                <UserDialogMutualGraph
                    userId={profile?.id || ''}
                    displayName={profile?.displayName || ''}
                    iconUrl={profile?.iconUrl || ''}
                    rows={filteredMutualFriends}
                />
            ) : (
                <EntityList
                    rows={visibleMutualFriends}
                    kind="user"
                    loading={remoteStatus.mutual === 'running'}
                    error={remoteErrors.mutual}
                />
            )}
        </EntityDialogTabContent>
    );
}

export function UserDialogWorldsTab({
    filteredProfileWorlds,
    profileWorlds,
    remoteStatus,
    remoteErrors,
    loadTab,
    search,
    setSearch,
    worldSort,
    changeWorldSort,
    worldOrder,
    changeWorldOrder
}: RemoteTabProps &
    Pick<
        UserTabData,
        | 'filteredProfileWorlds'
        | 'profileWorlds'
        | 'worldSort'
        | 'changeWorldSort'
        | 'worldOrder'
        | 'changeWorldOrder'
    >) {
    const { t } = useTranslation();

    return (
        <EntityDialogTabContent value="worlds" className="flex flex-col gap-2">
            <UserDialogSearchHeader
                searchKey="worlds"
                tab="worlds"
                rows={profileWorlds}
                filteredRows={filteredProfileWorlds}
                placeholder={t('dialog.user.action.search_worlds')}
                remoteStatus={remoteStatus}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                views={
                    <>
                        <UserDialogSortSelect
                            value={worldSort}
                            options={userDialogWorldSortingOptions}
                            onValueChange={changeWorldSort}
                            disabled={remoteStatus.worlds === 'running'}
                        />
                        <ToolbarIconButton
                            icon={
                                worldOrder === 'descending'
                                    ? ArrowDownWideNarrowIcon
                                    : ArrowUpNarrowWideIcon
                            }
                            label={t(
                                worldOrder === 'descending'
                                    ? 'dialog.user.worlds.order.descending'
                                    : 'dialog.user.worlds.order.ascending'
                            )}
                            disabled={remoteStatus.worlds === 'running'}
                            onClick={() =>
                                changeWorldOrder(
                                    worldOrder === 'descending'
                                        ? 'ascending'
                                        : 'descending'
                                )
                            }
                        />
                    </>
                }
            />
            <EntityList
                rows={filteredProfileWorlds}
                kind="world"
                loading={remoteStatus.worlds === 'running'}
                error={remoteErrors.worlds}
            />
        </EntityDialogTabContent>
    );
}

export function UserDialogFavoriteWorldsTab({
    remoteData,
    favoriteWorlds,
    filteredFavoriteWorlds,
    remoteStatus,
    remoteErrors,
    loadTab,
    search,
    setSearch
}: RemoteTabProps &
    Pick<
        UserTabData,
        'remoteData' | 'favoriteWorlds' | 'filteredFavoriteWorlds'
    >) {
    const { t } = useTranslation();

    return (
        <EntityDialogTabContent
            value="favorite-worlds"
            className="flex flex-col gap-2"
        >
            <FavoriteWorldGroups
                groups={remoteData.favoriteWorldGroups}
                rows={favoriteWorlds}
                search={search.favoriteWorlds}
                filteredRows={filteredFavoriteWorlds}
                loading={remoteStatus['favorite-worlds'] === 'running'}
                error={remoteErrors['favorite-worlds'] || ''}
                renderToolbar={(groupTabs) => (
                    <UserDialogSearchHeader
                        searchKey="favoriteWorlds"
                        tab="favorite-worlds"
                        rows={favoriteWorlds}
                        filteredRows={filteredFavoriteWorlds}
                        placeholder={t(
                            'dialog.user.action.search_favorite_worlds'
                        )}
                        remoteStatus={remoteStatus}
                        loadTab={loadTab}
                        search={search}
                        setSearch={setSearch}
                        views={groupTabs}
                    />
                )}
            />
        </EntityDialogTabContent>
    );
}

export function UserDialogAvatarsTab({
    visibleProfileAvatars,
    profileAvatars,
    remoteStatus,
    remoteErrors,
    loadTab,
    search,
    setSearch,
    profile,
    currentUserId,
    avatarSort,
    changeAvatarSort,
    avatarReleaseStatus,
    changeAvatarReleaseStatus
}: RemoteTabProps &
    Pick<
        UserTabData,
        | 'visibleProfileAvatars'
        | 'profileAvatars'
        | 'avatarSort'
        | 'changeAvatarSort'
        | 'avatarReleaseStatus'
        | 'changeAvatarReleaseStatus'
    > & {
        profile: UserDialogProfileRecord;
        currentUserId: string | null;
    }) {
    const { t } = useTranslation();
    const isCurrentUser = profile.id === currentUserId;
    const hasLicensedAvatars = useHasLicensedAvatars(isCurrentUser);
    const releaseStatusOptions = userDialogAvatarReleaseStatusOptions.filter(
        (option) =>
            option.value !== 'licensed' ||
            hasLicensedAvatars ||
            avatarReleaseStatus === 'licensed'
    );

    return (
        <EntityDialogTabContent value="avatars" className="flex flex-col gap-2">
            <UserDialogSearchHeader
                searchKey="avatars"
                tab="avatars"
                rows={profileAvatars}
                filteredRows={visibleProfileAvatars}
                placeholder={t('dialog.user.action.search_avatars')}
                remoteStatus={remoteStatus}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                views={
                    isCurrentUser ? (
                        <>
                            <UserDialogSortSelect
                                value={avatarSort}
                                options={userDialogAvatarSortingOptions}
                                onValueChange={changeAvatarSort}
                                disabled={remoteStatus.avatars === 'running'}
                            />
                            <ToolbarSegmented
                                value={avatarReleaseStatus}
                                options={releaseStatusOptions.map((option) => ({
                                    value: option.value,
                                    label: t(option.name)
                                }))}
                                onValueChange={changeAvatarReleaseStatus}
                            />
                        </>
                    ) : undefined
                }
            />
            <EntityList
                rows={visibleProfileAvatars}
                kind="avatar"
                loading={remoteStatus.avatars === 'running'}
                error={remoteErrors.avatars}
            />
        </EntityDialogTabContent>
    );
}

export function UserDialogInstanceHistoryTab({
    previousInstances,
    previousInstancesError,
    previousInstancesStatus,
    profile,
    onPreviousInstancesChange
}: {
    previousInstances: SupplementalData['previousInstances'];
    previousInstancesError: SupplementalData['previousInstancesError'];
    previousInstancesStatus: SupplementalData['previousInstancesStatus'];
    profile: UserDialogProfileRecord;
    onPreviousInstancesChange: SupplementalData['setPreviousInstances'];
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const userId = profile?.id || profile?.userId || '';

    function openFullHistory(search: string) {
        const params = new URLSearchParams({ scope: 'user', id: userId });
        if (search) {
            params.set('q', search);
        }
        closeDialog();
        navigate(`/instance-history?${params.toString()}`);
    }

    return (
        <EntityDialogTabContent
            value="instance-history"
            className="flex min-h-0 flex-col"
        >
            {previousInstancesStatus === 'running' ? (
                <div className="text-muted-foreground flex min-h-52 flex-1 items-center justify-center gap-2 text-sm">
                    <Spinner className="size-4" />
                    {t('common.loading')}
                </div>
            ) : previousInstancesStatus === 'error' ? (
                <DialogErrorState>
                    {previousInstancesError ||
                        t(
                            'view.instance_history.toast.failed_to_load_instance_history'
                        )}
                </DialogErrorState>
            ) : (
                <InstanceHistoryListPanel
                    instances={previousInstances}
                    variant="user"
                    truncatedLimit={USER_DIALOG_INSTANCE_HISTORY_LIMIT}
                    onRowsChange={onPreviousInstancesChange}
                    onOpenFullHistory={userId ? openFullHistory : null}
                    className="flex-1"
                />
            )}
        </EntityDialogTabContent>
    );
}

export function UserDialogActivityTab({
    profile,
    active
}: {
    profile: UserDialogProfileRecord;
    active: boolean;
}) {
    return (
        <EntityDialogTabContent
            value="activity"
            className="flex flex-col gap-4"
        >
            <UserActivityPanel profile={profile} active={active} />
        </EntityDialogTabContent>
    );
}

export function UserDialogJsonTab({ profile }: { profile: UserProfileEntity }) {
    return (
        <EntityDialogTabContent value="json">
            <EntityRawJson value={profile} />
        </EntityDialogTabContent>
    );
}
