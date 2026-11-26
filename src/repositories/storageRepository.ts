import { commands } from '@/platform/tauri/bindings';
import { safeJsonParse } from '@/shared/utils/json';

import { asString, safeJsonStringify } from './baseRepository';

export class StorageRepository {
    #cache = new Map<string, string>();
    #hydration: Promise<void> | null = null;

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
        const value = this.#cache.get(key);
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
        const result = await commands.storageSet(key, value);
        this.#cache.set(key, value);
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
        const result = await commands.storageRemove(key);
        this.#cache.delete(key);
        return result;
    }

    async has(key: string): Promise<boolean> {
        await this.init();
        const value = this.#cache.get(key);
        return value !== undefined && value !== 'undefined';
    }

    async flush(): Promise<void> {
        await commands.storageFlush();
    }
}

const storageRepository = new StorageRepository();

export default storageRepository;
