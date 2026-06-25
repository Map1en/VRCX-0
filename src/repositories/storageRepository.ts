import { commands } from '@/platform/tauri/bindings';

import { asString, safeJsonParse, safeJsonStringify } from './baseRepository';

export class StorageRepository {
    #prefix = '';

    constructor(prefix: string = '') {
        this.#prefix = prefix;
    }

    key(key: string): string {
        return `${this.#prefix}${key}`;
    }

    withPrefix(prefix: string): StorageRepository {
        return new StorageRepository(`${this.#prefix}${prefix}`);
    }

    async getString(key: string, defaultValue: string | null = null) {
        const value = await commands.storageGet(this.key(key));
        if (value === null || value === undefined || value === 'undefined') {
            return defaultValue;
        }
        return asString(value, defaultValue ?? '');
    }

    async get(key: string, defaultValue: string | null = null) {
        return this.getString(key, defaultValue);
    }

    async getJson<T = unknown>(key: string, defaultValue: T | null = null) {
        const value = await this.getString(key, null);
        return safeJsonParse(value, defaultValue);
    }

    async setString(key: string, value: unknown) {
        return commands.storageSet(this.key(key), String(value));
    }

    async set(key: string, value: unknown) {
        return this.setString(key, value);
    }

    async setJson(key: string, value: unknown) {
        return this.setString(key, safeJsonStringify(value));
    }

    async remove(key: string) {
        return commands.storageRemove(this.key(key));
    }

    async has(key: string): Promise<boolean> {
        const value = await commands.storageGet(this.key(key));
        return value !== null && value !== undefined && value !== 'undefined';
    }

    async clear(): Promise<void> {
        const entries = (await commands.storageGetAll()) as Record<
            string,
            unknown
        >;
        const keys = Object.keys(entries || {}).filter((key) =>
            this.#prefix ? key.startsWith(this.#prefix) : true
        );
        await Promise.all(keys.map((key) => commands.storageRemove(key)));
        await commands.storageFlush();
    }
}

const storageRepository = new StorageRepository();

export default storageRepository;
