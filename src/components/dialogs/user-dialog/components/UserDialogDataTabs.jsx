import { UserIcon } from 'lucide-react';

import { UserActivityPanel } from '@/components/dialogs/UserActivityPanel.jsx';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import { EntityDialogTabContent, EntityRawJson } from '../../EntityDialogScaffold.jsx';
import { PreviousInstancesPanel } from '../../PreviousInstancesTableDialog.jsx';
import { userDialogMutualFriendSortingOptions } from '@/shared/constants/user.js';
import { EntityList, FavoriteWorldGroups } from '../UserDialogViewParts.jsx';
import { UserDialogSearchHeader } from './UserDialogSearchHeader.jsx';

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
    setMutualSort,
    t
}) {
    return (
        <EntityDialogTabContent value="mutual" className="flex flex-col gap-2">
            <UserDialogSearchHeader
                searchKey="mutual"
                tab="mutual"
                rows={mutualFriends}
                filteredRows={filteredMutualFriends}
                placeholder={t('dialog.user.generated.search_mutual_friends')}
                remoteStatus={remoteStatus}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                t={t}
            >
                <span className="text-muted-foreground text-sm">
                    {t('dialog.user.generated.sort_by')}
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
    changeWorldOrder,
    t
}) {
    return (
        <EntityDialogTabContent value="worlds" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="text-muted-foreground text-sm">
                        {filteredProfileWorlds.length}/{profileWorlds.length}
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={remoteStatus.worlds === 'running'}
                        onClick={() => void loadTab('worlds', { force: true })}
                    >
                        {t('common.actions.refresh')}
                    </Button>
                    <Input
                        value={search.worlds}
                        onChange={(event) =>
                            setSearch((current) => ({
                                ...current,
                                worlds: event.target.value
                            }))
                        }
                        placeholder={t('dialog.user.generated.search_worlds')}
                        className="ml-auto h-8 w-40"
                    />
                    <span className="text-muted-foreground text-sm">
                        {t('dialog.user.generated.sort_by')}
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
                                    {t('dialog.user.generated.name')}
                                </SelectItem>
                                <SelectItem value="updated">
                                    {t('dialog.user.generated.updated')}
                                </SelectItem>
                                <SelectItem value="created">
                                    {t('dialog.user.generated.created')}
                                </SelectItem>
                                <SelectItem value="favorites">
                                    {t('dialog.user.generated.favorites')}
                                </SelectItem>
                                <SelectItem value="popularity">
                                    {t('dialog.user.generated.popularity')}
                                </SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <span className="text-muted-foreground text-sm">
                        {t('dialog.user.generated.order_by')}
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
                </div>
                <EntityList
                    rows={filteredProfileWorlds}
                    kind="world"
                    loading={remoteStatus.worlds === 'running'}
                    error={remoteErrors.worlds}
                />
            </div>
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
    setSearch,
    t
}) {
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
                placeholder={t('dialog.user.generated.search_favorite_worlds')}
                remoteStatus={remoteStatus}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                t={t}
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
    currentAvatarTarget,
    currentAvatarDisplayName,
    onOpenCurrentAvatar,
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
    changeAvatarReleaseStatus,
    t
}) {
    return (
        <EntityDialogTabContent value="avatars" className="flex flex-col gap-2">
            {currentAvatarTarget ? (
                <Button
                    type="button"
                    variant="ghost"
                    className="hover:text-primary h-auto justify-start p-0 text-left"
                    onClick={onOpenCurrentAvatar}
                >
                    <UserIcon data-icon="inline-start" />
                    {t('dialog.user.generated.current_avatar')}{' '}
                    {currentAvatarDisplayName || 'Avatar'}
                </Button>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
                <div className="text-muted-foreground text-sm">
                    {visibleProfileAvatars.length}/{profileAvatars.length}
                </div>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={remoteStatus.avatars === 'running'}
                    onClick={() => void loadTab('avatars', { force: true })}
                >
                    {t('common.actions.refresh')}
                </Button>
                <Input
                    value={search.avatars}
                    onChange={(event) =>
                        setSearch((current) => ({
                            ...current,
                            avatars: event.target.value
                        }))
                    }
                    placeholder={t('dialog.user.generated.search_avatars')}
                    className="ml-auto h-8 w-40"
                />
                {profile.id === currentUserId ? (
                    <>
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.user.generated.sort_by')}
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
                                        {t('dialog.user.generated.name')}
                                    </SelectItem>
                                    <SelectItem value="update">
                                        {t('dialog.user.generated.updated')}
                                    </SelectItem>
                                    <SelectItem value="createdAt">
                                        {t('dialog.user.avatars.sort_by_uploaded')}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.user.generated.group_by')}
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
                                        {t('dialog.user.generated.all')}
                                    </SelectItem>
                                    <SelectItem value="public">
                                        {t('dialog.user.generated.public')}
                                    </SelectItem>
                                    <SelectItem value="private">
                                        {t('dialog.user.generated.private')}
                                    </SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </>
                ) : null}
            </div>
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
}) {
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
            />
        </EntityDialogTabContent>
    );
}

export function UserDialogActivityTab({ profile, isCurrentUser, active }) {
    return (
        <EntityDialogTabContent value="activity" className="flex flex-col gap-4">
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
}) {
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
