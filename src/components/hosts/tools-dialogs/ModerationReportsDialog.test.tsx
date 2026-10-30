// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import {
    createContext,
    useContext,
    type ButtonHTMLAttributes,
    type PropsWithChildren,
    type ReactNode
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModerationReportRecord } from '@/repositories/vrchatToolsRepository';

const mocks = vi.hoisted(() => ({
    getModerationReports: vi.fn(),
    openUserDialog: vi.fn(),
    toastAdd: vi.fn()
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) =>
            values ? `${key}:${JSON.stringify(values)}` : key
    })
}));

vi.mock('@/repositories/vrchatToolsRepository', () => ({
    default: {
        getModerationReports: mocks.getModerationReports
    }
}));

vi.mock('@/services/dialogService', () => ({
    openUserDialog: mocks.openUserDialog,
    openAvatarDialog: vi.fn(),
    openWorldDialog: vi.fn(),
    openGroupDialog: vi.fn()
}));

vi.mock('./toolsDialogUtils', () => ({
    getCurrentUserId: () => 'usr_me'
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/lib/dateTime', () => ({
    formatDateFilter: (value: string) => `date:${value}`
}));

vi.mock('@/components/layout/PageScaffold', () => ({
    EmptyState: ({
        title,
        description
    }: {
        title?: ReactNode;
        description?: ReactNode;
    }) => (
        <div>
            {title}
            {description}
        </div>
    ),
    LoadingState: () => <div>loading</div>
}));

vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        variant: _variant,
        size: _size,
        ...props
    }: PropsWithChildren<
        ButtonHTMLAttributes<HTMLButtonElement> & {
            variant?: unknown;
            size?: unknown;
        }
    >) => <button {...props}>{children}</button>
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

vi.mock('@/ui/shadcn/spinner', () => ({
    Spinner: () => <span>spinner</span>
}));

vi.mock('@/ui/shadcn/tabs', () => {
    const TabsChange = createContext<(value: string) => void>(() => {});
    return {
        Tabs: ({
            children,
            onValueChange
        }: PropsWithChildren<{ onValueChange: (value: string) => void }>) => (
            <TabsChange.Provider value={onValueChange}>
                {children}
            </TabsChange.Provider>
        ),
        TabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
        TabsTrigger: ({
            children,
            value
        }: PropsWithChildren<{ value: string }>) => {
            const onValueChange = useContext(TabsChange);
            return (
                <button type="button" onClick={() => onValueChange(value)}>
                    {children}
                </button>
            );
        },
        TabsContent: ({ children }: PropsWithChildren) => <div>{children}</div>
    };
});

vi.mock('@/ui/shadcn/select', () => {
    const SelectChange = createContext<(value: string) => void>(() => {});
    return {
        Select: ({
            children,
            onValueChange
        }: PropsWithChildren<{ onValueChange: (value: string) => void }>) => (
            <SelectChange.Provider value={onValueChange}>
                {children}
            </SelectChange.Provider>
        ),
        SelectTrigger: () => null,
        SelectValue: () => null,
        SelectContent: ({ children }: PropsWithChildren) => <>{children}</>,
        SelectGroup: ({ children }: PropsWithChildren) => <>{children}</>,
        SelectItem: ({
            children,
            value
        }: PropsWithChildren<{ value: string }>) => {
            const onValueChange = useContext(SelectChange);
            return (
                <button type="button" onClick={() => onValueChange(value)}>
                    {children}
                </button>
            );
        }
    };
});

vi.mock('@/ui/shadcn/tooltip', () => ({
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipTrigger: ({ render }: { render: ReactNode }) => render,
    TooltipContent: () => null
}));

import { ModerationReportsDialog } from './ModerationReportsDialog';

function report(id: string, contentName: string): ModerationReportRecord {
    return {
        id,
        type: 'user',
        category: 'behavior',
        reason: 'behavior-hacking',
        contentId: `usr_${id}`,
        contentName,
        created: '2026-10-14T12:00:00.000Z'
    };
}

async function openDialog() {
    render(<ModerationReportsDialog open onOpenChange={() => {}} />);
    await screen.findByText('Milfy');
}

describe('ModerationReportsDialog', () => {
    beforeEach(() => {
        mocks.getModerationReports.mockImplementation(
            ({ closedOnly }: { closedOnly: boolean }) =>
                Promise.resolve({
                    results: closedOnly
                        ? [report('mr_9', 'Closed Group')]
                        : [report('mr_1', 'Milfy'), report('mr_2', 'Mafuyu')],
                    hasNext: false
                })
        );
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('starts on open reports and opens the reported user', async () => {
        await openDialog();

        expect(mocks.getModerationReports).toHaveBeenCalledWith({
            currentUserId: 'usr_me',
            offset: 0,
            closedOnly: false,
            reportType: null
        });
        expect(
            screen.getAllByText('view.search.user.header · behavior-hacking')
        ).toHaveLength(2);
        expect(
            screen.getAllByText('date:2026-10-14T12:00:00.000Z')
        ).toHaveLength(2);
        expect(screen.queryByText('Closed Group')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Milfy' }));

        expect(mocks.openUserDialog).toHaveBeenCalledWith({
            userId: 'usr_mr_1'
        });
    });

    it('loads closed reports from the closed tab', async () => {
        await openDialog();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.moderation_reports.status_closed'
            })
        );

        await screen.findByText('Closed Group');
        expect(mocks.getModerationReports).toHaveBeenLastCalledWith({
            currentUserId: 'usr_me',
            offset: 0,
            closedOnly: true,
            reportType: null
        });
        expect(screen.queryByText('Milfy')).toBeNull();
    });

    it('keeps the type filter when switching between open and closed', async () => {
        await openDialog();

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.moderation_reports.type_filter.world'
            })
        );
        await waitFor(() => {
            expect(mocks.getModerationReports).toHaveBeenLastCalledWith({
                currentUserId: 'usr_me',
                offset: 0,
                closedOnly: false,
                reportType: 'world'
            });
        });

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.moderation_reports.status_closed'
            })
        );

        await screen.findByText('Closed Group');
        expect(mocks.getModerationReports).toHaveBeenLastCalledWith({
            currentUserId: 'usr_me',
            offset: 0,
            closedOnly: true,
            reportType: 'world'
        });
    });

    it('loads the next page from the current list length', async () => {
        mocks.getModerationReports
            .mockResolvedValueOnce({
                results: [report('mr_1', 'Milfy'), report('mr_2', 'Mafuyu')],
                hasNext: true
            })
            .mockResolvedValueOnce({
                results: [report('mr_3', 'Rin')],
                hasNext: false
            });
        await openDialog();

        fireEvent.click(
            screen.getByRole('button', { name: 'common.load_more' })
        );

        await screen.findByText('Rin');
        expect(mocks.getModerationReports).toHaveBeenLastCalledWith({
            currentUserId: 'usr_me',
            offset: 2,
            closedOnly: false,
            reportType: null
        });
        expect(
            screen.queryByRole('button', { name: 'common.load_more' })
        ).toBeNull();
    });
});
