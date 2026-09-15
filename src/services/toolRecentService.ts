import configRepository from '@/repositories/configRepository';
import {
    normalizeRecentToolKeys,
    parseRecentToolKeys,
    recentToolsConfigKey
} from '@/shared/constants/tools';

let writeQueue = Promise.resolve();

export async function getRecentToolKeys(): Promise<string[]> {
    const value = await configRepository.getString(recentToolsConfigKey, '[]');
    return parseRecentToolKeys(value);
}

export function recordRecentToolOpen(toolKey: string): Promise<void> {
    const normalizedToolKey = normalizeRecentToolKeys([toolKey])[0];
    if (!normalizedToolKey) {
        return Promise.resolve();
    }

    const write = writeQueue.then(async () => {
        const current = await getRecentToolKeys();
        const next = normalizeRecentToolKeys([
            normalizedToolKey,
            ...current.filter((key) => key !== normalizedToolKey)
        ]);
        await configRepository.setString(
            recentToolsConfigKey,
            JSON.stringify(next)
        );
    });
    writeQueue = write.catch(() => {});
    return write;
}
