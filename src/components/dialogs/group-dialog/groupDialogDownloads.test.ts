import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    saveJsonFile: vi.fn()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    saveJsonFile: mocks.saveJsonFile
}));

import { downloadJsonFile } from './groupDialogDownloads';

describe('downloadJsonFile', () => {
    beforeEach(() => {
        mocks.saveJsonFile.mockReset();
    });

    it('opens the native JSON save dialog with formatted content', async () => {
        await downloadJsonFile('grp_test_members.json', [{ id: 'usr_test' }]);

        expect(mocks.saveJsonFile).toHaveBeenCalledWith(
            'grp_test_members.json',
            '[\n  {\n    "id": "usr_test"\n  }\n]'
        );
    });
});
