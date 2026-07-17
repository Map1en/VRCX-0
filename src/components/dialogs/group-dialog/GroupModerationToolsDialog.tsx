import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type {
    EntityRecord,
    GroupProfileRecord
} from '@/domain/entities/profileEntities';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { useModalStore } from '@/state/modalStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { GroupModerationLogsPanel } from './GroupModerationLogsPanel';
import {
    getGroupModerationTabs,
    moderationRowLabel,
    moderationRowUserId,
    resolveGroupModerationActiveTab,
    type GroupModerationAction
} from './groupModerationRows';
import { GroupModerationTabPanel } from './GroupModerationTabPanel';

function isEntityRecord(value: unknown): value is EntityRecord {
    return Boolean(value && typeof value === 'object');
}

export function GroupModerationToolsDialog({
    open,
    onOpenChange,
    group,
    endpoint
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    group: GroupProfileRecord;
    endpoint: string;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const [activeTab, setActiveTab] = useState('members');
    const [rowsByTab, setRowsByTab] = useState<Record<string, EntityRecord[]>>(
        {}
    );
    const [statusByTab, setStatusByTab] = useState<Record<string, string>>({});
    const [errorsByTab, setErrorsByTab] = useState<Record<string, string>>({});
    const [search, setSearch] = useState('');
    const [pageSize, setPageSize] = useState(25);
    const [pageIndex, setPageIndex] = useState(0);
    const [reloadToken, setReloadToken] = useState(0);
    const [actionKey, setActionKey] = useState('');
    const resetKeyRef = useRef('');
    const moderationTabs = useMemo(
        () => getGroupModerationTabs(t, group),
        [group.id, group.myMember, group.roles, t]
    );
    const resetKey = `${endpoint}\u0000${group.id || ''}`;
    const rows = rowsByTab[activeTab] || [];
    const loading = statusByTab[activeTab] === 'running';
    const error = errorsByTab[activeTab] || '';

    useEffect(() => {
        if (!open) {
            resetKeyRef.current = '';
            return;
        }

        if (resetKeyRef.current !== resetKey) {
            resetKeyRef.current = resetKey;
            setActiveTab(
                resolveGroupModerationActiveTab('members', moderationTabs)
            );
            setRowsByTab({});
            setStatusByTab({});
            setErrorsByTab({});
            setSearch('');
            setPageIndex(0);
            setActionKey('');
            return;
        }

        setActiveTab((current) =>
            resolveGroupModerationActiveTab(current, moderationTabs)
        );
    }, [moderationTabs, open, resetKey]);

    useEffect(() => {
        setSearch('');
        setPageIndex(0);
    }, [activeTab]);

    useEffect(() => {
        if (!open || !activeTab || activeTab === 'logs') {
            return;
        }

        let active = true;
        setStatusByTab((current) => ({
            ...current,
            [activeTab]: 'running'
        }));
        setErrorsByTab((current) => ({ ...current, [activeTab]: '' }));

        const request =
            activeTab === 'members'
                ? groupProfileRepository.getAllGroupMembers({
                      groupId: group.id,
                      endpoint
                  })
                : activeTab === 'bans'
                  ? groupProfileRepository.getAllGroupBans({
                        groupId: group.id,
                        endpoint
                    })
                  : activeTab === 'invites'
                    ? groupProfileRepository.getAllGroupInvites({
                          groupId: group.id,
                          endpoint
                      })
                    : activeTab === 'requests'
                      ? groupProfileRepository.getAllGroupJoinRequests({
                            groupId: group.id,
                            endpoint,
                            blocked: false
                        })
                      : groupProfileRepository.getAllGroupJoinRequests({
                            groupId: group.id,
                            endpoint,
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
    }, [activeTab, endpoint, group.id, open, reloadToken]);

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
                    userId,
                    endpoint
                });
            } else if (action.key === 'ban') {
                await groupProfileRepository.banGroupMember({
                    groupId: group.id,
                    userId,
                    endpoint
                });
            } else if (action.key === 'unban') {
                await groupProfileRepository.unbanGroupMember({
                    groupId: group.id,
                    userId,
                    endpoint
                });
            } else if (action.key === 'delete-invite') {
                await groupProfileRepository.deleteSentGroupInvite({
                    groupId: group.id,
                    userId,
                    endpoint
                });
            } else if (action.key === 'accept-request') {
                await groupProfileRepository.respondGroupJoinRequest({
                    groupId: group.id,
                    userId,
                    action: 'accept',
                    endpoint
                });
            } else if (action.key === 'reject-request') {
                await groupProfileRepository.respondGroupJoinRequest({
                    groupId: group.id,
                    userId,
                    action: 'reject',
                    endpoint
                });
            } else if (action.key === 'block-request') {
                await groupProfileRepository.respondGroupJoinRequest({
                    groupId: group.id,
                    userId,
                    action: 'reject',
                    block: true,
                    endpoint
                });
            } else if (action.key === 'delete-blocked') {
                await groupProfileRepository.deleteBlockedGroupRequest({
                    groupId: group.id,
                    userId,
                    endpoint
                });
            }
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[min(92vw,64rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.group.actions.moderation_tools')}
                    </DialogTitle>
                    <DialogDescription>
                        {group.name || 'Group'}
                    </DialogDescription>
                </DialogHeader>
                <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="min-h-0 gap-0"
                >
                    <TabsList
                        variant="line"
                        className="h-auto w-full justify-start overflow-x-auto rounded-none border-b px-0 pb-1"
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
                    {moderationTabs.map((tab) =>
                        tab.value === 'logs' ? (
                            <GroupModerationLogsPanel
                                key={tab.value}
                                active={activeTab === 'logs'}
                                endpoint={endpoint}
                                group={group}
                                open={open}
                            />
                        ) : (
                            <GroupModerationTabPanel
                                key={tab.value}
                                actionKey={actionKey}
                                activeTab={activeTab}
                                error={error}
                                group={group}
                                loading={loading}
                                onPageIndexChange={setPageIndex}
                                onPageSizeChange={(nextPageSize: number) => {
                                    setPageSize(nextPageSize);
                                    setPageIndex(0);
                                }}
                                onReload={() =>
                                    setReloadToken((value) => value + 1)
                                }
                                onRunAction={runModerationAction}
                                onSearchChange={(nextSearch: string) => {
                                    setSearch(nextSearch);
                                    setPageIndex(0);
                                }}
                                pageIndex={pageIndex}
                                pageSize={pageSize}
                                rows={rows}
                                search={search}
                                tab={tab}
                            />
                        )
                    )}
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
