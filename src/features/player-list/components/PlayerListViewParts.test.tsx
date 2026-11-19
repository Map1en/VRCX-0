// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
    useAppTable,
    type AppColumnDef
} from '@/components/data-table/appTable';

import type { PlayerListRow } from '../playerListTypes';
import { PlayerListRows } from './PlayerListViewParts';

const renderedUserIds: string[] = [];

function player(userId: string, timerMs = 0): PlayerListRow {
    return {
        userId,
        displayName: userId,
        userRef: null,
        trustLevel: '',
        trustSortNum: 0,
        trustClass: '',
        platformLabel: '',
        platformIcon: null,
        platformClassName: '',
        inVRMode: null,
        status: '',
        statusDescription: '',
        languages: [],
        bioLinks: [],
        note: '',
        avatarUrl: '',
        isCurrentUser: false,
        isFriend: false,
        isFavorite: false,
        isBlocked: false,
        isMuted: false,
        isAvatarInteractionDisabled: false,
        isChatBoxMuted: false,
        timeoutTime: 0,
        moderationSeverity: '',
        ageVerified: false,
        timerMs,
        worldName: '',
        location: ''
    };
}

const columns: AppColumnDef<PlayerListRow>[] = [
    {
        id: 'displayName',
        cell: ({ row }) => {
            renderedUserIds.push(row.original.userId);
            return row.original.displayName;
        }
    },
    {
        id: 'note',
        cell: ({ row }) => row.original.note
    }
];
const onOpenPlayer = () => {};
const ALL_COLUMNS_VISIBLE: Record<string, boolean> = {};

function Harness({
    rows,
    columnVisibility = ALL_COLUMNS_VISIBLE
}: {
    rows: PlayerListRow[];
    columnVisibility?: Record<string, boolean>;
}) {
    const table = useAppTable({
        data: rows,
        columns,
        state: { columnVisibility },
        getRowId: (row) => row.userId
    });
    return (
        <table>
            <tbody>
                <PlayerListRows
                    table={table}
                    hasRows
                    onOpenPlayer={onOpenPlayer}
                />
            </tbody>
        </table>
    );
}

describe('PlayerListRows', () => {
    afterEach(() => {
        cleanup();
        renderedUserIds.length = 0;
    });

    it('re-renders only players whose rebuilt row data changed', () => {
        const view = render(
            <Harness rows={[player('usr_a'), player('usr_b')]} />
        );
        renderedUserIds.length = 0;

        view.rerender(<Harness rows={[player('usr_a'), player('usr_b')]} />);
        expect(renderedUserIds).toEqual([]);

        view.rerender(
            <Harness rows={[player('usr_a'), player('usr_b', 1000)]} />
        );
        expect(renderedUserIds).toEqual(['usr_b']);
    });

    it('re-renders every player when the visible columns change', () => {
        const view = render(
            <Harness rows={[player('usr_a'), player('usr_b')]} />
        );
        renderedUserIds.length = 0;

        view.rerender(
            <Harness
                rows={[player('usr_a'), player('usr_b')]}
                columnVisibility={{ note: false }}
            />
        );

        expect(renderedUserIds).toEqual(['usr_a', 'usr_b']);
    });
});
