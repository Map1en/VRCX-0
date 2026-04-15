import { describe, expect, it } from 'vitest';

import { toCommandName, toNamedArgs } from './commands.js';

describe('tauri command mapping', () => {
    it('maps backend namespaces and method names to Rust command names', () => {
        expect(toCommandName('app', 'CurrentCulture')).toBe('app__current_culture');
        expect(toCommandName('sqlite', 'executeNonQuery')).toBe('sqlite__execute_non_query');
        expect(toCommandName('assetBundle', 'CheckVRChatCache')).toBe('asset_bundle__check_vrchat_cache');
        expect(toCommandName('logWatcher', 'SetDateTill')).toBe('log_watcher__set_date_till');
    });

    it('uses explicit named args for known command contracts', () => {
        expect(toNamedArgs('storage__set', ['key', 'value'])).toEqual({
            key: 'key',
            value: 'value'
        });
        expect(toNamedArgs('app__set_app_launcher_settings', [true, false, true])).toEqual({
            enabled: true,
            killOnExit: false,
            runProcessOnce: true
        });
        expect(toNamedArgs('asset_bundle__check_vrchat_cache', ['file_abc', 1, 'security', 2])).toEqual({
            fileId: 'file_abc',
            fileVersion: 1,
            variant: 'security',
            variantVersion: 2
        });
    });

    it('falls back to object payloads or positional arg names for unknown commands', () => {
        expect(toNamedArgs('unknown__command', [{ ok: true }])).toEqual({ ok: true });
        expect(toNamedArgs('unknown__command', ['a', 'b'])).toEqual({
            arg0: 'a',
            arg1: 'b'
        });
        expect(toNamedArgs('unknown__command', [])).toEqual({});
    });
});
