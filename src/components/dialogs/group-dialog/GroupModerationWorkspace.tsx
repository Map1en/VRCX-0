import { UploadIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GroupProfileRecord } from '@/domain/entities/group';
import type { EntityRecord } from '@/domain/entities/shared';
import type { GroupMemberSort } from '@/platform/tauri/bindings';
import { openUserDialog } from '@/services/dialogService';
import { Button } from '@/ui/shadcn/button';
import { Empty, EmptyHeader, EmptyTitle } from '@/ui/shadcn/empty';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    getGroupRoleNameMap,
    hasGroupPermission,
    type GroupModerationTabValue
} from './groupDialogUtils';
import { GroupModerationBanImportDialog } from './GroupModerationBanImportDialog';
import { GroupModerationBulkPanel } from './GroupModerationBulkPanel';
import { GroupModerationLogsPanel } from './GroupModerationLogsPanel';
import {
    getGroupModerationTabs,
    moderationRowLabel,
    moderationRowUserId,
    resolveGroupModerationActiveTab
} from './groupModerationRows';
import {
    GroupModerationTabPanel,
    type GroupModerationServerControl,
    type GroupModerationServerSelectOption
} from './GroupModerationTabPanel';
import { useGroupMembersPagination } from './useGroupMembersPagination';
import { useGroupModerationActionController } from './useGroupModerationActionController';
import { useGroupModerationBatchController } from './useGroupModerationBatchController';
import {
    isGroupModerationEntityRecord,
    useGroupModerationTabData
} from './useGroupModerationTabData';

const MEMBER_SEARCH_DEBOUNCE_MS = 300;

export function GroupModerationWorkspace({
    group,
    endpoint
}: {
    group: GroupProfileRecord;
    endpoint: string;
}) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<GroupModerationTabValue | ''>(
        'members'
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [banImportOpen, setBanImportOpen] = useState(false);
    const [memberSearchInput, setMemberSearchInput] = useState('');
    const [memberQuery, setMemberQuery] = useState('');
    const [memberSort, setMemberSort] =
        useState<GroupMemberSort>('joinedAt:desc');
    const [memberRoleId, setMemberRoleId] = useState('');
    const resetKeyRef = useRef('');
    const moderationTabs = useMemo(
        () => getGroupModerationTabs(t, group),
        [group, t]
    );
    const resetKey = `${endpoint}\u0000${group.id || ''}`;
    const members = useGroupMembersPagination({
        groupId: group.id,
        endpoint,
        enabled: activeTab === 'members',
        query: memberQuery,
        sort: memberSort,
        roleId: memberRoleId,
        reloadToken
    });
    const tabData = useGroupModerationTabData({
        activeTab,
        endpoint,
        groupId: group.id,
        reloadToken,
        resetKey
    });
    const isMembersTab = activeTab === 'members';
    const rows = isMembersTab ? members.rows : tabData.rows;
    const loading = isMembersTab
        ? members.status === 'loading'
        : tabData.status === 'running';
    const error = isMembersTab ? members.error : tabData.error;
    const reload = useCallback(() => {
        setReloadToken((value) => value + 1);
    }, []);
    const batch = useGroupModerationBatchController({
        activeTab,
        endpoint,
        groupId: group.id,
        rows,
        resetKey,
        reload
    });
    const actions = useGroupModerationActionController({
        activeTab,
        groupId: group.id,
        resetKey,
        removeMemberRow: members.removeRow,
        removeTabRow: tabData.removeRow
    });
    const bulkTab =
        activeTab === 'bans' || activeTab === 'members' ? activeTab : null;

    const openModerationUserDialog = useCallback((row: EntityRecord) => {
        const userId = moderationRowUserId(row);
        if (!userId) {
            return;
        }
        const user = isGroupModerationEntityRecord(row.user) ? row.user : null;
        openUserDialog({
            userId,
            title: moderationRowLabel(row),
            seedData: user
        });
    }, []);

    const memberSortOptions: GroupModerationServerSelectOption[] = useMemo(
        () => [
            {
                value: 'joinedAt:desc',
                label: t('dialog.group.members.sorting.joined_at_desc')
            },
            {
                value: 'joinedAt:asc',
                label: t('dialog.group.members.sorting.joined_at_asc')
            }
        ],
        [t]
    );
    const memberRoleOptions: GroupModerationServerSelectOption[] =
        useMemo(() => {
            const rolesById = getGroupRoleNameMap(group);
            return [
                { value: '', label: t('dialog.group.label.all_roles') },
                ...Array.from(rolesById.entries()).map(
                    ([roleId, roleName]) => ({
                        value: roleId,
                        label: roleName
                    })
                )
            ];
        }, [group, t]);
    const membersServerControl: GroupModerationServerControl = {
        query: memberSearchInput,
        onQueryChange: setMemberSearchInput,
        sort: memberSort,
        onSortChange: (value) => {
            if (value === 'joinedAt:asc' || value === 'joinedAt:desc') {
                setMemberSort(value);
            }
        },
        sortOptions: memberSortOptions,
        roleId: memberRoleId,
        onRoleChange: setMemberRoleId,
        roleOptions: memberRoleOptions,
        hasMore: members.hasMore,
        loadingMore: members.loadingMore,
        onLoadMore: members.loadMore,
        loadedCount: members.rows.length
    };

    useEffect(() => {
        if (resetKeyRef.current !== resetKey) {
            resetKeyRef.current = resetKey;
            setActiveTab(
                resolveGroupModerationActiveTab('members', moderationTabs)
            );
            setBanImportOpen(false);
            setMemberSearchInput('');
            setMemberQuery('');
            setMemberSort('joinedAt:desc');
            setMemberRoleId('');
            return;
        }
        setActiveTab((current) =>
            resolveGroupModerationActiveTab(current, moderationTabs)
        );
    }, [moderationTabs, resetKey]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            setMemberQuery(memberSearchInput);
        }, MEMBER_SEARCH_DEBOUNCE_MS);
        return () => {
            clearTimeout(timeoutId);
        };
    }, [memberSearchInput]);

    if (!activeTab) {
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <Empty className="min-h-32 flex-1 border">
                    <EmptyHeader>
                        <EmptyTitle>
                            {t('dialog.group_member_moderation.no_permission')}
                        </EmptyTitle>
                    </EmptyHeader>
                </Empty>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <Tabs
                value={activeTab}
                onValueChange={(value) => {
                    const tab = moderationTabs.find(
                        (candidate) => candidate.value === value
                    );
                    if (tab) {
                        setActiveTab(tab.value);
                    }
                }}
                className="min-h-0 flex-1 gap-0"
            >
                <TabsList
                    variant="underline"
                    className="h-auto w-full shrink-0 justify-start overflow-x-auto rounded-none border-b px-0 pb-1"
                >
                    {moderationTabs.map((tab) => (
                        <TabsTrigger
                            key={tab.value}
                            value={tab.value}
                            disabled={tab.disabled}
                            className="flex-none rounded-none px-3"
                        >
                            {tab.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                {bulkTab && batch.selectedRows.length ? (
                    <div className="shrink-0">
                        <GroupModerationBulkPanel
                            tabValue={bulkTab}
                            group={group}
                            selectedRows={batch.selectedRows}
                            busy={batch.bulkBusy}
                            progress={batch.bulkProgress}
                            onClear={batch.clearSelection}
                            onRemoveRow={(userId) =>
                                batch.toggleSelectedRow(userId, false)
                            }
                            onKick={batch.runBulkKick}
                            onBan={batch.runBulkBan}
                            onUnban={batch.runBulkUnban}
                            onSaveNote={batch.runBulkSaveNote}
                            onAddRoles={batch.runBulkAddRoles}
                            onRemoveRoles={batch.runBulkRemoveRoles}
                        />
                    </div>
                ) : null}
                {moderationTabs.map((tab) =>
                    tab.value === 'logs' ? (
                        <GroupModerationLogsPanel
                            key={tab.value}
                            active={activeTab === 'logs'}
                            endpoint={endpoint}
                            group={group}
                            open
                        />
                    ) : (
                        <GroupModerationTabPanel
                            key={tab.value}
                            actionKey={actions.actionKey}
                            error={error}
                            group={group}
                            loading={loading}
                            onOpenUser={openModerationUserDialog}
                            onReload={reload}
                            onRunAction={actions.runAction}
                            onToggleAllVisible={batch.toggleSelectedVisible}
                            onToggleRow={batch.toggleSelectedRow}
                            rows={rows}
                            selectable={
                                tab.value === 'bans' || tab.value === 'members'
                            }
                            selectedIds={batch.selectedIds || undefined}
                            server={
                                tab.value === 'members'
                                    ? membersServerControl
                                    : undefined
                            }
                            tab={tab}
                            toolbarExtra={
                                tab.value === 'bans' &&
                                hasGroupPermission(
                                    group,
                                    'group-bans-manage'
                                ) ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setBanImportOpen(true)}
                                    >
                                        <UploadIcon data-icon="inline-start" />
                                        {t(
                                            'dialog.group_member_moderation.import_bans'
                                        )}
                                    </Button>
                                ) : null
                            }
                        />
                    )
                )}
            </Tabs>
            <GroupModerationBanImportDialog
                open={banImportOpen}
                onOpenChange={setBanImportOpen}
                groupId={group.id}
                onImported={reload}
            />
        </div>
    );
}
