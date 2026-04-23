import { DownloadIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { formatDateFilter } from '@/lib/dateTime.js';
import { groupProfileRepository } from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { appI18n } from '@/services/i18nService.js';
import { useModalStore } from '@/state/modalStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/ui/shadcn/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { GroupListState } from './GroupListState.jsx';
import {
    downloadJsonFile,
    getGroupRoleNameMap
} from './groupDialogUtils.js';

const moderationTabs = [
    {
        value: 'members',
        label: appI18n.t('dialog.group.moderation_tabs.members')
    },
    { value: 'bans', label: appI18n.t('dialog.group.moderation_tabs.bans') },
    {
        value: 'invites',
        label: appI18n.t('dialog.group.moderation_tabs.invites')
    },
    {
        value: 'requests',
        label: appI18n.t('dialog.group.moderation_tabs.join_requests')
    },
    {
        value: 'blocked',
        label: appI18n.t('dialog.group.moderation_tabs.blocked_requests')
    },
    { value: 'logs', label: appI18n.t('dialog.group.moderation_tabs.logs') }
];

function moderationRowUserId(row) {
    return (
        row?.userId || row?.targetUserId || row?.user?.id || row?.actorId || ''
    );
}

function moderationRowLabel(row) {
    if (!row || typeof row !== 'object') {
        return String(row ?? '—');
    }
    return (
        row?.user?.displayName ||
        row?.displayName ||
        row?.targetDisplayName ||
        row?.actorDisplayName ||
        row?.userId ||
        row?.targetUserId ||
        row?.actorId ||
        row?.id ||
        '—'
    );
}

function moderationRowSubtitle(row) {
    return [
        row?.roleIds?.length ? row.roleIds.join(', ') : '',
        row?.action ||
            row?.eventType ||
            row?.type ||
            row?.membershipStatus ||
            '',
        row?.createdAt || row?.updatedAt || row?.joinedAt || ''
    ]
        .filter(Boolean)
        .join(' | ');
}

function moderationRowRoles(row, group) {
    const roles = getGroupRoleNameMap(group);
    const roleIds = Array.isArray(row?.roleIds)
        ? row.roleIds
        : Array.isArray(row?.user?.roleIds)
          ? row.user.roleIds
          : [];
    return roleIds
        .map((roleId) => roles.get(roleId) || 'Role')
        .filter(Boolean)
        .join(', ');
}

function moderationRowStatus(row) {
    return (
        row?.action ||
        row?.eventType ||
        row?.type ||
        row?.membershipStatus ||
        row?.visibility ||
        '—'
    );
}

function moderationRowDate(row) {
    return (
        row?.createdAt ||
        row?.created_at ||
        row?.updatedAt ||
        row?.updated_at ||
        row?.joinedAt ||
        row?.joined_at ||
        ''
    );
}

function moderationRowSearchText(row, group) {
    return [
        moderationRowLabel(row),
        moderationRowUserId(row),
        moderationRowRoles(row, group),
        moderationRowStatus(row),
        moderationRowDate(row),
        row?.description,
        row?.note,
        row?.managerNotes
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

export function GroupModerationToolsDialog({
    open,
    onOpenChange,
    group,
    endpoint
}) {
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
            .then((rows) => {
                if (!active) {
                    return;
                }
                setRowsByTab((current) => ({
                    ...current,
                    [activeTab]: Array.isArray(rows) ? rows : []
                }));
                setStatusByTab((current) => ({
                    ...current,
                    [activeTab]: 'ready'
                }));
            })
            .catch((error) => {
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
                        error instanceof Error
                            ? error.message
                            : 'Failed to load moderation data.'
                }));
            });

        return () => {
            active = false;
        };
    }, [activeTab, endpoint, group.id, open, reloadToken]);

    const rows = rowsByTab[activeTab] || [];
    const loading = statusByTab[activeTab] === 'running';
    const error = errorsByTab[activeTab] || '';
    const filteredRows = rows.filter((row) => {
        const query = search.trim().toLowerCase();
        return !query || moderationRowSearchText(row, group).includes(query);
    });
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const currentPageIndex = Math.min(pageIndex, totalPages - 1);
    const visibleRows = filteredRows.slice(
        currentPageIndex * pageSize,
        currentPageIndex * pageSize + pageSize
    );

    function moderationActions(row) {
        const userId = moderationRowUserId(row);
        if (!userId) {
            return [];
        }
        if (activeTab === 'members') {
            return [
                {
                    key: 'kick',
                    label: appI18n.t('dialog.group.moderation_tabs.kick'),
                    destructive: true
                },
                {
                    key: 'ban',
                    label: appI18n.t('dialog.group.moderation_tabs.ban'),
                    destructive: true
                }
            ];
        }
        if (activeTab === 'bans') {
            return [
                {
                    key: 'unban',
                    label: appI18n.t('dialog.group.moderation_tabs.unban')
                }
            ];
        }
        if (activeTab === 'invites') {
            return [
                {
                    key: 'delete-invite',
                    label: appI18n.t('dialog.group.moderation_tabs.delete'),
                    destructive: true
                }
            ];
        }
        if (activeTab === 'requests') {
            return [
                {
                    key: 'accept-request',
                    label: appI18n.t('dialog.group.moderation_tabs.accept')
                },
                {
                    key: 'reject-request',
                    label: appI18n.t('dialog.group.moderation_tabs.reject'),
                    destructive: true
                },
                {
                    key: 'block-request',
                    label: appI18n.t('dialog.group.moderation_tabs.block'),
                    destructive: true
                }
            ];
        }
        if (activeTab === 'blocked') {
            return [
                {
                    key: 'delete-blocked',
                    label: appI18n.t('dialog.group.moderation_tabs.delete'),
                    destructive: true
                }
            ];
        }
        return [];
    }

    async function runModerationAction(action, row) {
        const userId = moderationRowUserId(row);
        if (!userId || actionKey) {
            return;
        }
        const label = moderationRowLabel(row);
        const result = await confirm({
            title: appI18n.t('dialog.group.generated_dynamic.value_group_user', {
                value: action.label
            }),
            description: label,
            confirmText: action.label,
            cancelText: appI18n.t('common.actions.cancel'),
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
                appI18n.t('dialog.group.generated_dynamic.value_completed', {
                    value: action.label
                })
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.group.generated_toast.value_failed', {
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
                        {appI18n.t('dialog.group.generated.moderation_tools')}
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
                        <TabsContent
                            key={tab.value}
                            value={tab.value}
                            className="m-0 max-h-[65vh] overflow-auto pt-4"
                        >
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={loading}
                                        onClick={() =>
                                            setReloadToken((value) => value + 1)
                                        }
                                    >
                                        <RefreshCwIcon data-icon="inline-start" />
                                        {appI18n.t('common.actions.refresh')}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={!rows.length}
                                        onClick={() =>
                                            downloadJsonFile(
                                                `${group.id}_${activeTab}.json`,
                                                rows
                                            )
                                        }
                                    >
                                        <DownloadIcon data-icon="inline-start" />
                                        JSON
                                    </Button>
                                    <span className="text-muted-foreground text-sm">
                                        {filteredRows.length}/{rows.length}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={search}
                                        onChange={(event) => {
                                            setSearch(event.target.value);
                                            setPageIndex(0);
                                        }}
                                        placeholder={appI18n.t(
                                            'dialog.group.generated_dynamic.search_value',
                                            { value: tab.label.toLowerCase() }
                                        )}
                                        className="h-8 w-64"
                                    />
                                    <Select
                                        value={String(pageSize)}
                                        onValueChange={(value) => {
                                            setPageSize(
                                                Number.parseInt(value, 10) || 25
                                            );
                                            setPageIndex(0);
                                        }}
                                    >
                                        <SelectTrigger
                                            size="sm"
                                            className="w-24"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {[10, 25, 50, 100].map(
                                                    (size) => (
                                                        <SelectItem
                                                            key={size}
                                                            value={String(size)}
                                                        >
                                                            {size}
                                                        </SelectItem>
                                                    )
                                                )}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            {loading ? (
                                <GroupListState
                                    title={appI18n.t(
                                        'dialog.group.generated_dynamic.no_value',
                                        { value: tab.label.toLowerCase() }
                                    )}
                                    loading
                                />
                            ) : null}
                            {error ? (
                                <GroupListState
                                    title={appI18n.t(
                                        'dialog.group.generated_dynamic.no_value',
                                        { value: tab.label.toLowerCase() }
                                    )}
                                    error={error}
                                />
                            ) : null}
                            {!loading && !error ? (
                                <div className="overflow-auto rounded-md border">
                                    <Table>
                                        <TableHeader className="bg-background sticky top-0">
                                            <TableRow>
                                                <TableHead className="w-56">
                                                    {appI18n.t(
                                                        'dialog.group.generated.user'
                                                    )}
                                                </TableHead>
                                                <TableHead>
                                                    {appI18n.t(
                                                        'dialog.group.generated.roles_description'
                                                    )}
                                                </TableHead>
                                                <TableHead className="w-44">
                                                    {appI18n.t(
                                                        'dialog.group.generated.status'
                                                    )}
                                                </TableHead>
                                                <TableHead className="w-44">
                                                    {appI18n.t(
                                                        'dialog.group.generated.date'
                                                    )}
                                                </TableHead>
                                                <TableHead className="w-48 text-right">
                                                    {appI18n.t(
                                                        'dialog.group.generated.actions'
                                                    )}
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {visibleRows.length ? (
                                                visibleRows.map(
                                                    (row, index) => {
                                                        const userId =
                                                            moderationRowUserId(
                                                                row
                                                            );
                                                        const label =
                                                            moderationRowLabel(
                                                                row
                                                            );
                                                        const date =
                                                            moderationRowDate(
                                                                row
                                                            );
                                                        const actions =
                                                            moderationActions(
                                                                row
                                                            );
                                                        return (
                                                            <TableRow
                                                                key={`${label}:${date}:${index}`}
                                                            >
                                                                <TableCell className="align-top">
                                                                    {userId ? (
                                                                        <Button
                                                                            type="button"
                                                                            variant="ghost"
                                                                            className="hover:text-primary h-auto max-w-52 justify-start truncate p-0 text-left font-medium"
                                                                            onClick={() =>
                                                                                openUserDialog(
                                                                                    {
                                                                                        userId,
                                                                                        title: label,
                                                                                        seedData:
                                                                                            row?.user ||
                                                                                            null
                                                                                    }
                                                                                )
                                                                            }
                                                                        >
                                                                            {
                                                                                label
                                                                            }
                                                                        </Button>
                                                                    ) : (
                                                                        <span className="font-medium">
                                                                            {
                                                                                label
                                                                            }
                                                                        </span>
                                                                    )}
                                                                    <div className="text-muted-foreground truncate font-mono text-xs">
                                                                        {userId ||
                                                                            row?.id ||
                                                                            '—'}
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-muted-foreground align-top text-xs whitespace-normal">
                                                                    {moderationRowRoles(
                                                                        row,
                                                                        group
                                                                    ) ||
                                                                        row?.description ||
                                                                        row?.note ||
                                                                        row?.managerNotes ||
                                                                        moderationRowSubtitle(
                                                                            row
                                                                        ) ||
                                                                        '—'}
                                                                </TableCell>
                                                                <TableCell className="align-top text-xs whitespace-normal">
                                                                    {moderationRowStatus(
                                                                        row
                                                                    )}
                                                                </TableCell>
                                                                <TableCell className="text-muted-foreground align-top text-xs">
                                                                    {date
                                                                        ? formatDateFilter(
                                                                              date,
                                                                              'long'
                                                                          )
                                                                        : '—'}
                                                                </TableCell>
                                                                <TableCell className="align-top">
                                                                    <div className="flex justify-end gap-2">
                                                                        {actions.map(
                                                                            (
                                                                                action
                                                                            ) => {
                                                                                const nextActionKey = `${activeTab}:${action.key}:${userId}`;
                                                                                return (
                                                                                    <Button
                                                                                        key={
                                                                                            action.key
                                                                                        }
                                                                                        type="button"
                                                                                        size="sm"
                                                                                        variant={
                                                                                            action.destructive
                                                                                                ? 'outline'
                                                                                                : 'secondary'
                                                                                        }
                                                                                        disabled={Boolean(
                                                                                            actionKey
                                                                                        )}
                                                                                        onClick={() =>
                                                                                            void runModerationAction(
                                                                                                action,
                                                                                                row
                                                                                            )
                                                                                        }
                                                                                    >
                                                                                        {actionKey ===
                                                                                        nextActionKey
                                                                                            ? '...'
                                                                                            : action.label}
                                                                                    </Button>
                                                                                );
                                                                            }
                                                                        )}
                                                                    </div>
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    }
                                                )
                                            ) : (
                                                <TableRow>
                                                    <TableCell
                                                        colSpan={5}
                                                        className="text-muted-foreground py-8 text-center text-sm"
                                                    >
                                                        {appI18n.t(
                                                            'dialog.group.generated.no_rows'
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            ) : null}
                            {!loading && !error ? (
                                <div className="mt-3 flex items-center justify-between">
                                    <span className="text-muted-foreground text-sm">
                                        {appI18n.t(
                                            'dialog.group.generated.page'
                                        )}{' '}
                                        {currentPageIndex + 1} / {totalPages}
                                    </span>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={currentPageIndex <= 0}
                                            onClick={() =>
                                                setPageIndex((value) =>
                                                    Math.max(0, value - 1)
                                                )
                                            }
                                        >
                                            {appI18n.t(
                                                'table.pagination.previous'
                                            )}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                currentPageIndex >=
                                                totalPages - 1
                                            }
                                            onClick={() =>
                                                setPageIndex((value) =>
                                                    Math.min(
                                                        totalPages - 1,
                                                        value + 1
                                                    )
                                                )
                                            }
                                        >
                                            {appI18n.t('table.pagination.next')}
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </TabsContent>
                    ))}
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
