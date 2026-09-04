// @vitest-environment jsdom

import {
    cleanup,
    render,
    screen,
    waitFor,
    within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import en from '@/localization/en.json';
import { FEED_FILTER_TYPES } from '@/repositories/feedRepository';
import { useFriendRosterStore } from '@/state/friendRosterStore';

import type { FeedViewMode } from '../feedColumnsState';
import { useFeedFilters } from '../useFeedFilters';
import { FeedToolbar } from './FeedToolbar';
import { FeedViewModeToggle } from './FeedViewModeToggle';

const i18n = createInstance();

beforeAll(async () => {
    await i18n.init({
        lng: 'en',
        resources: { en: { translation: en } },
        interpolation: { prefix: '{', suffix: '}', escapeValue: false }
    });
});

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 7, 30, 12));
    useFriendRosterStore.getState().resetRoster();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function FilterHarness({ userIds = [] }: { userIds?: string[] }) {
    const filters = useFeedFilters({ routeScopedUserIds: userIds });

    return (
        <>
            <FeedToolbar
                filterModel={filters}
                filterCommands={{
                    onApplyDateFilter: filters.applyDateFilter,
                    onClearDateFilter: filters.clearDateFilter,
                    onClearFeedFilters: () => filters.setFeedFilters([]),
                    onClearSearch: filters.clearSearch,
                    onCommitSearch: filters.commitSearch,
                    onDateFilterOpenChange: filters.setDateFilterOpen,
                    onDateRangeSelect: filters.onDateRangeSelect,
                    onScopeChange: filters.setUserScope,
                    onSearchDraftChange: filters.setSearchDraft,
                    onFeedFiltersChange: filters.setFeedFilters,
                    onToggleFavoritesOnly: () =>
                        filters.setFavoritesOnly((value) => !value),
                    onToggleFeedFilter: filters.toggleFeedFilter
                }}
                isSearching={false}
                onViewModeChange={() => undefined}
            />
            <output aria-label="Applied search">
                {filters.deferredSearchQuery}
            </output>
            <output aria-label="Applied dates">
                {filters.dateFrom}/{filters.dateTo}
            </output>
            <output aria-label="Applied friends">
                {filters.scopedUserIds.join(',')}
            </output>
        </>
    );
}

function renderFilters(userIds: string[] = []) {
    return render(
        <I18nextProvider i18n={i18n}>
            <FilterHarness userIds={userIds} />
        </I18nextProvider>
    );
}

describe('Feed toolbar filters', () => {
    it('labels the icon-only grouped-friends toggle on hover and keyboard focus', async () => {
        const user = userEvent.setup();
        renderFilters();
        const toggle = screen.getByRole('button', {
            name: 'Grouped friends only'
        });

        expect(toggle.textContent).toBe('');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        await user.hover(toggle);
        expect(
            (await screen.findByText('Grouped friends only')).hasAttribute(
                'data-open'
            )
        ).toBe(true);
        await user.unhover(toggle);
        await user.click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('true');

        await user.tab();
        expect(document.activeElement).toBe(
            screen.getByRole('button', { name: 'Type: All' })
        );
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(toggle);
        expect(
            (await screen.findByText('Grouped friends only')).hasAttribute(
                'data-open'
            )
        ).toBe(true);
        await user.keyboard(' ');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
    });

    it('shares multi-selection between the expanded buttons and the summary menu', async () => {
        const user = userEvent.setup();
        renderFilters();
        const avatar = screen.getByRole('button', { name: 'Avatar' });
        const location = screen.getByRole('button', { name: 'Location' });
        const all = screen.getByRole('button', { name: 'All' });

        expect(
            screen.getByRole('button', { name: 'Type: All' }).textContent
        ).toBe('All');
        expect(all.getAttribute('aria-pressed')).toBe('true');
        await user.click(avatar);
        await user.click(location);
        expect(avatar.getAttribute('aria-pressed')).toBe('true');
        expect(location.getAttribute('aria-pressed')).toBe('true');
        expect(
            screen.getByRole('button', { name: 'Type: Location +1' })
                .textContent
        ).toBe('Location +1');
        await user.click(
            screen.getByRole('button', { name: 'Type: Location +1' })
        );
        await user.click(
            await screen.findByRole('menuitemcheckbox', { name: 'Location' })
        );
        await user.keyboard('{Escape}');

        expect(location.getAttribute('aria-pressed')).toBe('false');
        expect(avatar.getAttribute('aria-pressed')).toBe('true');
        await user.click(all);
        expect(avatar.getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Type: All' })).toBeTruthy();
        await user.keyboard('{ArrowRight} ');
        expect(location.getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps multi-select open and summarizes selections in the established type order', async () => {
        const user = userEvent.setup();
        renderFilters();

        await user.click(screen.getByRole('button', { name: 'Type: All' }));
        await user.click(
            await screen.findByRole('menuitemcheckbox', { name: 'Avatar' })
        );
        expect(
            screen.getByRole('button', { name: 'Type: Avatar' })
        ).toBeTruthy();

        await user.click(
            screen.getByRole('menuitemcheckbox', { name: 'Location' })
        );
        expect(
            screen.getByRole('button', { name: 'Type: Location +1' })
        ).toBeTruthy();
        expect(
            screen
                .getByRole('menuitemcheckbox', { name: 'Avatar' })
                .getAttribute('aria-checked')
        ).toBe('true');
        expect(
            screen
                .getByRole('menuitemcheckbox', { name: 'Location' })
                .getAttribute('aria-checked')
        ).toBe('true');

        await user.click(screen.getByRole('menuitemcheckbox', { name: 'All' }));
        expect(screen.getByRole('button', { name: 'Type: All' })).toBeTruthy();
        expect(
            screen
                .getByRole('menuitemcheckbox', { name: 'Avatar' })
                .getAttribute('aria-checked')
        ).toBe('false');
    });

    it('normalizes selecting every type and removing the last type back to all', async () => {
        const user = userEvent.setup();
        renderFilters();
        await user.click(screen.getByRole('button', { name: 'Type: All' }));

        for (const filter of FEED_FILTER_TYPES) {
            await user.click(
                await screen.findByRole('menuitemcheckbox', {
                    name: en.view.feed.filters[filter]
                })
            );
        }

        expect(screen.getByRole('button', { name: 'Type: All' })).toBeTruthy();
        await user.click(
            screen.getByRole('menuitemcheckbox', { name: 'Online' })
        );
        await user.click(
            screen.getByRole('menuitemcheckbox', { name: 'Online' })
        );
        expect(screen.getByRole('button', { name: 'Type: All' })).toBeTruthy();

        await user.keyboard('{Escape}');
        await waitFor(() => {
            expect(document.activeElement).toBe(
                screen.getByRole('button', { name: 'Type: All' })
            );
        });
    });

    it('keeps grouped friends one-click and clears it when a specific friend scope arrives', async () => {
        const user = userEvent.setup();
        const view = renderFilters();
        const toggle = screen.getByRole('button', {
            name: 'Grouped friends only'
        });
        await user.click(toggle);
        expect(toggle.getAttribute('aria-pressed')).toBe('true');

        view.rerender(
            <I18nextProvider i18n={i18n}>
                <FilterHarness userIds={['usr_scoped']} />
            </I18nextProvider>
        );

        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        expect(toggle.hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('button', { name: 'Date range' })).toBeTruthy();
    });
});

async function selectDateRange(
    user: ReturnType<typeof userEvent.setup>,
    trigger = screen.getByRole('button', { name: /^Date range/ })
) {
    await user.click(trigger);
    const calendar = within(
        await screen.findByRole('dialog', { name: 'Date range' })
    );
    await user.click(calendar.getByRole('button', { name: /August 10.*2026/ }));
    await user.click(calendar.getByRole('button', { name: /August 12.*2026/ }));
    return calendar;
}

describe('Feed compound search', () => {
    it('applies dates without a keyword and tabs from friend search to the date trigger', async () => {
        const user = userEvent.setup();
        renderFilters();
        const search = screen.getByRole('combobox');
        await user.click(search);
        expect(search.getAttribute('aria-expanded')).toBe('true');

        await user.tab();
        await waitFor(() =>
            expect(document.activeElement).toBe(
                screen.getByRole('button', { name: 'Date range' })
            )
        );

        const calendar = await selectDateRange(user);
        expect(search.getAttribute('aria-expanded')).toBe('false');
        expect(
            screen.getByRole('status', { name: 'Applied dates' }).textContent
        ).toBe('/');
        await user.click(
            calendar.getByRole('button', { name: en.common.actions.confirm })
        );

        expect(
            screen.getByRole('status', { name: 'Applied dates' }).textContent
        ).toBe('2026-08-10/2026-08-12');
        expect(
            screen.getByRole('status', { name: 'Applied search' }).textContent
        ).toBe('');
        const date = screen.getByRole('button', {
            name: 'Date range: 2026-08-10 - 2026-08-12'
        });
        await user.click(date);
        await user.keyboard('{Escape}');
        await waitFor(() => expect(document.activeElement).toBe(date));
        expect(search.getAttribute('aria-expanded')).toBe('false');
    });

    it('does not submit a keyword draft when confirming dates and clears only the requested scope', async () => {
        const user = userEvent.setup();
        renderFilters(['usr_scoped']);
        const search = screen.getByRole('combobox');
        const dateTrigger = screen.getByRole('button', { name: 'Date range' });
        await user.type(search, 'world');

        const calendar = await selectDateRange(user, dateTrigger);
        await user.click(
            calendar.getByRole('button', { name: en.common.actions.confirm })
        );
        expect(
            screen.getByRole('status', { name: 'Applied search' }).textContent
        ).toBe('');
        expect(search.getAttribute('value')).toBe('world');
        expect(
            screen.getByRole('status', { name: 'Applied friends' }).textContent
        ).toBe('usr_scoped');
        const dates = within(screen.getByRole('group', { name: 'Date range' }));
        const clearDates = dates.getByRole('button', {
            name: en.common.actions.clear
        });

        await user.click(search);
        await user.keyboard('{Enter}');
        expect(
            screen.getByRole('status', { name: 'Applied search' }).textContent
        ).toBe('world');
        expect(
            screen.getByRole('status', { name: 'Applied dates' }).textContent
        ).toBe('2026-08-10/2026-08-12');
        await user.click(clearDates);
        expect(
            screen.getByRole('status', { name: 'Applied dates' }).textContent
        ).toBe('/');
        expect(
            screen.getByRole('status', { name: 'Applied search' }).textContent
        ).toBe('world');
        expect(
            screen.getByRole('status', { name: 'Applied friends' }).textContent
        ).toBe('usr_scoped');

        const nextCalendar = await selectDateRange(user);
        await user.click(
            nextCalendar.getByRole('button', {
                name: en.common.actions.confirm
            })
        );
        const searchScope = within(
            screen.getByRole('toolbar', {
                name: en.view.feed.search_scope.aria_label
            })
        );
        await user.click(
            searchScope.getByRole('button', { name: en.common.actions.clear })
        );
        expect(
            screen.getByRole('status', { name: 'Applied search' }).textContent
        ).toBe('');
        expect(
            screen.getByRole('status', { name: 'Applied friends' }).textContent
        ).toBe('');
        expect(
            screen.getByRole('status', { name: 'Applied dates' }).textContent
        ).toBe('2026-08-10/2026-08-12');
    });

    it('keeps dates when selecting a friend and when cancelling an edited date draft', async () => {
        const user = userEvent.setup();
        useFriendRosterStore.getState().setRosterSnapshot({
            friendsById: {
                usr_alpha: { id: 'usr_alpha', displayName: 'Alpha' }
            },
            orderedFriendIds: ['usr_alpha']
        });
        renderFilters();
        const calendar = await selectDateRange(user);
        await user.click(
            calendar.getByRole('button', { name: en.common.actions.confirm })
        );

        await user.type(screen.getByRole('combobox'), 'Alpha');
        await user.click(await screen.findByRole('option', { name: /Alpha/ }));
        expect(
            screen.getByRole('status', { name: 'Applied friends' }).textContent
        ).toBe('usr_alpha');
        expect(
            screen.getByRole('status', { name: 'Applied dates' }).textContent
        ).toBe('2026-08-10/2026-08-12');
        expect(
            screen.getByRole('status', { name: 'Applied search' }).textContent
        ).toBe('');

        await user.click(screen.getByRole('button', { name: /^Date range/ }));
        const draft = within(
            await screen.findByRole('dialog', { name: 'Date range' })
        );
        await user.click(
            draft.getByRole('button', { name: /August 20.*2026/ })
        );
        await user.keyboard('{Escape}');
        expect(
            screen.getByRole('status', { name: 'Applied dates' }).textContent
        ).toBe('2026-08-10/2026-08-12');
        await user.click(screen.getByRole('button', { name: /^Date range/ }));
        const restored = within(
            await screen.findByRole('dialog', { name: 'Date range' })
        );
        await user.click(
            restored.getByRole('button', { name: en.common.actions.confirm })
        );
        expect(
            screen.getByRole('status', { name: 'Applied dates' }).textContent
        ).toBe('2026-08-10/2026-08-12');
    });
});

function ViewHarness() {
    const [mode, setMode] = useState<FeedViewMode>('table');
    return <FeedViewModeToggle value={mode} onValueChange={setMode} />;
}

describe('Feed view controls', () => {
    it('switches modes directly without allowing an empty selection', async () => {
        const user = userEvent.setup();
        render(
            <I18nextProvider i18n={i18n}>
                <ViewHarness />
            </I18nextProvider>
        );
        const table = screen.getByRole('button', { name: 'Table' });
        const columns = screen.getByRole('button', { name: 'Columns' });

        expect(table.getAttribute('aria-pressed')).toBe('true');
        expect(columns.getAttribute('aria-pressed')).toBe('false');

        await user.click(columns);
        expect(columns.getAttribute('aria-pressed')).toBe('true');
        expect(table.getAttribute('aria-pressed')).toBe('false');
        expect(screen.queryByRole('menu')).toBeNull();

        await user.click(columns);
        expect(columns.getAttribute('aria-pressed')).toBe('true');

        await user.keyboard('{ArrowLeft}');
        expect(document.activeElement).toBe(table);
        await user.keyboard(' ');
        expect(table.getAttribute('aria-pressed')).toBe('true');
        expect(columns.getAttribute('aria-pressed')).toBe('false');
    });
});
