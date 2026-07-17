import { Maximize2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { UserActivityPanel } from '@/components/dialogs/UserActivityPanel';
import type {
    UserDialogJson,
    UserModerationState,
    UserProfileEntity
} from '@/domain/entities/profileEntities';
import {
    userDialogMutualFriendSortingOptions,
    userDialogWorldOrderOptions,
    userDialogWorldSortingOptions
} from '@/shared/constants/user';
import { useDialogStore } from '@/state/dialogStore';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    EntityDialogTabContent,
    EntityRawJson
} from '../../EntityDialogScaffold';
import { PreviousInstancesPanel } from '../../PreviousInstancesTableDialog';
import { EntityList, FavoriteWorldGroups } from '../UserDialogViewParts';
import type { UserDialogProfileRecord } from '../useUserDialogProfileResource';
import type { useUserDialogSupplementalData } from '../useUserDialogSupplementalData';
import type { useUserDialogTabData } from '../useUserDialogTabData';
import { UserDialogSearchHeader } from './UserDialogSearchHeader';

type UserTabData = ReturnType<typeof useUserDialogTabData>;
type SupplementalData = ReturnType<typeof useUserDialogSupplementalData>;
type RemoteTabProps = Pick<
    UserTabData,
    'remoteStatus' | 'remoteErrors' | 'loadTab' | 'search' | 'setSearch'
>;

export function UserDialogMutualTab({
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
}: RemoteTabProps &
    Pick<
        UserTabData,
        | 'mutualFriends'
        | 'filteredMutualFriends'
        | 'visibleMutualFriends'
        | 'mutualSort'
        | 'setMutualSort'
    >) {
    const { t } = useTranslation();

    return (
        <EntityDialogTabContent value="mutual" className="flex flex-col gap-2">
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
                <span className="text-muted-foreground text-sm">
                    {t('dialog.user.groups.sort_by')}
                </span>
                <Select
                    value={mutualSort}
                    onValueChange={(value) => setMutualSort(value ?? '')}
                    disabled={remoteStatus.mutual === 'running'}
                    items={Object.values(
                        userDialogMutualFriendSortingOptions
                    ).map((option) => ({
                        value: option.value,
                        label: t(option.name)
                    }))}
                >
                    <SelectTrigger size="sm" className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {Object.entries(
                                userDialogMutualFriendSortingOptions
                            ).map(([key, option]) => (
                                <SelectItem key={key} value={option.value}>
                                    {t(option.name)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </UserDialogSearchHeader>
            <EntityList
                rows={visibleMutualFriends}
                kind="user"
                loading={remoteStatus.mutual === 'running'}
                error={remoteErrors.mutual}
            />
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
                <Select
                    value={worldSort}
                    onValueChange={(value) => changeWorldSort(value ?? '')}
                    disabled={remoteStatus.worlds === 'running'}
                    items={Object.values(userDialogWorldSortingOptions).map(
                        (option) => ({
                            value: option.value,
                            label: t(option.name)
                        })
                    )}
                >
                    <SelectTrigger size="sm" className="w-32">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="name">
                                {t('dialog.user.worlds.sorting.name')}
                            </SelectItem>
                            <SelectItem value="updated">
                                {t('dialog.user.worlds.sorting.updated')}
                            </SelectItem>
                            <SelectItem value="created">
                                {t('dialog.user.worlds.sorting.created')}
                            </SelectItem>
                            <SelectItem value="favorites">
                                {t('dialog.user.worlds.sorting.favorites')}
                            </SelectItem>
                            <SelectItem value="popularity">
                                {t('dialog.user.worlds.sorting.popularity')}
                            </SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
                <span className="text-muted-foreground text-sm">
                    {t('dialog.user.label.order_by')}
                </span>
                <Select
                    value={worldOrder}
                    onValueChange={(value) => changeWorldOrder(value ?? '')}
                    disabled={remoteStatus.worlds === 'running'}
                    items={Object.values(userDialogWorldOrderOptions).map(
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
                            <SelectItem value="descending">
                                {t('dialog.user.worlds.order.descending')}
                            </SelectItem>
                            <SelectItem value="ascending">
                                {t('dialog.user.worlds.order.ascending')}
                            </SelectItem>
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
                error={remoteErrors['favorite-worlds']}
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
                {profile.id === currentUserId ? (
                    <>
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.user.avatars.sort_by')}
                        </span>
                        <Select
                            value={avatarSort}
                            onValueChange={(value) =>
                                changeAvatarSort(value ?? '')
                            }
                            disabled={remoteStatus.avatars === 'running'}
                            items={[
                                {
                                    value: 'name',
                                    label: t('dialog.user.avatars.sort_by_name')
                                },
                                {
                                    value: 'update',
                                    label: t(
                                        'dialog.user.avatars.sort_by_update'
                                    )
                                },
                                {
                                    value: 'createdAt',
                                    label: t(
                                        'dialog.user.avatars.sort_by_uploaded'
                                    )
                                }
                            ]}
                        >
                            <SelectTrigger size="sm" className="w-36">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="name">
                                        {t('dialog.user.avatars.sort_by_name')}
                                    </SelectItem>
                                    <SelectItem value="update">
                                        {t(
                                            'dialog.user.avatars.sort_by_update'
                                        )}
                                    </SelectItem>
                                    <SelectItem value="createdAt">
                                        {t(
                                            'dialog.user.avatars.sort_by_uploaded'
                                        )}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.user.label.group_by')}
                        </span>
                        <Select
                            value={avatarReleaseStatus}
                            onValueChange={(value) =>
                                changeAvatarReleaseStatus(value ?? '')
                            }
                            disabled={remoteStatus.avatars === 'running'}
                            items={[
                                {
                                    value: 'all',
                                    label: t('dialog.user.avatars.all')
                                },
                                {
                                    value: 'public',
                                    label: t('dialog.user.avatars.public')
                                },
                                {
                                    value: 'private',
                                    label: t('dialog.user.avatars.private')
                                }
                            ]}
                        >
                            <SelectTrigger size="sm" className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="all">
                                        {t('dialog.user.avatars.all')}
                                    </SelectItem>
                                    <SelectItem value="public">
                                        {t('dialog.user.avatars.public')}
                                    </SelectItem>
                                    <SelectItem value="private">
                                        {t('dialog.user.avatars.private')}
                                    </SelectItem>
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
    title,
    previousInstances,
    profile,
    onPreviousInstancesChange
}: {
    title: string;
    previousInstances: SupplementalData['previousInstances'];
    profile: UserDialogProfileRecord;
    onPreviousInstancesChange: SupplementalData['setPreviousInstances'];
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const userId = profile?.id || profile?.userId || '';
    const openFullLabel = t('view.instance_history.action.open_full');

    function openFullHistory() {
        if (!userId) {
            return;
        }
        closeDialog();
        navigate(
            `/instance-history?scope=user&id=${encodeURIComponent(userId)}`
        );
    }

    return (
        <EntityDialogTabContent
            value="instance-history"
            className="flex min-h-0 flex-col"
        >
            <PreviousInstancesPanel
                title={title}
                instances={previousInstances}
                variant="user"
                targetRef={profile}
                onRowsChange={onPreviousInstancesChange}
                className="flex-1"
                headerActions={
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-sm"
                                    disabled={!userId}
                                    aria-label={openFullLabel}
                                    onClick={openFullHistory}
                                >
                                    <Maximize2Icon className="size-4" />
                                </Button>
                            }
                        />
                        <TooltipContent>{openFullLabel}</TooltipContent>
                    </Tooltip>
                }
            />
        </EntityDialogTabContent>
    );
}

export function UserDialogActivityTab({
    profile,
    isCurrentUser,
    active
}: {
    profile: UserDialogProfileRecord;
    isCurrentUser: boolean;
    active: boolean;
}) {
    return (
        <EntityDialogTabContent
            value="activity"
            className="flex flex-col gap-4"
        >
            <UserActivityPanel
                profile={profile}
                isCurrentUser={isCurrentUser}
                active={active}
            />
        </EntityDialogTabContent>
    );
}

export function UserDialogJsonTab({
    profile,
    memo,
    moderationState,
    isFriend,
    isFavorite
}: {
    profile: UserProfileEntity;
    memo: string;
    moderationState: UserModerationState;
    isFriend: boolean;
    isFavorite: boolean;
}) {
    return (
        <EntityDialogTabContent value="json">
            <EntityRawJson
                value={
                    {
                        profile,
                        memo,
                        moderationState,
                        isFriend,
                        isFavorite
                    } satisfies UserDialogJson
                }
            />
        </EntityDialogTabContent>
    );
}
