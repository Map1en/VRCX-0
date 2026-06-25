import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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

import {
    getGroupModerationTabs,
    moderationRowLabel,
    moderationRowUserId
} from './groupModerationRows';
import { GroupModerationTabPanel } from './GroupModerationTabPanel';

export function GroupModerationToolsDialog({
    open,
    onOpenChange,
    group,
    endpoint
}: any) {
    const { t } = useTranslation();
    const confirm = useModalStore((state: any) => state.confirm);
    const [activeTab, setActiveTab] = useState('members');
    const [rowsByTab, setRowsByTab] = useState<any>({});
    const [statusByTab, setStatusByTab] = useState<any>({});
    const [errorsByTab, setErrorsByTab] = useState<any>({});
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
        setStatusByTab((current: any) => ({
            ...current,
            [activeTab]: 'running'
        }));
        setErrorsByTab((current: any) => ({ ...current, [activeTab]: '' }));

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
            .then((nextRows: any) => {
                if (!active) {
                    return;
                }
                setRowsByTab((current: any) => ({
                    ...current,
                    [activeTab]: Array.isArray(nextRows) ? nextRows : []
                }));
                setStatusByTab((current: any) => ({
                    ...current,
                    [activeTab]: 'ready'
                }));
            })
            .catch((requestError: any) => {
                if (!active) {
                    return;
                }
                setStatusByTab((current: any) => ({
                    ...current,
                    [activeTab]: 'error'
                }));
                setErrorsByTab((current: any) => ({
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

    async function runModerationAction(action: any, row: any) {
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
            setRowsByTab((current: any) => ({
                ...current,
                [activeTab]: (current[activeTab] || []).filter(
                    (item: any) => moderationRowUserId(item) !== userId
                )
            }));
            setStatusByTab((current: any) => ({
                ...current,
                [activeTab]: 'ready'
            }));
            setErrorsByTab((current: any) => ({ ...current, [activeTab]: '' }));
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
                        {moderationTabs.map((tab: any) => (
                            <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className="flex-none rounded-none px-3"
                            >
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {moderationTabs.map((tab: any) => (
                        <GroupModerationTabPanel
                            key={tab.value}
                            actionKey={actionKey}
                            activeTab={activeTab}
                            error={error}
                            group={group}
                            loading={loading}
                            onPageIndexChange={setPageIndex}
                            onPageSizeChange={(nextPageSize: any) => {
                                setPageSize(nextPageSize);
                                setPageIndex(0);
                            }}
                            onReload={() =>
                                setReloadToken((value: any) => value + 1)
                            }
                            onRunAction={runModerationAction}
                            onSearchChange={(nextSearch: any) => {
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
