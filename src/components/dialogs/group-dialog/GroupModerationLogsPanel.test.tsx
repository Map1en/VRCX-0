import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
    const translations: Record<string, string> = {
        'common.actions.refresh': 'Refresh',
        'dialog.group.empty.no_rows': 'No rows',
        'dialog.group.label.actions': 'Actions',
        'dialog.group.label.date': 'Date',
        'dialog.group.label.page': 'Page',
        'dialog.group.dynamic.search_value': 'Search logs',
        'dialog.group_member_moderation.created_at': 'Created At',
        'dialog.group_member_moderation.data': 'Data',
        'dialog.group_member_moderation.description': 'Description',
        'dialog.group_member_moderation.display_name': 'Display Name',
        'dialog.group_member_moderation.filter_type': 'Filter Type',
        'dialog.group_member_moderation.type': 'Type',
        'table.pagination.next': 'Next',
        'table.pagination.previous': 'Previous'
    };

    return {
        useTranslation: () => ({
            t: (key: string) => translations[key] || key
        })
    };
});

vi.mock('@/lib/dateTime', () => ({
    formatDateFilter: (value: string) => `formatted:${value}`
}));

vi.mock('@/components/Location', async () => {
    const React = await import('react');

    return {
        Location: ({ location }: { location?: string }) =>
            React.createElement('span', { 'data-location': location }, location)
    };
});

vi.mock('@/services/dialogService', () => ({
    openUserDialog: vi.fn()
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    type ButtonProps = React.PropsWithChildren<Record<string, unknown>>;

    return {
        Button: ({ children, ...props }: ButtonProps) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/dropdown-menu', async () => {
    const React = await import('react');

    type ChildrenProps = React.PropsWithChildren<Record<string, unknown>>;

    return {
        DropdownMenu: ({ children }: ChildrenProps) =>
            React.createElement('div', null, children),
        DropdownMenuCheckboxItem: ({
            children,
            checked
        }: ChildrenProps & { checked?: boolean }) =>
            React.createElement(
                'button',
                { 'data-checked': checked ? 'true' : 'false' },
                children
            ),
        DropdownMenuContent: ({ children }: ChildrenProps) =>
            React.createElement('div', null, children),
        DropdownMenuTrigger: ({ children }: ChildrenProps) =>
            React.createElement(React.Fragment, null, children)
    };
});

vi.mock('@/ui/shadcn/input', async () => {
    const React = await import('react');

    return {
        Input: (props: Record<string, unknown>) =>
            React.createElement('input', props)
    };
});

vi.mock('@/ui/shadcn/select', async () => {
    const React = await import('react');

    type ChildrenProps = React.PropsWithChildren<Record<string, unknown>>;

    return {
        Select: ({ children }: ChildrenProps) =>
            React.createElement('div', null, children),
        SelectContent: ({ children }: ChildrenProps) =>
            React.createElement('div', null, children),
        SelectGroup: ({ children }: ChildrenProps) =>
            React.createElement('div', null, children),
        SelectItem: ({ children, value }: ChildrenProps & { value?: string }) =>
            React.createElement('option', { value }, children),
        SelectTrigger: ({ children }: ChildrenProps) =>
            React.createElement('button', null, children),
        SelectValue: () => React.createElement('span', null, '25')
    };
});

vi.mock('@/ui/shadcn/table', async () => {
    const React = await import('react');

    type ChildrenProps = React.PropsWithChildren<Record<string, unknown>>;

    return {
        Table: ({ children }: ChildrenProps) =>
            React.createElement('table', null, children),
        TableBody: ({ children }: ChildrenProps) =>
            React.createElement('tbody', null, children),
        TableCell: ({ children, colSpan }: ChildrenProps) =>
            React.createElement('td', { colSpan }, children),
        TableHead: ({ children }: ChildrenProps) =>
            React.createElement('th', null, children),
        TableHeader: ({ children }: ChildrenProps) =>
            React.createElement('thead', null, children),
        TableRow: ({ children }: ChildrenProps) =>
            React.createElement('tr', null, children)
    };
});

vi.mock('@/ui/shadcn/tabs', async () => {
    const React = await import('react');

    type ChildrenProps = React.PropsWithChildren<Record<string, unknown>>;

    return {
        TabsContent: ({ children }: ChildrenProps) =>
            React.createElement('div', null, children)
    };
});

import type { CellContext } from '@tanstack/react-table';

import { openUserDialog } from '@/services/dialogService';

import {
    createGroupAuditLogColumns,
    filterGroupAuditLogs,
    formatGroupAuditLogTypeName,
    type GroupAuditLogRow,
    groupAuditLogActorDialogArgs,
    openGroupAuditLogActor,
    toggleGroupAuditLogType
} from './GroupModerationLogsPanel';

describe('GroupModerationLogsPanel', () => {
    const row = {
        id: 'log_1',
        actorDisplayName: 'Moderator Alice',
        actorId: 'usr_actor',
        created_at: '2026-06-29T10:00:00Z',
        data: {
            reason: 'spam'
        },
        description: 'Banned Bob from the group',
        eventType: 'group.member.ban',
        targetId: 'wrld_target'
    };

    it('formats audit log type names for the filter menu', () => {
        expect(formatGroupAuditLogTypeName('group.member.ban')).toBe(
            'Member Ban'
        );
        expect(formatGroupAuditLogTypeName('')).toBe('');
    });

    it('toggles audit log event type selections without reordering survivors', () => {
        expect(
            toggleGroupAuditLogType(['group.member.ban'], 'group.member.kick')
        ).toEqual(['group.member.ban', 'group.member.kick']);
        expect(
            toggleGroupAuditLogType(['group.member.ban'], 'group.member.ban')
        ).toEqual([]);
    });

    it('filters logs by description only', () => {
        expect(filterGroupAuditLogs([row], 'banned')).toEqual([row]);
        expect(filterGroupAuditLogs([row], 'Moderator Alice')).toEqual([]);
    });

    it('builds actor dialog args from the actor fields', () => {
        expect(groupAuditLogActorDialogArgs(row)).toEqual({
            seedData: {
                displayName: 'Moderator Alice',
                id: 'usr_actor'
            },
            title: 'Moderator Alice',
            userId: 'usr_actor'
        });
    });

    it('opens the actor user dialog from the log row actor fields', () => {
        vi.mocked(openUserDialog).mockClear();

        openGroupAuditLogActor(row);

        expect(openUserDialog).toHaveBeenCalledWith({
            seedData: {
                displayName: 'Moderator Alice',
                id: 'usr_actor'
            },
            title: 'Moderator Alice',
            userId: 'usr_actor'
        });
    });

    it('renders dedicated log columns including target location and raw data', () => {
        const columns = createGroupAuditLogColumns((key: string) => key);
        const html = columns
            .map((column) => {
                const cell = column.cell;
                if (typeof cell !== 'function') {
                    return '';
                }
                return renderToStaticMarkup(
                    React.createElement(
                        React.Fragment,
                        null,
                        cell({
                            row: { original: row }
                        } as unknown as CellContext<GroupAuditLogRow, unknown>)
                    )
                );
            })
            .join('');

        expect(html).toContain('formatted:2026-06-29T10:00:00Z');
        expect(html).toContain('Member Ban');
        expect(html).toContain('Moderator Alice');
        expect(html).toContain('Banned Bob from the group');
        expect(html).toContain('&quot;reason&quot;:&quot;spam&quot;');
        expect(html).toContain('data-location="wrld_target"');
    });
});
