import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

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

import {
    EntityBlank,
    EntityDialogTabContent
} from '../../EntityDialogScaffold';
import { groupIdForRow } from '../userDialogGroupRows';
import {
    userDialogGroupSortingOptions,
    type UserDialogGroupSort
} from '../userDialogListOptions';
import type { buildUserDialogProfileSummary } from '../userDialogViewData';
import { EntityList, UserGroupSection } from '../UserDialogViewParts';
import type { useUserDialogTabData } from '../useUserDialogTabData';
import { UserDialogSearchHeader } from './UserDialogSearchHeader';

type UserTabData = ReturnType<typeof useUserDialogTabData>;
type ProfileSummary = ReturnType<typeof buildUserDialogProfileSummary>;
type UserDialogGroupsTabProps = Pick<
    UserTabData,
    | 'profileGroups'
    | 'filteredProfileGroups'
    | 'remoteStatus'
    | 'remoteErrors'
    | 'loadTab'
    | 'search'
    | 'setSearch'
    | 'effectiveGroupSort'
    | 'setGroupSort'
    | 'groupSearchActive'
> &
    Pick<
        ProfileSummary,
        'userGroupSections' | 'ownGroupCountText' | 'remainingGroupCountText'
    > & {
        isCurrentUser: boolean;
    };

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
}: UserDialogGroupsTabProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const closeDialog = useDialogStore((state) => state.closeDialog);

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
                <Select<UserDialogGroupSort>
                    value={effectiveGroupSort}
                    onValueChange={(value) => {
                        if (value) {
                            setGroupSort(value);
                        }
                    }}
                    disabled={remoteStatus.groups === 'running'}
                    items={userDialogGroupSortingOptions.map((option) => ({
                        value: option.value,
                        label: t(option.name)
                    }))}
                >
                    <SelectTrigger size="sm" className="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {userDialogGroupSortingOptions.map((option) => (
                                <SelectItem
                                    key={option.value}
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
                {isCurrentUser ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            closeDialog();
                            navigate('/tools/my-groups');
                        }}
                    >
                        {t('dialog.user.groups.manage')}
                    </Button>
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
                    groupMarkers={{
                        own: new Set(
                            userGroupSections.ownGroups.map(groupIdForRow)
                        ),
                        mutual: new Set(
                            userGroupSections.mutualGroups.map(groupIdForRow)
                        )
                    }}
                />
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
