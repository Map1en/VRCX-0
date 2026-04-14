import { backend } from '@/platform/index.js';
import { configRepository } from '@/repositories/index.js';

function safeJsonParse(value, fallback) {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizeBackup(backup, index) {
    return {
        key: `${backup?.date || index}-${backup?.name || 'backup'}`,
        name: backup?.name || 'Backup',
        date: backup?.date || '',
        data: backup?.data || {}
    };
}

async function listVrcRegistryBackups() {
    const backups = safeJsonParse(
        await configRepository.getString('VRChatRegistryBackups', '[]'),
        []
    );
    return Array.isArray(backups)
        ? backups.map((backup, index) => normalizeBackup(backup, index))
        : [];
}

async function saveVrcRegistryBackups(backups) {
    await configRepository.setString('VRChatRegistryBackups', JSON.stringify(backups));
}

async function backupVrcRegistry(name = 'Manual Backup') {
    const data = await backend.app.GetVRChatRegistry();
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        throw new Error('No VRChat registry data was found to back up.');
    }
    const backups = await listVrcRegistryBackups();
    const nextBackups = [
        ...backups.map(({ key: _key, ...backup }) => backup),
        {
            name,
            date: new Date().toJSON(),
            data
        }
    ];
    await saveVrcRegistryBackups(nextBackups);
    return nextBackups.map((backup, index) => normalizeBackup(backup, index));
}

async function restoreVrcRegistryBackup(key) {
    const backups = await listVrcRegistryBackups();
    const backup = backups.find((item) => item.key === key);
    if (!backup) {
        throw new Error('Registry backup not found.');
    }

    await backend.app.DeleteVRChatRegistryFolder();
    await backend.app.SetVRChatRegistry(
        typeof backup.data === 'string' ? backup.data : JSON.stringify(backup.data || {})
    );
    await configRepository.setString('VRChatRegistryLastRestoreCheck', backup.date || new Date().toJSON());
    return backup;
}

async function saveVrcRegistryBackupToFile(key) {
    const backups = await listVrcRegistryBackups();
    const backup = backups.find((item) => item.key === key);
    if (!backup) {
        throw new Error('Registry backup not found.');
    }

    return backend.app.SaveVrcRegJsonFile(
        null,
        `${backup.name || 'VRChat Registry Backup'}.json`,
        JSON.stringify(backup.data || {}, null, 2)
    );
}

async function restoreVrcRegistryBackupFromFile() {
    const filePath = await backend.app.OpenFileSelectorDialog(
        null,
        '.json',
        'JSON Files (*.json)|*.json'
    );
    if (!filePath) {
        return false;
    }

    const json = await backend.app.ReadVrcRegJsonFile(filePath);
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid registry backup JSON.');
    }

    for (const value of Object.values(data)) {
        if (
            !value ||
            typeof value !== 'object' ||
            typeof value.type !== 'number' ||
            typeof value.data === 'undefined'
        ) {
            throw new Error('Invalid registry backup JSON.');
        }
    }

    await backend.app.DeleteVRChatRegistryFolder();
    await backend.app.SetVRChatRegistry(json);
    await configRepository.setString('VRChatRegistryLastRestoreCheck', new Date().toJSON());
    return true;
}

async function deleteVrcRegistryFolder() {
    return backend.app.DeleteVRChatRegistryFolder();
}

async function deleteVrcRegistryBackup(key) {
    const backups = await listVrcRegistryBackups();
    const nextBackups = backups
        .filter((backup) => backup.key !== key)
        .map(({ key: _key, ...backup }) => backup);
    await saveVrcRegistryBackups(nextBackups);
    return nextBackups.map((backup, index) => normalizeBackup(backup, index));
}

export {
    backupVrcRegistry,
    deleteVrcRegistryBackup,
    deleteVrcRegistryFolder,
    listVrcRegistryBackups,
    restoreVrcRegistryBackup,
    restoreVrcRegistryBackupFromFile,
    saveVrcRegistryBackupToFile
};
