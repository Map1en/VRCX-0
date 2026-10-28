import { ListIcon, WaypointsIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { InstanceHistoryListPanel } from '@/components/dialogs/previous-instances-table/InstanceHistoryListPanel';
import { DialogErrorState } from '@/components/dialogs/previous-instances-table/PreviousInstancesViewParts';
import { UserActivityPanel } from '@/components/dialogs/UserActivityPanel';
import { useHasLicensedAvatars } from '@/components/economy/useHasLicensedAvatars';
import type { UserProfileEntity } from '@/domain/entities/user';
import { useDialogStore } from '@/state/dialogStore';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    EntityDialogTabContent,
    EntityRawJson
} from '../../EntityDialogScaffold';
import {
    userDialogAvatarReleaseStatusOptions,
    userDialogAvatarSortingOptions,
    userDialogMutualFriendSortingOptions,
    userDialogWorldOrderOptions,
    userDialogWorldSortingOptions,
    readUserDialogMutualView,
    writeUserDialogMutualView,
    type UserDialogAvatarReleaseStatus,
    type UserDialogAvatarSort,
    type UserDialogMutualFriendSort,
    type UserDialogMutualView,
    type UserDialogWorldOrder,
    type UserDialogWorldSort
} from '../userDialogListOptions';
import { EntityList, FavoriteWorldGroups } from '../UserDialogViewParts';
import type { UserDialogProfileRecord } from '../useUserDialogProfileResource';
import {
    USER_DIALOG_INSTANCE_HISTORY_LIMIT,
    type useUserDialogSupplementalData
} from '../useUserDialogSupplementalData';
import type { useUserDialogTabData } from '../useUserDialogTabData';
import { UserDialogMutualGraph } from './UserDialogMutualGraph';
import { UserDialogSearchHeader } from './UserDialogSearchHeader';

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
            Icon: ListIcon
        },
        {
            value: 'graph',
            label: t('view.charts.mutual_friend.tab_label'),
            Icon: WaypointsIcon
        }
    ] satisfies {
        value: UserDialogMutualView;
        label: string;
        Icon: typeof ListIcon;
    }[];

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
            >
                <ToggleGroup
                    variant="outline"
                    size="sm"
                    value={[view]}
                    onValueChange={(nextValue) => {
                        const option = viewOptions.find(
                            (candidate) => candidate.value === nextValue[0]
                        );
                        if (option) {
                            setView(option.value);
                            writeUserDialogMutualView(option.value);
                        }
                    }}
                >
                    {viewOptions.map(({ value, label, Icon }) => (
                        <Tooltip key={value}>
                            <TooltipTrigger
                                render={
                                    <ToggleGroupItem
                                        value={value}
                                        aria-label={label}
                                    >
                                        <Icon />
                                    </ToggleGroupItem>
                                }
                            />
                            <TooltipContent>{label}</TooltipContent>
                        </Tooltip>
                    ))}
                </ToggleGroup>
                <span className="text-muted-foreground text-sm">
                    {t('dialog.user.groups.sort_by')}
                </span>
                <Select<UserDialogMutualFriendSort>
                    value={mutualSort}
                    onValueChange={(value) => {
                        if (value) {
                            setMutualSort(value);
                        }
                    }}
                    disabled={
                        remoteStatus.mutual === 'running' || view === 'graph'
                    }
                    items={userDialogMutualFriendSortingOptions.map(
                        (option) => ({
                            value: option.value,
                            label: t(option.name)
                        })
                    )}
                >
                    <SelectTrigger size="sm" className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {userDialogMutualFriendSortingOptions.map(
                                (option) => (
                                    <SelectItem
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {t(option.name)}
                                    </SelectItem>
                                )
                            )}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </UserDialogSearchHeader>
            {showGraph ? (
                <UserDialogMutualGraph
                    userId={profile?.id || ''}
                    displayName={profile?.displayName || ''}
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
            >
                <span className="text-muted-foreground text-sm">
                    {t('dialog.user.worlds.sort_by')}
                </span>
                <Select<UserDialogWorldSort>
                    value={worldSort}
                    onValueChange={(value) => {
                        if (value) {
                            changeWorldSort(value);
                        }
                    }}
                    disabled={remoteStatus.worlds === 'running'}
                    items={userDialogWorldSortingOptions.map((option) => ({
                        value: option.value,
                        label: t(option.name)
                    }))}
                >
                    <SelectTrigger size="sm" className="w-32">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {userDialogWorldSortingOptions.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    {t(option.name)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
                <span className="text-muted-foreground text-sm">
                    {t('dialog.user.label.order_by')}
                </span>
                <Select<UserDialogWorldOrder>
                    value={worldOrder}
                    onValueChange={(value) => {
                        if (value) {
                            changeWorldOrder(value);
                        }
                    }}
                    disabled={remoteStatus.worlds === 'running'}
                    items={userDialogWorldOrderOptions.map((option) => ({
                        value: option.value,
                        label: t(option.name)
                    }))}
                >
                    <SelectTrigger size="sm" className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {userDialogWorldOrderOptions.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    {t(option.name)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </UserDialogSearchHeader>
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
            <UserDialogSearchHeader
                searchKey="favoriteWorlds"
                tab="favorite-worlds"
                rows={favoriteWorlds}
                filteredRows={filteredFavoriteWorlds}
                placeholder={t('dialog.user.action.search_favorite_worlds')}
                remoteStatus={remoteStatus}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
            />
            <FavoriteWorldGroups
                groups={remoteData.favoriteWorldGroups}
                rows={favoriteWorlds}
                search={search.favoriteWorlds}
                filteredRows={filteredFavoriteWorlds}
                loading={remoteStatus['favorite-worlds'] === 'running'}
                error={remoteErrors['favorite-worlds'] || ''}
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
            >
                {isCurrentUser ? (
                    <>
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.user.avatars.sort_by')}
                        </span>
                        <Select<UserDialogAvatarSort>
                            value={avatarSort}
                            onValueChange={(value) => {
                                if (value) {
                                    changeAvatarSort(value);
                                }
                            }}
                            disabled={remoteStatus.avatars === 'running'}
                            items={userDialogAvatarSortingOptions.map(
                                (option) => ({
                                    value: option.value,
                                    label: t(option.name)
                                })
                            )}
                        >
                            <SelectTrigger size="sm" className="w-36">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {userDialogAvatarSortingOptions.map(
                                        (option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {t(option.name)}
                                            </SelectItem>
                                        )
                                    )}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.user.label.group_by')}
                        </span>
                        <Select<UserDialogAvatarReleaseStatus>
                            value={avatarReleaseStatus}
                            onValueChange={(value) => {
                                if (value) {
                                    changeAvatarReleaseStatus(value);
                                }
                            }}
                            disabled={remoteStatus.avatars === 'running'}
                            items={releaseStatusOptions.map((option) => ({
                                value: option.value,
                                label: t(option.name)
                            }))}
                        >
                            <SelectTrigger size="sm" className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {releaseStatusOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {t(option.name)}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </>
                ) : null}
            </UserDialogSearchHeader>
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
