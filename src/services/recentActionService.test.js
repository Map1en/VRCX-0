import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createLocalStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: vi.fn((key) => data.get(key) ?? null),
        setItem: vi.fn((key, value) => {
            data.set(key, String(value));
        }),
        removeItem: vi.fn((key) => {
            data.delete(key);
        }),
        clear: vi.fn(() => {
            data.clear();
        }),
        dump() {
            return Object.fromEntries(data);
        }
    };
}

async function loadRecentActionService(initialStorage = {}) {
    vi.resetModules();
    const localStorage = createLocalStorage(initialStorage);
    globalThis.window = { localStorage };
    const service = await import('./recentActionService.js');
    return { service, localStorage };
}

describe('recentActionService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        delete globalThis.window;
    });

    it('records only tracked actions and respects the configured cooldown', async () => {
        const { service, localStorage } = await loadRecentActionService();

        service.configureRecentActionCooldown({ enabled: true, minutes: 30 });
        service.recordRecentAction(' usr_abc ', 'Invite');
        service.recordRecentAction('usr_abc', 'Untracked Action');

        expect(service.isActionRecent('usr_abc', 'Invite')).toBe(true);
        expect(service.isActionRecent('usr_abc', 'Untracked Action')).toBe(false);

        vi.setSystemTime(new Date('2026-01-01T00:29:59Z'));
        expect(service.isActionRecent('usr_abc', 'Invite')).toBe(true);

        vi.setSystemTime(new Date('2026-01-01T00:30:00Z'));
        expect(service.isActionRecent('usr_abc', 'Invite')).toBe(false);

        const stored = JSON.parse(localStorage.dump().VRCX_recentActions);
        expect(stored).toEqual({});
    });

    it('ignores recent actions when cooldown is disabled', async () => {
        const { service } = await loadRecentActionService();

        service.configureRecentActionCooldown({ enabled: false, minutes: 5 });
        service.recordRecentAction('usr_abc', 'Send Friend Request');

        expect(service.isActionRecent('usr_abc', 'Send Friend Request')).toBe(false);
    });

    it('normalizes invalid cooldown minutes to the default', async () => {
        const { service } = await loadRecentActionService();

        expect(service.configureRecentActionCooldown({ enabled: true, minutes: 'bad' })).toEqual({
            enabled: true,
            minutes: 60
        });
        expect(service.configureRecentActionCooldown({ enabled: true, minutes: 0 })).toEqual({
            enabled: true,
            minutes: 1
        });
        expect(service.configureRecentActionCooldown({ enabled: true, minutes: 9999 })).toEqual({
            enabled: true,
            minutes: 1440
        });
    });

    it('falls back to an empty cache when persisted recent actions are invalid', async () => {
        const { service } = await loadRecentActionService({
            VRCX_recentActions: '{bad json'
        });

        service.configureRecentActionCooldown({ enabled: true, minutes: 60 });

        expect(service.isActionRecent('usr_abc', 'Invite')).toBe(false);
    });

    it('notifies subscribers after configuration and storage changes', async () => {
        const { service } = await loadRecentActionService();
        const listener = vi.fn();
        const unsubscribe = service.subscribeRecentActions(listener);

        service.configureRecentActionCooldown({ enabled: true, minutes: 60 });
        service.recordRecentAction('usr_abc', 'Invite');
        service.clearRecentActions();

        expect(listener).toHaveBeenCalledTimes(3);

        unsubscribe();
        service.clearRecentActions();

        expect(listener).toHaveBeenCalledTimes(3);
    });
});
