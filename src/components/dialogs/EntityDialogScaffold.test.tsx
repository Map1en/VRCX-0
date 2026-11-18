// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    copyTextToClipboard: vi.fn().mockResolvedValue(true)
}));

vi.mock('@/services/clipboardService', () => ({
    copyTextToClipboard: mocks.copyTextToClipboard
}));

import {
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityRawJson
} from './EntityDialogScaffold';

describe('EntityRawJson', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('omits top-level app fields while preserving nested external JSON', async () => {
        render(
            <EntityRawJson
                value={{
                    id: 'usr_1',
                    $trustLevel: 'User',
                    metadata: {
                        $remoteField: 'preserved',
                        visible: true
                    }
                }}
            />
        );

        expect(screen.queryByText(/trustLevel/)).toBeNull();

        fireEvent.click(screen.getByText('"metadata":'));
        expect(screen.getByText('"$remoteField":')).toBeTruthy();

        fireEvent.click(
            screen.getByRole('button', { name: 'common.actions.copy' })
        );

        await waitFor(() => {
            expect(mocks.copyTextToClipboard).toHaveBeenCalledWith(
                JSON.stringify(
                    {
                        id: 'usr_1',
                        metadata: {
                            $remoteField: 'preserved',
                            visible: true
                        }
                    },
                    null,
                    2
                )
            );
        });
    });
});

describe('EntityDialogTabContent', () => {
    afterEach(() => {
        cleanup();
    });

    function renderTabs(activeTab: string, keptTabs: ReadonlySet<string>) {
        return (
            <EntityDialogTabs
                value={activeTab}
                onValueChange={vi.fn()}
                tabs={[
                    { value: 'info', label: 'Info' },
                    { value: 'groups', label: 'Groups' }
                ]}
                keptTabs={keptTabs}
            >
                <EntityDialogTabContent value="info">
                    <span>info panel</span>
                </EntityDialogTabContent>
                <EntityDialogTabContent value="groups">
                    <span>groups panel</span>
                </EntityDialogTabContent>
            </EntityDialogTabs>
        );
    }

    it('keeps inactive panels mounted only when they are listed as kept', () => {
        const view = render(renderTabs('groups', new Set(['groups'])));
        expect(screen.queryByText('info panel')).toBeNull();

        view.rerender(renderTabs('groups', new Set(['info', 'groups'])));
        expect(screen.getByText('info panel')).not.toBeNull();
        expect(screen.getByText('groups panel')).not.toBeNull();
    });
});
