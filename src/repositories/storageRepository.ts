import { commands } from '@/platform/tauri/bindings';
import { safeJsonParse } from '@/shared/utils/json';

import { asString, safeJsonStringify } from './baseRepository';

export class StorageRepository {
    #prefix = '';
    #cache = new Map<string, string>();
    #hydration: Promise<void> | null = null;

    constructor(prefix: string = '') {
        this.#prefix = prefix;
    }

    key(key: string): string {
        return `${this.#prefix}${key}`;
    }

    withPrefix(prefix: string): StorageRepository {
        return new StorageRepository(`${this.#prefix}${prefix}`);
    }

    async init(): Promise<void> {
        this.#hydration ??= commands.storageGetAll().then((entries) => {
            for (const [key, value] of Object.entries(entries ?? {})) {
                if (value !== null && value !== undefined) {
                    this.#cache.set(key, value);
                }
            }
        });
        await this.#hydration;
    }

    async getString(key: string, defaultValue: string | null = null) {
        await this.init();
        const value = this.#cache.get(this.key(key));
        if (value === undefined || value === 'undefined') {
            return defaultValue;
        }
        return asString(value, defaultValue ?? '');
    }

    async get(key: string, defaultValue: string | null = null) {
        return this.getString(key, defaultValue);
    }

    async getJson<T = unknown>(key: string, defaultValue: T | null = null) {
        const value = await this.getString(key, null);
        const parsed = safeJsonParse(value) as T | null;
        return parsed ?? defaultValue;
    }

    async setString(key: string, value: string) {
        await this.init();
        const dbKey = this.key(key);
        const result = await commands.storageSet(dbKey, value);
        this.#cache.set(dbKey, value);
        return result;
    }

    async set(key: string, value: string) {
        return this.setString(key, value);
    }

    async setJson(key: string, value: unknown) {
        return this.setString(key, safeJsonStringify(value));
    }

    async remove(key: string) {
        await this.init();
        const dbKey = this.key(key);
        const result = await commands.storageRemove(dbKey);
        this.#cache.delete(dbKey);
        return result;
    }

    async has(key: string): Promise<boolean> {
        await this.init();
        const value = this.#cache.get(this.key(key));
        return value !== undefined && value !== 'undefined';
    }

    async flush(): Promise<void> {
        await commands.storageFlush();
    }

    async clear(): Promise<void> {
        await this.init();
        const keys = [...this.#cache.keys()].filter((key) =>
            key.startsWith(this.#prefix)
        );
        await Promise.all(keys.map((key) => commands.storageRemove(key)));
        for (const key of keys) {
            this.#cache.delete(key);
        }
        await commands.storageFlush();
    }
}

const storageRepository = new StorageRepository();

export default storageRepository;
