import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createLocalStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: vi.fn((key: string) => data.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            data.set(key, String(value));
        }),
        removeItem: vi.fn((key: string) => {
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

async function loadRecentActionService(
    initialStorage: Record<string, string> = {}
) {
    vi.resetModules();
    const localStorage = createLocalStorage(initialStorage);
    vi.stubGlobal('localStorage', localStorage);
    const { useRuntimeStore } = await import('@/state/runtimeStore');
    const setCurrentUser = (currentUserId: string | null) => {
        useRuntimeStore.setState((state) => ({
            auth: { ...state.auth, currentUserId }
        }));
    };
    setCurrentUser('usr_self');
    const service = await import('./recentActionService');
    return { service, localStorage, setCurrentUser };
}

describe('recentActionService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('records an action for a trimmed user id and prunes it once the cooldown expires', async () => {
        const { service, localStorage } = await loadRecentActionService();

        service.configureRecentActionCooldown({ enabled: true, minutes: 30 });
        service.recordRecentAction(' usr_abc ', 'Invite');

        expect(service.isActionRecent('usr_abc', 'Invite')).toBe(true);

        vi.setSystemTime(new Date('2026-01-01T00:29:59Z'));
        expect(service.isActionRecent('usr_abc', 'Invite')).toBe(true);

        vi.setSystemTime(new Date('2026-01-01T00:30:00Z'));
        expect(service.isActionRecent('usr_abc', 'Invite')).toBe(false);

        const stored = JSON.parse(
            String(localStorage.dump().VRCX_recentActions)
        );
        expect(stored).toEqual({});
    });

    it('keeps cooldowns separate for each logged-in account', async () => {
        const { service, setCurrentUser } = await loadRecentActionService();

        service.configureRecentActionCooldown({ enabled: true, minutes: 30 });
        service.recordRecentAction('usr_abc', 'Send Friend Request');

        setCurrentUser('usr_alt');
        expect(service.isActionRecent('usr_abc', 'Send Friend Request')).toBe(
            false
        );

        setCurrentUser('usr_self');
        expect(service.isActionRecent('usr_abc', 'Send Friend Request')).toBe(
            true
        );
    });

    it('does not record actions without a logged-in account', async () => {
        const { service, localStorage, setCurrentUser } =
            await loadRecentActionService();

        service.configureRecentActionCooldown({ enabled: true, minutes: 30 });
        setCurrentUser(null);
        service.recordRecentAction('usr_abc', 'Invite');

        expect(localStorage.dump().VRCX_recentActions).toBeUndefined();
    });

    it('ignores recent actions when cooldown is disabled', async () => {
        const { service } = await loadRecentActionService();

        service.configureRecentActionCooldown({ enabled: false, minutes: 5 });
        service.recordRecentAction('usr_abc', 'Send Friend Request');

        expect(service.isActionRecent('usr_abc', 'Send Friend Request')).toBe(
            false
        );
    });

    it('normalizes cooldown minutes to the supported range', async () => {
        const { service } = await loadRecentActionService();

        expect(
            service.configureRecentActionCooldown({
                enabled: true,
                minutes: Number.NaN
            })
        ).toEqual({
            enabled: true,
            minutes: 60
        });
        expect(
            service.configureRecentActionCooldown({ enabled: true, minutes: 0 })
        ).toEqual({
            enabled: true,
            minutes: 1
        });
        expect(
            service.configureRecentActionCooldown({
                enabled: true,
                minutes: 9999
            })
        ).toEqual({
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
        service.recordRecentAction('usr_def', 'Invite');

        expect(listener).toHaveBeenCalledTimes(3);

        unsubscribe();
        service.recordRecentAction('usr_ghi', 'Invite');

        expect(listener).toHaveBeenCalledTimes(3);
    });
});
