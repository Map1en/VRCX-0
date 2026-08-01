import { UploadIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type {
    EntityRecord,
    GroupProfileRecord
} from '@/domain/entities/profileEntities';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import {
    commands,
    type GroupModerationBatchAction,
    type GroupModerationBatchProgress as GroupModerationBatchProgressEvent
} from '@/platform/tauri/bindings';
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
import { buildGroupModerationBatchInput } from './groupModerationBatch';
import {
    GroupModerationBulkPanel,
    type GroupModerationBulkProgress
} from './GroupModerationBulkPanel';
import { GroupModerationLogsPanel } from './GroupModerationLogsPanel';
import {
    getGroupModerationTabs,
    moderationRowLabel,
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

function isGroupModerationBatchProgress(
    value: unknown
): value is GroupModerationBatchProgressEvent {
    return Boolean(
        value &&
        typeof value === 'object' &&
        'groupId' in value &&
        typeof value.groupId === 'string' &&
        'ownerUserId' in value &&
        typeof value.ownerUserId === 'string' &&
        'endpoint' in value &&
        typeof value.endpoint === 'string' &&
        'completed' in value &&
        typeof value.completed === 'number' &&
        'total' in value &&
        typeof value.total === 'number'
    );
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
    const currentAuthEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const batchProgressEvent = useRuntimeStore(
        (state) => state.runtimeEvents.groupModerationBatchProgress
    );
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
    const bulkProgressEventCountRef = useRef(0);
    const bulkRunSequenceRef = useRef(0);
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

    useEffect(() => {
        const progress = batchProgressEvent?.lastPayload;
        if (
            bulkBusy &&
            batchProgressEvent &&
            batchProgressEvent.count > bulkProgressEventCountRef.current &&
            isGroupModerationBatchProgress(progress) &&
            progress.ownerUserId === currentUserId &&
            progress.endpoint === endpoint &&
            currentAuthEndpoint === endpoint &&
            progress.groupId === group.id
        ) {
            setBulkProgress({
                current: progress.completed,
                total: progress.total
            });
        }
    }, [
        batchProgressEvent,
        bulkBusy,
        currentAuthEndpoint,
        currentUserId,
        endpoint,
        group.id
    ]);

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
            bulkRunSequenceRef.current += 1;
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
        action,
        label,
        destructive = false,
        roleIds
    }: {
        action: GroupModerationBatchAction;
        label: string;
        destructive?: boolean;
        roleIds?: string[];
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
        const batchOwnerUserId = useRuntimeStore.getState().auth.currentUserId;
        const batchEndpoint = endpoint;
        if (
            !batchOwnerUserId ||
            batchOwnerUserId !== currentUserId ||
            useRuntimeStore.getState().auth.currentUserEndpoint !==
                batchEndpoint
        ) {
            return;
        }

        const batchRunSequence = bulkRunSequenceRef.current + 1;
        bulkRunSequenceRef.current = batchRunSequence;
        const isCurrentBatchRun = () => {
            const auth = useRuntimeStore.getState().auth;
            return (
                bulkRunSequenceRef.current === batchRunSequence &&
                auth.currentUserId === batchOwnerUserId &&
                auth.currentUserEndpoint === batchEndpoint
            );
        };
        setBulkBusy(true);
        bulkProgressEventCountRef.current = batchProgressEvent?.count ?? 0;
        setBulkProgress({ current: 0, total: targetRows.length });
        try {
            const batchResult = await commands.appGroupModerationBatch(
                buildGroupModerationBatchInput({
                    action,
                    expectedEndpoint: endpoint,
                    expectedOwnerUserId: batchOwnerUserId,
                    groupId: group.id,
                    roleIds,
                    rows: targetRows
                })
            );
            if (
                !isCurrentBatchRun() ||
                batchResult.ownerUserId !== batchOwnerUserId ||
                batchResult.endpoint !== batchEndpoint
            ) {
                return;
            }
            setBulkProgress({
                current: batchResult.total,
                total: batchResult.total
            });
            const rowsByUserId = new Map(
                targetRows.map((row) => [moderationRowUserId(row), row])
            );
            for (const item of batchResult.items) {
                if (
                    item.state !== 'failed' &&
                    item.state !== 'partiallyApplied' &&
                    item.state !== 'notAttempted'
                ) {
                    continue;
                }
                const row = rowsByUserId.get(item.userId);
                toast.error(
                    `${moderationRowLabel(row || item.userId)}: ${userFacingErrorMessage(
                        item.message,
                        t('dialog.group.toast.value_failed', { value: label })
                    )}`
                );
            }
            if (batchResult.succeeded) {
                toast.success(
                    t('dialog.group_member_moderation.bulk_action_completed', {
                        count: batchResult.succeeded,
                        value: label
                    })
                );
            }
        } catch (actionError) {
            if (isCurrentBatchRun()) {
                toast.error(
                    userFacingErrorMessage(
                        actionError,
                        t('dialog.group.toast.value_failed', { value: label })
                    )
                );
            }
        } finally {
            if (bulkRunSequenceRef.current === batchRunSequence) {
                setBulkBusy(false);
                setBulkProgress(null);
                if (isCurrentBatchRun()) {
                    clearSelection();
                    setReloadToken((value) => value + 1);
                }
            }
        }
    }

    function runBulkKick() {
        return runBulkAction({
            action: { type: 'kick' },
            label: t('dialog.group_member_moderation.kick'),
            destructive: true
        });
    }

    function runBulkBan() {
        return runBulkAction({
            action: { type: 'ban' },
            label: t('dialog.group_member_moderation.ban'),
            destructive: true
        });
    }

    function runBulkUnban() {
        return runBulkAction({
            action: { type: 'unban' },
            label: t('dialog.group_member_moderation.unban')
        });
    }

    function runBulkSaveNote(note: string) {
        return runBulkAction({
            action: { type: 'saveNote', note },
            label: t('dialog.group_member_moderation.save_note')
        });
    }

    function runBulkAddRoles(roleIds: string[]) {
        return runBulkAction({
            action: { type: 'addRoles' },
            label: t('dialog.group_member_moderation.add_roles'),
            roleIds
        });
    }

    function runBulkRemoveRoles(roleIds: string[]) {
        return runBulkAction({
            action: { type: 'removeRoles' },
            label: t('dialog.group_member_moderation.remove_roles'),
            roleIds
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
