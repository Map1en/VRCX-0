// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorldProfileRecord } from '@/domain/entities/world';

import { WorldInfoSections } from './WorldDialogInfoSections';

afterEach(cleanup);

function renderSections(fields: Partial<WorldProfileRecord>) {
    return render(
        <WorldInfoSections
            world={{ id: 'wrld_a', ...fields } as WorldProfileRecord}
            authorTags={[]}
            favoriteRate={0}
            friendVisits={null}
            hasPersistData={false}
            lastVisitedInstance={undefined}
            memo=""
            previousInstanceCount={0}
            previewUrl=""
            restrictions={[]}
            attributes={[]}
            totalVisitTime={0}
            onOpenVisitHistory={vi.fn()}
            onSaveMemo={vi.fn()}
        />
    );
}

describe('WorldInfoSections', () => {
    it('keeps video domains collapsed until requested', () => {
        renderSections({ urlList: ['a.example', 'b.example'] });

        expect(screen.queryByText('a.example')).toBeNull();
        fireEvent.click(
            screen.getByRole('button', {
                name: /dialog\.allowed_video_player_domains\.header/
            })
        );
        expect(screen.getByText('a.example')).toBeTruthy();
    });

    it('omits the technical section when there is nothing to show', () => {
        renderSections({});

        expect(
            screen.queryByText('dialog.world.info.sections.technical')
        ).toBeNull();
    });
});
