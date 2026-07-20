import { UploadIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type {
    EntityRecord,
    GroupProfileRecord
} from '@/domain/entities/profileEntities';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { openUserDialog } from '@/services/dialogService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Empty, EmptyHeader, EmptyTitle } from '@/ui/shadcn/empty';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    getGroupRoleNameMap,
    hasGroupPermission,
    type GroupModerationTabValue
} from './groupDialogUtils';
import { GroupModerationBanImportDialog } from './GroupModerationBanImportDialog';
import {
    GroupModerationBulkPanel,
    type GroupModerationBulkProgress
} from './GroupModerationBulkPanel';
import { GroupModerationLogsPanel } from './GroupModerationLogsPanel';
import {
    getGroupModerationTabs,
    moderationRowLabel,
    moderationRowRoleIds,
    moderationRowUserId,
    resolveGroupModerationActiveTab,
    type GroupModerationAction
} from './groupModerationRows';
import {
    GroupModerationTabPanel,
    type GroupModerationServerControl,
    type GroupModerationServerSelectOption
} from './GroupModerationTabPanel';
import { useGroupMembersPagination } from './useGroupMembersPagination';

const MEMBER_SEARCH_DEBOUNCE_MS = 300;

function isEntityRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

const BULK_SELECTABLE_TABS = new Set(['bans', 'members']);

export function GroupModerationWorkspace({
    group,
    endpoint
}: {
    group: GroupProfileRecord;
    endpoint: string;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [activeTab, setActiveTab] = useState<GroupModerationTabValue | ''>(
        'members'
    );
    const [rowsByTab, setRowsByTab] = useState<Record<string, EntityRecord[]>>(
        {}
    );
    const [statusByTab, setStatusByTab] = useState<Record<string, string>>({});
    const [errorsByTab, setErrorsByTab] = useState<Record<string, string>>({});
    const [reloadToken, setReloadToken] = useState(0);
    const [actionKey, setActionKey] = useState('');
    const [selectedByTab, setSelectedByTab] = useState<
        Record<string, Set<string>>
    >({});
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkProgress, setBulkProgress] =
        useState<GroupModerationBulkProgress | null>(null);
    const [banImportOpen, setBanImportOpen] = useState(false);
    const [memberSearchInput, setMemberSearchInput] = useState('');
    const [memberQuery, setMemberQuery] = useState('');
    const [memberSort, setMemberSort] = useState('joinedAt:desc');
    const [memberRoleId, setMemberRoleId] = useState('');
    const resetKeyRef = useRef('');
    const moderationTabs = useMemo(
        () => getGroupModerationTabs(t, group),
        [group.id, group.myMember, group.roles, t]
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
    const isMembersTab = activeTab === 'members';
    const rows = isMembersTab ? members.rows : rowsByTab[activeTab] || [];
    const loading = isMembersTab
        ? members.status === 'loading'
        : statusByTab[activeTab] === 'running';
    const error = isMembersTab ? members.error : errorsByTab[activeTab] || '';
    const selectedIds = selectedByTab[activeTab] || null;
    const selectedRows = selectedIds
        ? rows.filter((row) => selectedIds.has(moderationRowUserId(row)))
        : [];
    const bulkSelectable = BULK_SELECTABLE_TABS.has(activeTab);

    const openModerationUserDialog = useCallback((row: EntityRecord) => {
        const userId = moderationRowUserId(row);
        if (!userId) {
            return;
        }
        const user = isEntityRecord(row.user) ? row.user : null;
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
        onSortChange: setMemberSort,
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
            setRowsByTab({});
            setStatusByTab({});
            setErrorsByTab({});
            setActionKey('');
            setSelectedByTab({});
            setBulkBusy(false);
            setBulkProgress(null);
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

    useEffect(() => {
        if (!activeTab || activeTab === 'logs' || activeTab === 'members') {
            return;
        }

        let active = true;
        setStatusByTab((current) => ({
            ...current,
            [activeTab]: 'running'
        }));
        setErrorsByTab((current) => ({ ...current, [activeTab]: '' }));

        const request =
            activeTab === 'bans'
                ? groupProfileRepository.getAllGroupBans({
                      groupId: group.id
                  })
                : activeTab === 'invites'
                  ? groupProfileRepository.getAllGroupInvites({
                        groupId: group.id
                    })
                  : activeTab === 'requests'
                    ? groupProfileRepository.getAllGroupJoinRequests({
                          groupId: group.id,
                          blocked: false
                      })
                    : groupProfileRepository.getAllGroupJoinRequests({
                          groupId: group.id,
                          blocked: true
                      });

        request
            .then((nextRows) => {
                if (!active) {
                    return;
                }
                setRowsByTab((current) => ({
                    ...current,
                    [activeTab]: Array.isArray(nextRows)
                        ? nextRows.filter(isEntityRecord)
                        : []
                }));
                setStatusByTab((current) => ({
                    ...current,
                    [activeTab]: 'ready'
                }));
            })
            .catch((requestError: unknown) => {
                if (!active) {
                    return;
                }
                setStatusByTab((current) => ({
                    ...current,
                    [activeTab]: 'error'
                }));
                setErrorsByTab((current) => ({
                    ...current,
                    [activeTab]:
                        requestError instanceof Error
                            ? requestError.message
                            : 'Failed to load moderation data.'
                }));
            });

        return () => {
            active = false;
        };
    }, [activeTab, endpoint, group.id, reloadToken]);

    function toggleSelectedVisible(userIds: string[], checked: boolean) {
        setSelectedByTab((current) => {
            const next = new Set(current[activeTab] || []);
            for (const userId of userIds) {
                if (checked) {
                    next.add(userId);
                } else {
                    next.delete(userId);
                }
            }
            return { ...current, [activeTab]: next };
        });
    }

    function toggleSelectedRow(userId: string, checked: boolean) {
        if (!userId) {
            return;
        }
        toggleSelectedVisible([userId], checked);
    }

    function clearSelection() {
        setSelectedByTab((current) => ({ ...current, [activeTab]: new Set() }));
    }

    async function runBulkAction({
        label,
        destructive = false,
        skipSelf,
        action
    }: {
        label: string;
        destructive?: boolean;
        skipSelf: boolean;
        action: (row: EntityRecord) => Promise<void>;
    }) {
        if (bulkBusy || !selectedRows.length) {
            return;
        }
        const targetRows = selectedRows;
        const result = await confirm({
            title: t('dialog.group.dynamic.value_group_user', { value: label }),
            description: t(
                'dialog.group_member_moderation.bulk_action_confirm',
                { count: targetRows.length }
            ),
            confirmText: label,
            cancelText: t('common.actions.cancel'),
            destructive
        });
        if (!result.ok) {
            return;
        }

        setBulkBusy(true);
        setBulkProgress({ current: 0, total: targetRows.length });
        let successCount = 0;
        for (let index = 0; index < targetRows.length; index += 1) {
            const row = targetRows[index];
            setBulkProgress({ current: index + 1, total: targetRows.length });
            const userId = moderationRowUserId(row);
            if (skipSelf && currentUserId && userId === currentUserId) {
                continue;
            }
            try {
                await action(row);
                successCount += 1;
            } catch (actionError) {
                toast.error(
                    `${moderationRowLabel(row)}: ${userFacingErrorMessage(
                        actionError,
                        t('dialog.group.toast.value_failed', { value: label })
                    )}`
                );
            }
        }

        setBulkBusy(false);
        setBulkProgress(null);
        clearSelection();
        setReloadToken((value) => value + 1);
        if (successCount) {
            toast.success(
                t('dialog.group_member_moderation.bulk_action_completed', {
                    count: successCount,
                    value: label
                })
            );
        }
    }

    function runBulkKick() {
        return runBulkAction({
            label: t('dialog.group_member_moderation.kick'),
            destructive: true,
            skipSelf: true,
            action: async (row) => {
                await groupProfileRepository.kickGroupMember({
                    groupId: group.id,
                    userId: moderationRowUserId(row)
                });
            }
        });
    }

    function runBulkBan() {
        return runBulkAction({
            label: t('dialog.group_member_moderation.ban'),
            destructive: true,
            skipSelf: true,
            action: async (row) => {
                await groupProfileRepository.banGroupMember({
                    groupId: group.id,
                    userId: moderationRowUserId(row)
                });
            }
        });
    }

    function runBulkUnban() {
        return runBulkAction({
            label: t('dialog.group_member_moderation.unban'),
            skipSelf: true,
            action: async (row) => {
                await groupProfileRepository.unbanGroupMember({
                    groupId: group.id,
                    userId: moderationRowUserId(row)
                });
            }
        });
    }

    function runBulkSaveNote(note: string) {
        return runBulkAction({
            label: t('dialog.group_member_moderation.save_note'),
            skipSelf: false,
            action: async (row) => {
                await groupProfileRepository.setGroupMemberProps({
                    groupId: group.id,
                    userId: moderationRowUserId(row),
                    params: { managerNotes: note }
                });
            }
        });
    }

    function runBulkAddRoles(roleIds: string[]) {
        return runBulkAction({
            label: t('dialog.group_member_moderation.add_roles'),
            skipSelf: true,
            action: async (row) => {
                const userId = moderationRowUserId(row);
                const currentRoleIds = new Set(moderationRowRoleIds(row));
                for (const roleId of roleIds) {
                    if (currentRoleIds.has(roleId)) {
                        continue;
                    }
                    await groupProfileRepository.addGroupMemberRole({
                        groupId: group.id,
                        userId,
                        roleId
                    });
                }
            }
        });
    }

    function runBulkRemoveRoles(roleIds: string[]) {
        return runBulkAction({
            label: t('dialog.group_member_moderation.remove_roles'),
            skipSelf: true,
            action: async (row) => {
                const userId = moderationRowUserId(row);
                const currentRoleIds = new Set(moderationRowRoleIds(row));
                for (const roleId of roleIds) {
                    if (!currentRoleIds.has(roleId)) {
                        continue;
                    }
                    await groupProfileRepository.removeGroupMemberRole({
                        groupId: group.id,
                        userId,
                        roleId
                    });
                }
            }
        });
    }

    async function runModerationAction(
        action: GroupModerationAction,
        row: EntityRecord
    ) {
        const userId = moderationRowUserId(row);
        if (!userId || actionKey) {
            return;
        }
        const label = moderationRowLabel(row);
        const result = await confirm({
            title: t('dialog.group.dynamic.value_group_user', {
                value: action.label
            }),
            description: label,
            confirmText: action.label,
            cancelText: t('common.actions.cancel'),
            destructive: Boolean(action.destructive)
        });
        if (!result.ok) {
            return;
        }

        const nextActionKey = `${activeTab}:${action.key}:${userId}`;
        setActionKey(nextActionKey);
        try {
            if (action.key === 'kick') {
                await groupProfileRepository.kickGroupMember({
                    groupId: group.id,
                    userId
                });
            } else if (action.key === 'ban') {
                await groupProfileRepository.banGroupMember({
                    groupId: group.id,
                    userId
                });
            } else if (action.key === 'unban') {
                await groupProfileRepository.unbanGroupMember({
                    groupId: group.id,
                    userId
                });
            } else if (action.key === 'delete-invite') {
                await groupProfileRepository.deleteSentGroupInvite({
                    groupId: group.id,
                    userId
                });
            } else if (action.key === 'accept-request') {
                await groupProfileRepository.respondGroupJoinRequest({
                    groupId: group.id,
                    userId,
                    action: 'accept'
                });
            } else if (action.key === 'reject-request') {
                await groupProfileRepository.respondGroupJoinRequest({
                    groupId: group.id,
                    userId,
                    action: 'reject'
                });
            } else if (action.key === 'block-request') {
                await groupProfileRepository.respondGroupJoinRequest({
                    groupId: group.id,
                    userId,
                    action: 'reject',
                    block: true
                });
            } else if (action.key === 'delete-blocked') {
                await groupProfileRepository.deleteBlockedGroupRequest({
                    groupId: group.id,
                    userId
                });
            }
            if (activeTab === 'members') {
                members.removeRow(userId);
            } else {
                setRowsByTab((current) => ({
                    ...current,
                    [activeTab]: (current[activeTab] || []).filter(
                        (item) => moderationRowUserId(item) !== userId
                    )
                }));
                setStatusByTab((current) => ({
                    ...current,
                    [activeTab]: 'ready'
                }));
                setErrorsByTab((current) => ({ ...current, [activeTab]: '' }));
            }
            toast.success(
                t('dialog.group.dynamic.value_completed', {
                    value: action.label
                })
            );
        } catch (actionError) {
            toast.error(
                actionError instanceof Error
                    ? actionError.message
                    : t('dialog.group.toast.value_failed', {
                          value: action.label
                      })
            );
        } finally {
            setActionKey('');
        }
    }

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
                onValueChange={(value) =>
                    setActiveTab(value as GroupModerationTabValue)
                }
                className="min-h-0 flex-1 gap-0"
            >
                <TabsList
                    variant="line"
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
                {bulkSelectable && selectedRows.length ? (
                    <div className="shrink-0">
                        <GroupModerationBulkPanel
                            tabValue={activeTab as 'bans' | 'members'}
                            group={group}
                            selectedRows={selectedRows}
                            busy={bulkBusy}
                            progress={bulkProgress}
                            onClear={clearSelection}
                            onRemoveRow={(userId) =>
                                toggleSelectedRow(userId, false)
                            }
                            onKick={runBulkKick}
                            onBan={runBulkBan}
                            onUnban={runBulkUnban}
                            onSaveNote={runBulkSaveNote}
                            onAddRoles={runBulkAddRoles}
                            onRemoveRoles={runBulkRemoveRoles}
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
                            actionKey={actionKey}
                            error={error}
                            group={group}
                            loading={loading}
                            onOpenUser={openModerationUserDialog}
                            onReload={() =>
                                setReloadToken((value) => value + 1)
                            }
                            onRunAction={runModerationAction}
                            onToggleAllVisible={toggleSelectedVisible}
                            onToggleRow={toggleSelectedRow}
                            rows={rows}
                            selectable={BULK_SELECTABLE_TABS.has(tab.value)}
                            selectedIds={selectedIds || undefined}
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
                onImported={() => setReloadToken((value) => value + 1)}
            />
        </div>
    );
}
