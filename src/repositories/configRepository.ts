import { commands } from '@/platform/tauri/bindings';
import { ConfigKeys, type ConfigDefaultValue } from '@/repositories/configKeys';

import { asString, safeJsonParse, safeJsonStringify } from './baseRepository';

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
        const trimmed = key.trim();
        if (trimmed.startsWith('config:')) {
            return `config:${trimmed.slice(7).toLowerCase()}`;
        }

        const stripped = trimmed.startsWith('VRCX_')
            ? trimmed.slice(5)
            : trimmed;
        return `config:vrcx_${stripped.toLowerCase()}`;
    }

    #getSchemaDefault(key: string): ConfigDefaultValue {
        const stripped = key.startsWith('VRCX_') ? key.slice(5) : key;
        return (
            (ConfigKeys as Record<string, { default?: ConfigDefaultValue }>)[
                stripped
            ]?.default ?? null
        );
    }

    async init(): Promise<void> {
        if (this.#ready) {
            return;
        }

        await commands.appConfigSetValues([]);

        const rows = (await commands.appConfigListValues()) as ConfigRow[];
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
    ): Promise<string> {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== null) {
                return String(defaultValue);
            }
            return String(this.#getSchemaDefault(key) ?? '');
        }
        return asString(value, String(defaultValue ?? ''));
    }

    async get(
        key: string,
        defaultValue: ConfigDefaultValue = null
    ): Promise<string> {
        return this.getString(key, defaultValue);
    }

    async getBool(
        key: string,
        defaultValue: boolean | undefined = undefined
    ): Promise<boolean> {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            const schemaDefault = this.#getSchemaDefault(key);
            return typeof schemaDefault === 'boolean'
                ? schemaDefault
                : String(schemaDefault ?? '').toLowerCase() === 'true';
        }
        return value === 'true';
    }

    async getInt(
        key: string,
        defaultValue: number | undefined = undefined
    ): Promise<number> {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            return Number(this.#getSchemaDefault(key) ?? 0);
        }

        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }

        if (defaultValue !== undefined) {
            return defaultValue;
        }

        return Number(this.#getSchemaDefault(key) ?? 0);
    }

    async getFloat(
        key: string,
        defaultValue: number | undefined = undefined
    ): Promise<number> {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            return Number(this.#getSchemaDefault(key) ?? 0);
        }

        const parsed = Number.parseFloat(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }

        if (defaultValue !== undefined) {
            return defaultValue;
        }

        return Number(this.#getSchemaDefault(key) ?? 0);
    }

    async getObject<T extends ConfigObject = ConfigObject>(
        key: string,
        defaultValue: T | null = null
    ): Promise<T | null> {
        const value = await this.getString(key, null);
        return safeJsonParse(value, defaultValue) as T | null;
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
        const result = await commands.appConfigSetValues([
            { key: dbKey, value: stringValue }
        ]);
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
        const normalizedEntries = entries.map(
            ([key, value]) =>
                [this.#resolveKey(key), String(value)] satisfies [
                    string,
                    string
                ]
        );

        await commands.appConfigSetValues(
            normalizedEntries.map(([key, value]) => ({
                key,
                value
            }))
        );

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
        const result = await commands.appConfigRemoveValue(dbKey);
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
