import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { groupProfileRepository } from '@/repositories/index.js';
import { useModalStore } from '@/state/modalStore.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    getGroupModerationTabs,
    moderationRowLabel,
    moderationRowUserId
} from './groupModerationRows.js';
import { GroupModerationTabPanel } from './GroupModerationTabPanel.jsx';

export function GroupModerationToolsDialog({
    open,
    onOpenChange,
    group,
    endpoint
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const [activeTab, setActiveTab] = useState('members');
    const [rowsByTab, setRowsByTab] = useState({});
    const [statusByTab, setStatusByTab] = useState({});
    const [errorsByTab, setErrorsByTab] = useState({});
    const [search, setSearch] = useState('');
    const [pageSize, setPageSize] = useState(25);
    const [pageIndex, setPageIndex] = useState(0);
    const [reloadToken, setReloadToken] = useState(0);
    const [actionKey, setActionKey] = useState('');
    const moderationTabs = getGroupModerationTabs(t);
    const rows = rowsByTab[activeTab] || [];
    const loading = statusByTab[activeTab] === 'running';
    const error = errorsByTab[activeTab] || '';

    useEffect(() => {
        if (!open) {
            return;
        }
        setActiveTab('members');
        setRowsByTab({});
        setStatusByTab({});
        setErrorsByTab({});
        setSearch('');
        setPageIndex(0);
        setActionKey('');
    }, [endpoint, group.id, open]);

    useEffect(() => {
        setSearch('');
        setPageIndex(0);
    }, [activeTab]);

    useEffect(() => {
        if (!open) {
            return;
        }

        let active = true;
        setStatusByTab((current) => ({ ...current, [activeTab]: 'running' }));
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
                      : activeTab === 'blocked'
                        ? groupProfileRepository.getAllGroupJoinRequests({
                              groupId: group.id,
                              endpoint,
                              blocked: true
                          })
                        : groupProfileRepository.getAllGroupLogs({
                              groupId: group.id,
                              endpoint
                          });

        request
            .then((nextRows) => {
                if (!active) {
                    return;
                }
                setRowsByTab((current) => ({
                    ...current,
                    [activeTab]: Array.isArray(nextRows) ? nextRows : []
                }));
                setStatusByTab((current) => ({
                    ...current,
                    [activeTab]: 'ready'
                }));
            })
            .catch((requestError) => {
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

    async function runModerationAction(action, row) {
        const userId = moderationRowUserId(row);
        if (!userId || actionKey) {
            return;
        }
        const label = moderationRowLabel(row);
        const result = await confirm({
            title: t('dialog.group.generated_dynamic.value_group_user', {
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
                t('dialog.group.generated_dynamic.value_completed', {
                    value: action.label
                })
            );
        } catch (actionError) {
            toast.error(
                actionError instanceof Error
                    ? actionError.message
                    : t('dialog.group.generated_toast.value_failed', {
                          value: action.label
                      })
            );
        } finally {
            setActionKey('');
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(92vw,64rem)]">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.group.generated.moderation_tools')}
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
                                className="flex-none rounded-none px-3"
                            >
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {moderationTabs.map((tab) => (
                        <GroupModerationTabPanel
                            key={tab.value}
                            actionKey={actionKey}
                            activeTab={activeTab}
                            error={error}
                            group={group}
                            loading={loading}
                            onPageIndexChange={setPageIndex}
                            onPageSizeChange={(nextPageSize) => {
                                setPageSize(nextPageSize);
                                setPageIndex(0);
                            }}
                            onReload={() =>
                                setReloadToken((value) => value + 1)
                            }
                            onRunAction={runModerationAction}
                            onSearchChange={(nextSearch) => {
                                setSearch(nextSearch);
                                setPageIndex(0);
                            }}
                            pageIndex={pageIndex}
                            pageSize={pageSize}
                            rows={rows}
                            search={search}
                            tab={tab}
                        />
                    ))}
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
