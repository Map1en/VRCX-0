import { Settings2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ToolbarIconButton } from '@/components/layout/ToolbarControls';
import { recordToolOpen } from '@/services/telemetry/telemetryToolUsage';
import { useDialogStore } from '@/state/dialogStore';

import {
    EntityBlank,
    EntityDialogTabContent
} from '../../EntityDialogScaffold';
import { groupIdForRow } from '../userDialogGroupRows';
import { userDialogGroupSortingOptions } from '../userDialogListOptions';
import type { buildUserDialogGroupSummary } from '../userDialogViewData';
import { EntityList, UserGroupSection } from '../UserDialogViewParts';
import type { useUserDialogTabData } from '../useUserDialogTabData';
import {
    UserDialogSearchHeader,
    UserDialogSortSelect
} from './UserDialogSearchHeader';

type UserTabData = ReturnType<typeof useUserDialogTabData>;
type GroupSummary = ReturnType<typeof buildUserDialogGroupSummary>;
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
        GroupSummary,
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
                views={
                    <UserDialogSortSelect
                        value={effectiveGroupSort}
                        options={userDialogGroupSortingOptions}
                        onValueChange={setGroupSort}
                        disabled={remoteStatus.groups === 'running'}
                        isOptionDisabled={(value) =>
                            value === 'inGame' && !isCurrentUser
                        }
                    />
                }
                actions={
                    isCurrentUser ? (
                        <ToolbarIconButton
                            icon={Settings2Icon}
                            label={t('dialog.user.groups.manage')}
                            onClick={() => {
                                recordToolOpen('my-groups');
                                closeDialog();
                                navigate('/tools/my-groups');
                            }}
                        />
                    ) : undefined
                }
            />
            {(remoteStatus.groups === 'running' && !profileGroups.length) ||
            remoteErrors.groups ? (
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
