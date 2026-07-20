import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appVrchatSearchUsersGet: vi.fn(),
    appVrchatToolsUserNoteSave: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: commandMocks }));

import { getUsers } from './vrchatSearchRepository';
import { saveUserNote } from './vrchatToolsRepository';

describe('VRChat repository structured error contract', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('preserves a search error instead of replacing it with a plain Error', async () => {
        commandMocks.appVrchatSearchUsersGet.mockResolvedValueOnce({
            status: 429,
            data: 'Rate limited'
        });

        await expect(getUsers()).rejects.toMatchObject({
            message: 'Rate limited',
            status: 429,
            endpoint: 'users',
            payload: 'Rate limited'
        });
    });

    it('preserves a tools error instead of replacing it with a plain Error', async () => {
        const payload = { error: { message: 'Note save failed' } };
        commandMocks.appVrchatToolsUserNoteSave.mockResolvedValueOnce({
            status: 500,
            data: JSON.stringify(payload)
        });

        await expect(
            saveUserNote({ targetUserId: 'usr_1', note: 'hello' })
        ).rejects.toMatchObject({
            message: 'Note save failed',
            status: 500,
            endpoint: 'userNotes',
            payload
        });
    });
});
