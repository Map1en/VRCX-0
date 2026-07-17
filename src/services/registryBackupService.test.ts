import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    requireHostCapability: vi.fn<(key: string) => void>(),
    appRegistryBackupList: vi.fn(),
    appRegistryBackupCreate: vi.fn(),
    appRegistryBackupRestore: vi.fn(),
    appRegistryBackupDelete: vi.fn(),
    appRegistryBackupExportJson: vi.fn(),
    appRegistryBackupImportJson: vi.fn(),
    appOpenFileSelectorDialog: vi.fn(),
    appSaveVrcRegJsonFile: vi.fn(),
    appReadVrcRegJsonFile: vi.fn(),
    appDeleteVrchatRegistryFolder: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appRegistryBackupList: mocks.appRegistryBackupList,
        appRegistryBackupCreate: mocks.appRegistryBackupCreate,
        appRegistryBackupRestore: mocks.appRegistryBackupRestore,
        appRegistryBackupDelete: mocks.appRegistryBackupDelete,
        appRegistryBackupExportJson: mocks.appRegistryBackupExportJson,
        appRegistryBackupImportJson: mocks.appRegistryBackupImportJson,
        appOpenFileSelectorDialog: mocks.appOpenFileSelectorDialog,
        appSaveVrcRegJsonFile: mocks.appSaveVrcRegJsonFile,
        appReadVrcRegJsonFile: mocks.appReadVrcRegJsonFile,
        appDeleteVrchatRegistryFolder: mocks.appDeleteVrchatRegistryFolder
    }
}));

vi.mock('./hostCapabilityService', () => ({
    requireHostCapability: mocks.requireHostCapability
}));

import {
    backupVrcRegistry,
    deleteVrcRegistryBackup,
    deleteVrcRegistryFolder,
    listVrcRegistryBackups,
    restoreVrcRegistryBackup,
    restoreVrcRegistryBackupFromFile,
    saveVrcRegistryBackupToFile
} from './registryBackupService';

const commandMocks = [
    mocks.appRegistryBackupList,
    mocks.appRegistryBackupCreate,
    mocks.appRegistryBackupRestore,
    mocks.appRegistryBackupDelete,
    mocks.appRegistryBackupExportJson,
    mocks.appRegistryBackupImportJson,
    mocks.appOpenFileSelectorDialog,
    mocks.appSaveVrcRegJsonFile,
    mocks.appReadVrcRegJsonFile,
    mocks.appDeleteVrchatRegistryFolder
];

const backup = {
    key: 'backup-key',
    name: 'Before update',
    date: '2026-07-15T12:00:00Z',
    data: null
};

describe('registryBackupService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.appRegistryBackupList.mockResolvedValue([backup]);
        mocks.appRegistryBackupCreate.mockResolvedValue([backup]);
        mocks.appRegistryBackupRestore.mockResolvedValue(backup);
        mocks.appRegistryBackupDelete.mockResolvedValue([]);
        mocks.appRegistryBackupExportJson.mockResolvedValue('{"value":1}');
        mocks.appRegistryBackupImportJson.mockResolvedValue(null);
        mocks.appOpenFileSelectorDialog.mockResolvedValue(
            'C:/Temp/backup.json'
        );
        mocks.appSaveVrcRegJsonFile.mockResolvedValue('C:/Temp/backup.json');
        mocks.appReadVrcRegJsonFile.mockResolvedValue('{"value":1}');
        mocks.appDeleteVrchatRegistryFolder.mockResolvedValue(null);
    });

    it.each([
        ['list', () => listVrcRegistryBackups()],
        ['create', () => backupVrcRegistry('Named backup')],
        ['restore', () => restoreVrcRegistryBackup('backup-key')],
        ['delete', () => deleteVrcRegistryBackup('backup-key')],
        ['save', () => saveVrcRegistryBackupToFile('backup-key')],
        ['import', () => restoreVrcRegistryBackupFromFile()],
        ['delete registry folder', () => deleteVrcRegistryFolder()]
    ])('checks registryPrefs before %s IPC', async (_name, invoke) => {
        mocks.requireHostCapability.mockImplementationOnce(() => {
            throw new Error('registry unavailable');
        });

        await expect(invoke()).rejects.toThrow('registry unavailable');

        expect(mocks.requireHostCapability).toHaveBeenCalledWith(
            'registryPrefs'
        );
        for (const command of commandMocks) {
            expect(command).not.toHaveBeenCalled();
        }
    });

    it('passes list, create, restore, and delete through to their commands', async () => {
        await expect(listVrcRegistryBackups()).resolves.toEqual([backup]);
        await expect(backupVrcRegistry('Named backup')).resolves.toEqual([
            backup
        ]);
        await expect(restoreVrcRegistryBackup('restore-key')).resolves.toBe(
            backup
        );
        await expect(deleteVrcRegistryBackup('delete-key')).resolves.toEqual(
            []
        );

        expect(mocks.appRegistryBackupList).toHaveBeenCalledWith();
        expect(mocks.appRegistryBackupCreate).toHaveBeenCalledWith(
            'Named backup'
        );
        expect(mocks.appRegistryBackupRestore).toHaveBeenCalledWith(
            'restore-key'
        );
        expect(mocks.appRegistryBackupDelete).toHaveBeenCalledWith(
            'delete-key'
        );
    });

    it('does not export or save when the requested backup is missing', async () => {
        mocks.appRegistryBackupList.mockResolvedValueOnce([backup]);

        await expect(
            saveVrcRegistryBackupToFile('missing-key')
        ).rejects.toThrow('Registry backup not found.');

        expect(mocks.appRegistryBackupList).toHaveBeenCalledTimes(1);
        expect(mocks.appRegistryBackupExportJson).not.toHaveBeenCalled();
        expect(mocks.appSaveVrcRegJsonFile).not.toHaveBeenCalled();
    });

    it('lists before exporting and saves with the backup name', async () => {
        await expect(saveVrcRegistryBackupToFile('backup-key')).resolves.toBe(
            'C:/Temp/backup.json'
        );

        expect(mocks.appRegistryBackupExportJson).toHaveBeenCalledWith(
            'backup-key'
        );
        expect(mocks.appSaveVrcRegJsonFile).toHaveBeenCalledWith(
            null,
            'Before update.json',
            '{"value":1}'
        );
        expect(
            mocks.appRegistryBackupList.mock.invocationCallOrder[0]
        ).toBeLessThan(
            mocks.appRegistryBackupExportJson.mock.invocationCallOrder[0]
        );
        expect(
            mocks.appRegistryBackupExportJson.mock.invocationCallOrder[0]
        ).toBeLessThan(mocks.appSaveVrcRegJsonFile.mock.invocationCallOrder[0]);
    });

    it('returns false when file selection is cancelled', async () => {
        mocks.appOpenFileSelectorDialog.mockResolvedValueOnce('');

        await expect(restoreVrcRegistryBackupFromFile()).resolves.toBe(false);

        expect(mocks.appOpenFileSelectorDialog).toHaveBeenCalledWith(
            null,
            '.json',
            'JSON Files (*.json)|*.json'
        );
        expect(mocks.appReadVrcRegJsonFile).not.toHaveBeenCalled();
        expect(mocks.appRegistryBackupImportJson).not.toHaveBeenCalled();
    });

    it('selects, reads, and imports a registry backup in order', async () => {
        mocks.appReadVrcRegJsonFile.mockResolvedValueOnce('{"value":42}');

        await expect(restoreVrcRegistryBackupFromFile()).resolves.toBe(true);

        expect(mocks.appReadVrcRegJsonFile).toHaveBeenCalledWith(
            'C:/Temp/backup.json'
        );
        expect(mocks.appRegistryBackupImportJson).toHaveBeenCalledWith(
            '{"value":42}'
        );
        expect(
            mocks.appOpenFileSelectorDialog.mock.invocationCallOrder[0]
        ).toBeLessThan(mocks.appReadVrcRegJsonFile.mock.invocationCallOrder[0]);
        expect(
            mocks.appReadVrcRegJsonFile.mock.invocationCallOrder[0]
        ).toBeLessThan(
            mocks.appRegistryBackupImportJson.mock.invocationCallOrder[0]
        );
    });

    it('deletes the VRChat registry folder', async () => {
        await expect(deleteVrcRegistryFolder()).resolves.toBeNull();

        expect(mocks.appDeleteVrchatRegistryFolder).toHaveBeenCalledWith();
    });
});
