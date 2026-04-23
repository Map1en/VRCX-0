import {
    DownloadIcon,
    EyeIcon,
    LogOutIcon,
    SettingsIcon,
    UsersIcon
} from 'lucide-react';

import { userDialogGroupSortingOptions } from '@/shared/constants/user.js';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import {
    EntityBlank,
    EntityDialogTabContent
} from '../../EntityDialogScaffold.jsx';
import { EntityList, UserGroupSection } from '../UserDialogViewParts.jsx';
import { UserDialogSearchHeader } from './UserDialogSearchHeader.jsx';

export function UserDialogGroupsTab({
    profileGroups,
    filteredProfileGroups,
    remoteStatus,
    remoteErrors,
    loadTab,
    search,
    setSearch,
    groupEditMode,
    effectiveGroupSort,
    setGroupSort,
    isCurrentUser,
    groupActionId,
    setGroupEditMode,
    clearSelectedGroups,
    selectVisibleGroups,
    selectedGroupCount,
    changeSelectedGroupsVisibility,
    exportUserGroups,
    selectedUserGroups,
    leaveSelectedGroups,
    groupSearchActive,
    selectedGroupIds,
    changeGroupVisibility,
    leaveUserGroup,
    moveGroupInGameOrder,
    setGroupSelected,
    userGroupSections,
    ownGroupCountText,
    remainingGroupCountText,
    t
}) {
    const editableGroups = isCurrentUser && groupEditMode;
    const groupMoveHandler = groupEditMode
        ? (group, direction) => void moveGroupInGameOrder(group, direction)
        : undefined;
    const sharedGroupListProps = {
        editableGroups,
        selectableGroups: groupEditMode,
        selectedGroupIds,
        groupActionId,
        onGroupVisibilityChange: (group, visibility) =>
            void changeGroupVisibility(group, visibility),
        onGroupLeave: (group) => void leaveUserGroup(group),
        onGroupMove: groupMoveHandler,
        onGroupSelectionChange: setGroupSelected
    };

    return (
        <EntityDialogTabContent value="groups" className="flex flex-col gap-2">
            <UserDialogSearchHeader
                searchKey="groups"
                tab="groups"
                rows={profileGroups}
                filteredRows={filteredProfileGroups}
                placeholder={t('dialog.user.generated.search_groups')}
                remoteStatus={remoteStatus}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
                t={t}
            >
                {!groupEditMode ? (
                    <>
                        <span className="text-muted-foreground text-sm">
                            {t('dialog.user.generated.sort_by')}
                        </span>
                        <Select
                            value={effectiveGroupSort}
                            onValueChange={setGroupSort}
                            disabled={remoteStatus.groups === 'running'}
                        >
                            <SelectTrigger size="sm" className="w-36">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {Object.entries(
                                        userDialogGroupSortingOptions
                                    ).map(([key, option]) => (
                                        <SelectItem
                                            key={key}
                                            value={option.value}
                                            disabled={
                                                option.value === 'inGame' &&
                                                !isCurrentUser
                                            }
                                        >
                                            {t(option.name)}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </>
                ) : null}
                {isCurrentUser ? (
                    <>
                        <Button
                            type="button"
                            size="sm"
                            variant={groupEditMode ? 'secondary' : 'outline'}
                            disabled={groupActionId === '__bulk_groups__'}
                            onClick={() => {
                                const nextGroupEditMode = !groupEditMode;
                                setGroupEditMode(nextGroupEditMode);
                                if (nextGroupEditMode) {
                                    setGroupSort('inGame');
                                }
                                clearSelectedGroups();
                            }}
                        >
                            {groupEditMode ? 'Done' : 'Edit'}
                        </Button>
                        {groupEditMode ? (
                            <>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                        groupActionId === '__bulk_groups__' ||
                                        !filteredProfileGroups.length
                                    }
                                    onClick={() =>
                                        selectVisibleGroups(
                                            filteredProfileGroups
                                        )
                                    }
                                >
                                    {t('dialog.user.generated.select_visible')}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                        groupActionId === '__bulk_groups__' ||
                                        !selectedGroupCount
                                    }
                                    onClick={clearSelectedGroups}
                                >
                                    {t('dialog.user.generated.clear_selected')}
                                </Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                groupActionId ===
                                                '__bulk_groups__'
                                            }
                                        >
                                            <SettingsIcon data-icon="inline-start" />
                                            {t(
                                                'dialog.user.generated.bulk_actions'
                                            )}
                                            {selectedGroupCount ? (
                                                <span className="text-muted-foreground text-xs">
                                                    ({selectedGroupCount})
                                                </span>
                                            ) : null}
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                        <DropdownMenuGroup>
                                            <DropdownMenuItem
                                                disabled={!selectedGroupCount}
                                                onSelect={() =>
                                                    void changeSelectedGroupsVisibility(
                                                        'visible'
                                                    )
                                                }
                                            >
                                                <EyeIcon />
                                                {t(
                                                    'dialog.user.generated.set_selected_visible'
                                                )}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                disabled={!selectedGroupCount}
                                                onSelect={() =>
                                                    void changeSelectedGroupsVisibility(
                                                        'hidden'
                                                    )
                                                }
                                            >
                                                <EyeIcon />
                                                {t(
                                                    'dialog.user.generated.set_selected_hidden'
                                                )}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                disabled={!selectedGroupCount}
                                                onSelect={() =>
                                                    void changeSelectedGroupsVisibility(
                                                        'friends'
                                                    )
                                                }
                                            >
                                                <UsersIcon />
                                                {t(
                                                    'dialog.user.generated.set_selected_friends'
                                                )}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onSelect={() =>
                                                    exportUserGroups(
                                                        selectedUserGroups
                                                    )
                                                }
                                            >
                                                <DownloadIcon />
                                                {t(
                                                    'dialog.user.generated.export'
                                                )}{' '}
                                                {selectedGroupCount
                                                    ? 'Selected'
                                                    : 'All'}{' '}
                                                {t(
                                                    'dialog.user.generated.groups'
                                                )}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                variant="destructive"
                                                disabled={!selectedGroupCount}
                                                onSelect={() =>
                                                    void leaveSelectedGroups()
                                                }
                                            >
                                                <LogOutIcon />
                                                {t(
                                                    'dialog.user.generated.leave_selected'
                                                )}
                                            </DropdownMenuItem>
                                        </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </>
                        ) : null}
                    </>
                ) : null}
            </UserDialogSearchHeader>
            {remoteStatus.groups === 'running' || remoteErrors.groups ? (
                <EntityList
                    rows={filteredProfileGroups}
                    kind="group"
                    loading={remoteStatus.groups === 'running'}
                    error={remoteErrors.groups}
                />
            ) : groupSearchActive ? (
                <EntityList
                    rows={filteredProfileGroups}
                    kind="group"
                    {...sharedGroupListProps}
                />
            ) : userGroupSections.ownGroups.length ||
              userGroupSections.mutualGroups.length ||
              userGroupSections.remainingGroups.length ? (
                <div className="flex flex-col gap-4">
                    <UserGroupSection
                        title={t('dialog.user.groups.own_groups')}
                        rows={userGroupSections.ownGroups}
                        countText={ownGroupCountText}
                        {...sharedGroupListProps}
                    />
                    <UserGroupSection
                        title={t('dialog.user.groups.mutual_groups')}
                        rows={userGroupSections.mutualGroups}
                        {...sharedGroupListProps}
                    />
                    <UserGroupSection
                        title={t('dialog.user.groups.groups')}
                        rows={userGroupSections.remainingGroups}
                        countText={remainingGroupCountText}
                        {...sharedGroupListProps}
                    />
                </div>
            ) : (
                <EntityBlank />
            )}
        </EntityDialogTabContent>
    );
}
