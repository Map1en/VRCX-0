// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/ui/shadcn/tooltip';

import { AdvancedTroubleshootingGroup } from './AdvancedTroubleshootingGroup';

const labels: Record<string, string> = {
    'view.settings.advanced.advanced_ui.troubleshooting.header':
        'Troubleshooting',
    'view.settings.advanced.advanced_ui.troubleshooting.description':
        'Diagnostic tools',
    'view.settings.advanced.advanced_ui.troubleshooting.show': 'Show tools',
    'view.settings.advanced.advanced_ui.troubleshooting.hide': 'Hide tools',
    'view.settings.advanced.advanced_ui.troubleshooting.gamelog':
        'GameLog processing',
    'view.settings.advanced.advanced_ui.troubleshooting.gamelog_description':
        'Required by log features',
    'view.settings.advanced.advanced_ui.troubleshooting.tools': 'Diagnostics',
    'view.settings.advanced.advanced_ui.troubleshooting.database_usage':
        'Database usage',
    'view.settings.advanced.advanced_ui.troubleshooting.refresh_database_usage':
        'Refresh database usage',
    'view.settings.advanced.advanced_ui.troubleshooting.online_users':
        'Online users',
    'view.settings.advanced.advanced_ui.troubleshooting.refresh_online_users':
        'Refresh online users',
    'view.settings.advanced.advanced_ui.troubleshooting.vrchat_config':
        'VRChat config',
    'view.settings.advanced.advanced_ui.troubleshooting.view_config': 'View…',
    'view.settings.advanced.advanced_ui.troubleshooting.hide_config': 'Hide',
    'view.settings.general.logging.header': 'Logging',
    'view.settings.general.logging.resource_load': 'Resource load logging',
    'view.settings.advanced.advanced.cache_debug.udon_exception_logging':
        'Udon exception logging'
};

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({
        t: (key: string, options?: { count?: number }) =>
            key === 'view.profile.game_info.user_online'
                ? `${options?.count ?? 0} online`
                : (labels[key] ?? key)
    })
}));

type TroubleshootingProps = ComponentProps<typeof AdvancedTroubleshootingGroup>;

function createProps(
    overrides: Partial<TroubleshootingProps> = {}
): TroubleshootingProps {
    return {
        configTreeData: {},
        onClearConfigTreeData: vi.fn(),
        onGameLogDisabledChange: vi.fn(),
        onLogResourceLoadChange: vi.fn(),
        onRefreshConfigTreeData: vi.fn(),
        onRefreshOnlineVisits: vi.fn(),
        onRefreshSqliteTableSizes: vi.fn(),
        onUdonExceptionLoggingChange: vi.fn(),
        onlineVisitCount: null,
        prefs: {
            gameLogDisabled: false,
            logResourceLoad: false,
            udonExceptionLogging: false
        },
        sqliteTableSizeRows: [['gps', 'GPS']],
        sqliteTableSizes: {},
        ...overrides
    };
}

function renderGroup(props: TroubleshootingProps) {
    return render(
        <TooltipProvider>
            <AdvancedTroubleshootingGroup {...props} />
        </TooltipProvider>
    );
}

async function openTools(user: ReturnType<typeof userEvent.setup>) {
    const trigger = screen.getByRole('button', { name: 'Show tools' });
    trigger.focus();
    await user.keyboard('{Enter}');
    return trigger;
}

describe('AdvancedTroubleshootingGroup', () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            }
        );
        Element.prototype.scrollIntoView = vi.fn();
    });

    it('starts collapsed and supports keyboard toggling', async () => {
        const user = userEvent.setup();
        renderGroup(createProps());

        expect(screen.queryByText('GameLog processing')).toBeNull();
        const trigger = await openTools(user);

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('GameLog processing')).toBeTruthy();

        await user.keyboard('{Enter}');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('maps the positive GameLog switch back to gameLogDisabled', async () => {
        const user = userEvent.setup();
        const onGameLogDisabledChange = vi.fn();
        renderGroup(createProps({ onGameLogDisabledChange }));
        await openTools(user);

        const gameLogSwitch = screen.getByRole('switch', {
            name: 'GameLog processing'
        });
        expect(gameLogSwitch.getAttribute('aria-checked')).toBe('true');

        await user.click(gameLogSwitch);

        expect(onGameLogDisabledChange).toHaveBeenCalledOnce();
        expect(onGameLogDisabledChange).toHaveBeenCalledWith(true);
        expect(gameLogSwitch.getAttribute('aria-checked')).toBe('true');
    });

    it.each([
        ['Refresh database usage', 'onRefreshSqliteTableSizes'],
        ['Refresh online users', 'onRefreshOnlineVisits']
    ] as const)('locks %s while its action is pending', async (label, key) => {
        const user = userEvent.setup();
        let resolveAction: (() => void) | undefined;
        const action = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveAction = resolve;
                })
        );
        renderGroup(createProps({ [key]: action }));
        await openTools(user);

        const button = screen.getByRole('button', { name: label });
        await user.click(button);

        expect(action).toHaveBeenCalledOnce();
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();

        fireEvent.click(button);
        expect(action).toHaveBeenCalledOnce();

        resolveAction?.();
        await waitFor(() =>
            expect((button as HTMLButtonElement).disabled).toBe(false)
        );
    });

    it('loads VRChat config once and switches between View and Hide', async () => {
        const user = userEvent.setup();
        let resolveAction: (() => void) | undefined;
        const onRefreshConfigTreeData = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveAction = resolve;
                })
        );
        const onClearConfigTreeData = vi.fn();
        const props = createProps({
            onClearConfigTreeData,
            onRefreshConfigTreeData
        });
        const view = renderGroup(props);
        await openTools(user);

        const viewButton = screen.getByRole('button', { name: 'View…' });
        await user.click(viewButton);
        fireEvent.click(viewButton);

        expect(onRefreshConfigTreeData).toHaveBeenCalledOnce();
        expect((viewButton as HTMLButtonElement).disabled).toBe(true);

        resolveAction?.();
        await waitFor(() =>
            expect((viewButton as HTMLButtonElement).disabled).toBe(false)
        );
        view.rerender(
            <TooltipProvider>
                <AdvancedTroubleshootingGroup
                    {...props}
                    configTreeData={{ feature: true }}
                />
            </TooltipProvider>
        );

        await user.click(screen.getByRole('button', { name: 'Hide' }));
        expect(onClearConfigTreeData).toHaveBeenCalledOnce();
    });
});
