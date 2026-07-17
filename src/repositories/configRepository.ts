import { commands } from '@/platform/tauri/bindings';
import { ConfigKeys, type ConfigDefaultValue } from '@/repositories/configKeys';

import { asString, safeJsonParse, safeJsonStringify } from './baseRepository';

type ConfigEntries = Array<[string, unknown]>;
type ConfigObject = Record<string, unknown> | unknown[] | null;

const HIDDEN_VR_PANEL_CONFIG_DB_KEYS = new Set([
    'config:vrcx_vroverlaypanelenabled',
    'config:vrcx_vroverlaypanelallfriendsincludesfavorites'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHiddenVrPanelConfigDbKey(key: string): boolean {
    return HIDDEN_VR_PANEL_CONFIG_DB_KEYS.has(key);
}

function normalizeConfigReadEntry(row: unknown): [string, string] | null {
    if (Array.isArray(row)) {
        const [key, value] = row;
        return typeof key === 'string' && value != null
            ? [key, String(value)]
            : null;
    }

    if (!isRecord(row)) {
        return null;
    }

    const { key, value } = row;
    return typeof key === 'string' && value != null
        ? [key, String(value)]
        : null;
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

        const rows = await commands.appConfigListValues();
        for (const row of rows) {
            const entry = normalizeConfigReadEntry(row);
            if (entry) {
                if (isHiddenVrPanelConfigDbKey(entry[0])) {
                    continue;
                }
                this.#cache.set(entry[0], entry[1]);
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
        if (isHiddenVrPanelConfigDbKey(dbKey)) {
            this.#cache.delete(dbKey);
            return null;
        }
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

        for (const [dbKey] of normalizedEntries) {
            if (isHiddenVrPanelConfigDbKey(dbKey)) {
                this.#cache.delete(dbKey);
            }
        }
        const writableEntries = normalizedEntries.filter(
            ([dbKey]) => !isHiddenVrPanelConfigDbKey(dbKey)
        );
        if (writableEntries.length === 0) {
            return;
        }

        await commands.appConfigSetValues(
            writableEntries.map(([key, value]) => ({
                key,
                value
            }))
        );

        for (const [dbKey, stringValue] of writableEntries) {
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
