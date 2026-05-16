import { backend } from '@/platform/index.js';
import {
    ConfigKeys,
    type ConfigDefaultValue
} from '@/repositories/configKeys.js';

import {
    asString,
    safeJsonParse,
    safeJsonStringify
} from './baseRepository.js';

type ConfigEntries = Array<[string, unknown]>;
type ConfigObject = Record<string, unknown> | unknown[] | null;

interface ConfigRow {
    key?: unknown;
    value?: unknown;
    [key: string]: unknown;
    [index: number]: unknown;
}

class ConfigRepository {
    #cache = new Map<string, string>();
    #ready = false;

    #resolveKey(key: string): string {
        if (key.startsWith('config:')) {
            return key;
        }

        const stripped = key.startsWith('VRCX_') ? key.slice(5) : key;
        return `config:vrcx_${stripped.toLowerCase()}`;
    }

    #getSchemaDefault(key: string): ConfigDefaultValue {
        const stripped = key.startsWith('VRCX_') ? key.slice(5) : key;
        return ConfigKeys[stripped]?.default ?? null;
    }

    async init(): Promise<void> {
        if (this.#ready) {
            return;
        }

        await backend.app.ConfigSetValues({ entries: [] });

        const rows = (await backend.app.ConfigListValues()) as ConfigRow[];
        if (Array.isArray(rows)) {
            for (const row of rows) {
                if (Array.isArray(row) && row[0] != null && row[1] != null) {
                    this.#cache.set(String(row[0]), String(row[1]));
                } else if (row && typeof row === 'object') {
                    const key = row.key ?? row[0];
                    const value = row.value ?? row[1];
                    if (key != null && value != null) {
                        this.#cache.set(String(key), String(value));
                    }
                }
            }
        }

        this.#ready = true;
    }

    async reload(): Promise<void> {
        this.#cache.clear();
        this.#ready = false;
        await this.init();
    }

    async #ensureReady(): Promise<void> {
        if (!this.#ready) {
            await this.init();
        }
    }

    async getRawValue(key: string): Promise<string | null> {
        await this.#ensureReady();
        const dbKey = this.#resolveKey(key);
        const value = this.#cache.get(dbKey);
        if (value === null || value === undefined || value === 'undefined') {
            return null;
        }
        return value;
    }

    async getString(
        key: string,
        defaultValue: ConfigDefaultValue = null
    ): Promise<ConfigDefaultValue> {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== null) {
                return defaultValue;
            }
            return this.#getSchemaDefault(key);
        }
        return asString(value, String(defaultValue ?? ''));
    }

    async get(
        key: string,
        defaultValue: ConfigDefaultValue = null
    ): Promise<ConfigDefaultValue> {
        return this.getString(key, defaultValue);
    }

    async getBool(
        key: string,
        defaultValue: boolean | undefined = undefined
    ): Promise<ConfigDefaultValue> {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            return this.#getSchemaDefault(key);
        }
        return value === 'true';
    }

    async getInt(
        key: string,
        defaultValue: number | undefined = undefined
    ): Promise<ConfigDefaultValue> {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            return this.#getSchemaDefault(key);
        }

        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }

        if (defaultValue !== undefined) {
            return defaultValue;
        }

        return this.#getSchemaDefault(key);
    }

    async getFloat(
        key: string,
        defaultValue: number | undefined = undefined
    ): Promise<ConfigDefaultValue> {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            return this.#getSchemaDefault(key);
        }

        const parsed = Number.parseFloat(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }

        if (defaultValue !== undefined) {
            return defaultValue;
        }

        return this.#getSchemaDefault(key);
    }

    async getObject<T extends ConfigObject = ConfigObject>(
        key: string,
        defaultValue: T | null = null
    ): Promise<T | null | unknown> {
        const value = await this.getString(key, null);
        return safeJsonParse(value, defaultValue);
    }

    async getArray<T = unknown>(
        key: string,
        defaultValue: T[] | null = null
    ): Promise<T[] | null> {
        const value = await this.getObject(key, null);
        return Array.isArray(value) ? value : defaultValue;
    }

    async setString(key: string, value: unknown): Promise<unknown> {
        await this.#ensureReady();
        const dbKey = this.#resolveKey(key);
        const stringValue = String(value);
        const result = await backend.app.ConfigSetValues({
            entries: [{ key: dbKey, value: stringValue }]
        });
        this.#cache.set(dbKey, stringValue);
        return result;
    }

    async set(key: string, value: unknown): Promise<unknown> {
        return this.setString(key, value);
    }

    async setBool(key: string, value: boolean): Promise<unknown> {
        return this.setString(key, value ? 'true' : 'false');
    }

    async setInt(key: string, value: number): Promise<unknown> {
        return this.setString(key, value);
    }

    async setFloat(key: string, value: number): Promise<unknown> {
        return this.setString(key, value);
    }

    async setObject(key: string, value: unknown): Promise<unknown> {
        return this.setString(key, safeJsonStringify(value));
    }

    async setMany(entries: ConfigEntries): Promise<void> {
        await this.#ensureReady();
        const normalizedEntries = entries.map(([key, value]) => [
            this.#resolveKey(key),
            String(value)
        ]);

        await backend.app.ConfigSetValues({
            entries: normalizedEntries.map(([key, value]) => ({
                key,
                value
            }))
        });

        for (const [dbKey, stringValue] of normalizedEntries) {
            this.#cache.set(dbKey, stringValue);
        }
    }

    async setArray(key: string, value: unknown[]): Promise<unknown> {
        return this.setObject(key, value);
    }

    async remove(key: string): Promise<unknown> {
        await this.#ensureReady();
        const dbKey = this.#resolveKey(key);
        const result = await backend.app.ConfigRemoveValue({ key: dbKey });
        this.#cache.delete(dbKey);
        return result;
    }

    async has(key: string): Promise<boolean> {
        return (await this.getRawValue(key)) !== null;
    }
}

const configRepository = new ConfigRepository();

export { ConfigRepository };
export default configRepository;
