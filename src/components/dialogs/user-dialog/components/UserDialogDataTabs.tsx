import { Maximize2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { UserActivityPanel } from '@/components/dialogs/UserActivityPanel';
import { userDialogMutualFriendSortingOptions } from '@/shared/constants/user';
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
import { UserDialogSearchHeader } from './UserDialogSearchHeader';

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
}: any) {
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
                    onValueChange={setMutualSort}
                    disabled={remoteStatus.mutual === 'running'}
                >
                    <SelectTrigger size="sm" className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {Object.entries(
                                userDialogMutualFriendSortingOptions
                            ).map(([key, option]: any) => (
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
}: any) {
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
                    onValueChange={changeWorldSort}
                    disabled={remoteStatus.worlds === 'running'}
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
                    onValueChange={changeWorldOrder}
                    disabled={remoteStatus.worlds === 'running'}
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
}: any) {
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
}: any) {
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
                            onValueChange={changeAvatarSort}
                            disabled={remoteStatus.avatars === 'running'}
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
                            onValueChange={changeAvatarReleaseStatus}
                            disabled={remoteStatus.avatars === 'running'}
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
}: any) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const closeDialog = useDialogStore((state: any) => state.closeDialog);
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
                        <TooltipTrigger asChild>
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
                        </TooltipTrigger>
                        <TooltipContent>{openFullLabel}</TooltipContent>
                    </Tooltip>
                }
            />
        </EntityDialogTabContent>
    );
}

export function UserDialogActivityTab({ profile, isCurrentUser, active }: any) {
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
}: any) {
    return (
        <EntityDialogTabContent value="json">
            <EntityRawJson
                value={{
                    profile,
                    memo,
                    moderationState,
                    isFriend,
                    isFavorite
                }}
            />
        </EntityDialogTabContent>
    );
}
