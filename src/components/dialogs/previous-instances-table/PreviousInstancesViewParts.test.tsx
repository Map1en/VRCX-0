// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryOptions = {
    enabled?: boolean;
    queryFn: () => Promise<unknown>;
};

const mocks = vi.hoisted(() => ({
    copyTextToClipboard: vi.fn().mockResolvedValue(true),
    fetchGroupProfile: vi.fn(() => Promise.resolve({})),
    getUserProfile: vi.fn(() => Promise.resolve({})),
    knownUser: null as Record<string, unknown> | null,
    openGroupDialog: vi.fn(),
    openUserDialog: vi.fn(),
    queryData: null as Record<string, unknown> | null
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@tanstack/react-query')>();
    const { useEffect } = await import('react');
    return {
        ...actual,
        useQuery: (options: QueryOptions) => {
            const { enabled, queryFn } = options;
            useEffect(() => {
                if (enabled) {
                    void queryFn();
                }
            }, [enabled, queryFn]);
            return { data: mocks.queryData };
        }
    };
});

vi.mock('@/components/layout/PageScaffold', () => ({}));
vi.mock('@/services/gameLogUserDialogService', () => ({
    openGameLogUser: vi.fn()
}));
vi.mock('@/lib/useKnownUser', () => ({
    useKnownUserFact: () => mocks.knownUser,
    useKnownUserFacts: () => ({})
}));
vi.mock('@/repositories/gameLogRepository', () => ({ default: {} }));
vi.mock('@/repositories/userProfileRepository', () => ({
    default: { getUserProfile: mocks.getUserProfile }
}));
vi.mock('@/repositories/groupProfileRepository', () => ({
    default: { fetchGroupProfile: mocks.fetchGroupProfile }
}));
vi.mock('@/services/dialogService', () => ({
    openGroupDialog: mocks.openGroupDialog,
    openUserDialog: mocks.openUserDialog,
    openWorldDialog: vi.fn()
}));
vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: mocks.copyTextToClipboard
}));
vi.mock('@/ui/shadcn/button', () => ({
    Button: ({
        children,
        size: _size,
        variant: _variant,
        ...props
    }: ComponentProps<'button'> & {
        children: ReactNode;
        size?: string;
        variant?: string;
    }) => (
        <button type="button" {...props}>
            {children}
        </button>
    )
}));
vi.mock('./PreviousInstanceInfoChart', () => ({
    PreviousInstanceInfoChart: () => null
}));
vi.mock('@/components/LocationWorld', () => ({
    LocationWorld: ({ instanceOwnerName }: { instanceOwnerName?: string }) => (
        <span>creator:{instanceOwnerName}</span>
    )
}));

import {
    CopyInstanceWorldNameButton,
    InstanceCreatorCell,
    InstanceOwnerCell,
    instanceDetailsSummary,
    PreviousInstanceWorldLocation
} from './PreviousInstancesViewParts';

describe('instanceDetailsSummary', () => {
    it('includes the complete instance identity', () => {
        const translations: Record<string, string> = {
            'dialog.new_instance.access_type_group': 'Group',
            'dialog.new_instance.group_access_type_plus': 'Plus'
        };
        const t = ((key: string) => translations[key] || key) as Parameters<
            typeof instanceDetailsSummary
        >[1];

        expect(
            instanceDetailsSummary(
                {
                    location:
                        'wrld_test:12345~region(jp)~group(grp_test)~groupAccessType(plus)',
                    worldName: 'Test World',
                    groupName: 'Group Alpha'
                },
                t
            )
        ).toBe('Test World · Group Plus · #12345 · JP · (Group Alpha)');
    });

    it('includes the default US region when the location omits it', () => {
        const translations: Record<string, string> = {
            'dialog.new_instance.access_type_public': 'Public'
        };
        const t = ((key: string) => translations[key] || key) as Parameters<
            typeof instanceDetailsSummary
        >[1];

        expect(
            instanceDetailsSummary(
                {
                    location: 'wrld_test:12345',
                    worldName: 'Test World'
                },
                t
            )
        ).toBe('Test World · Public · #12345 · US');
    });
});

describe('CopyInstanceWorldNameButton', () => {
    afterEach(cleanup);

    it('copies the provided world name', () => {
        render(<CopyInstanceWorldNameButton worldName="Test World" />);

        fireEvent.click(
            screen.getByRole('button', {
                name: 'dialog.previous_instances.action.copy_world_name: Test World'
            })
        );

        expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(
            'Test World',
            expect.objectContaining({
                successMessage: 'dialog.world.dynamic.value_copied'
            })
        );
    });
});

describe('InstanceOwnerCell', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.knownUser = null;
        mocks.queryData = null;
    });

    it('resolves an id-only creator through the user profile API', async () => {
        mocks.queryData = {
            id: 'usr_owner',
            displayName: 'Resolved owner'
        };

        render(
            <InstanceOwnerCell
                userId="usr_owner"
                endpoint="https://api.vrchat.cloud"
            />
        );

        await waitFor(() => {
            expect(mocks.getUserProfile).toHaveBeenCalledWith({
                userId: 'usr_owner'
            });
        });
        expect(screen.getByText('Resolved owner')).toBeTruthy();
        expect(screen.queryByText('usr_owner')).toBeNull();

        fireEvent.click(screen.getByRole('button'));
        expect(mocks.openUserDialog).toHaveBeenCalledWith({
            userId: 'usr_owner',
            title: 'Resolved owner',
            seedData: mocks.queryData
        });
    });

    it('does not refetch a creator with a known display name', () => {
        mocks.knownUser = {
            id: 'usr_owner',
            displayName: 'Known owner'
        };

        render(<InstanceOwnerCell userId="usr_owner" />);

        expect(screen.getByText('Known owner')).toBeTruthy();
        expect(mocks.getUserProfile).not.toHaveBeenCalled();
    });
});

describe('PreviousInstanceWorldLocation', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.knownUser = null;
        mocks.queryData = null;
    });

    it('shows the resolved creator name instead of the user id', async () => {
        mocks.queryData = { id: 'usr_owner', displayName: 'Resolved owner' };

        render(
            <PreviousInstanceWorldLocation
                row={{ location: 'wrld_test:12345~friends(usr_owner)' }}
            />
        );

        await waitFor(() => {
            expect(mocks.getUserProfile).toHaveBeenCalledWith({
                userId: 'usr_owner'
            });
        });
        expect(screen.getByText('creator:Resolved owner')).toBeTruthy();
    });
});

describe('InstanceCreatorCell', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.knownUser = null;
        mocks.queryData = null;
    });

    it('shows the owning group of a group instance and opens it', async () => {
        mocks.queryData = { id: 'grp_owner', name: 'Resolved group' };

        render(
            <InstanceCreatorCell
                row={{
                    location:
                        'wrld_test:12345~group(grp_owner)~groupAccessType(public)~region(jp)',
                    groupName: ''
                }}
            />
        );

        await waitFor(() => {
            expect(mocks.fetchGroupProfile).toHaveBeenCalledWith({
                groupId: 'grp_owner',
                includeRoles: false
            });
        });
        expect(screen.getByText('Resolved group')).toBeTruthy();

        fireEvent.click(screen.getByRole('button'));
        expect(mocks.openGroupDialog).toHaveBeenCalledWith({
            groupId: 'grp_owner',
            title: 'Resolved group'
        });
    });

    it('uses the recorded group name without fetching the group', () => {
        render(
            <InstanceCreatorCell
                row={{
                    location:
                        'wrld_test:12345~group(grp_owner)~groupAccessType(plus)',
                    groupName: 'Recorded group'
                }}
            />
        );

        expect(screen.getByText('Recorded group')).toBeTruthy();
        expect(mocks.fetchGroupProfile).not.toHaveBeenCalled();
    });
});
