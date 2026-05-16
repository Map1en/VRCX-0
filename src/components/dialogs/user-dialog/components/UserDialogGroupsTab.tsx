// @ts-nocheck
import { useTranslation } from 'react-i18next';

import { userDialogGroupSortingOptions } from '@/shared/constants/user.js';
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
} from '../../EntityDialogScaffold';
import { EntityList, UserGroupSection } from '../UserDialogViewParts';
import { UserDialogSearchHeader } from './UserDialogSearchHeader';

export function UserDialogGroupsTab({
    profileGroups,
    filteredProfileGroups,
    remoteStatus,
    remoteErrors,
    loadTab,
    search,
    setSearch,
    effectiveGroupSort,
    setGroupSort,
    isCurrentUser,
    groupSearchActive,
    userGroupSections,
    ownGroupCountText,
    remainingGroupCountText
}) {
    const { t } = useTranslation();

    return (
        <EntityDialogTabContent value="groups" className="flex flex-col gap-2">
            <UserDialogSearchHeader
                searchKey="groups"
                tab="groups"
                rows={profileGroups}
                filteredRows={filteredProfileGroups}
                placeholder={t('dialog.user.action.search_groups')}
                remoteStatus={remoteStatus}
                loadTab={loadTab}
                search={search}
                setSearch={setSearch}
            >
                <span className="text-muted-foreground text-sm">
                    {t('dialog.user.groups.sort_by')}
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
                            {Object.entries(userDialogGroupSortingOptions).map(
                                ([key, option]) => (
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
                                )
                            )}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </UserDialogSearchHeader>
            {remoteStatus.groups === 'running' || remoteErrors.groups ? (
                <EntityList
                    rows={filteredProfileGroups}
                    kind="group"
                    loading={remoteStatus.groups === 'running'}
                    error={remoteErrors.groups}
                />
            ) : groupSearchActive ? (
                <EntityList rows={filteredProfileGroups} kind="group" />
            ) : userGroupSections.ownGroups.length ||
              userGroupSections.mutualGroups.length ||
              userGroupSections.remainingGroups.length ? (
                <div className="flex flex-col gap-4">
                    <UserGroupSection
                        title={t('dialog.user.groups.own_groups')}
                        rows={userGroupSections.ownGroups}
                        countText={ownGroupCountText}
                    />
                    <UserGroupSection
                        title={t('dialog.user.groups.mutual_groups')}
                        rows={userGroupSections.mutualGroups}
                    />
                    <UserGroupSection
                        title={t('dialog.user.groups.groups')}
                        rows={userGroupSections.remainingGroups}
                        countText={remainingGroupCountText}
                    />
                </div>
            ) : (
                <EntityBlank />
            )}
        </EntityDialogTabContent>
    );
}
