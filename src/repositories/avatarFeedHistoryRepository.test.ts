import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    appAvatarFeedHistoryCleanup: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({ commands: commandMocks }));

import { cleanupAvatarFeedHistory } from './avatarFeedHistoryRepository';

describe('avatarFeedHistoryRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('delegates cleanup to the application-owned command', async () => {
        const outcome = {
            deletedRows: 4,
            status: 'completed' as const,
            optimizationError: null
        };
        commandMocks.appAvatarFeedHistoryCleanup.mockResolvedValue(outcome);

        await expect(cleanupAvatarFeedHistory(null)).resolves.toBe(outcome);
        expect(commandMocks.appAvatarFeedHistoryCleanup).toHaveBeenCalledWith(
            null
        );
    });
});
