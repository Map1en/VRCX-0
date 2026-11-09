import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadLocaleMessages: vi.fn()
}));

vi.mock('@/localization/index', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/localization/index')>()),
    loadLocaleMessages: mocks.loadLocaleMessages
}));

import i18n, { getTimeUnitLabels, setI18nLanguage } from './i18nService';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('i18nService', () => {
    beforeEach(async () => {
        mocks.loadLocaleMessages.mockReset();
        await setI18nLanguage('en');
    });

    it('keeps the newest language when an older locale finishes loading later', async () => {
        const jaLoad = deferred<Record<string, unknown>>();
        mocks.loadLocaleMessages.mockImplementation((code: string) =>
            code === 'ja'
                ? jaLoad.promise
                : Promise.resolve({ common: { time_units: { h: '시간' } } })
        );

        const staleSwitch = setI18nLanguage('ja');
        await setI18nLanguage('ko');
        jaLoad.resolve({ common: { time_units: { h: '時間' } } });
        await staleSwitch;

        expect(i18n.language).toBe('ko');
        expect(getTimeUnitLabels().h).toBe('시간');
    });

    it('renders intentionally empty translations as empty text instead of the key', () => {
        expect(i18n.t('view.player_list.mutual_friends.circles_suffix')).toBe(
            ''
        );
    });
});
