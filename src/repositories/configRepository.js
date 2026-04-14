import sqliteRepository from './sqliteRepository.js';
import { asString, safeJsonParse, safeJsonStringify } from './baseRepository.js';
import { ConfigKeys } from '@/services/configKeys.js';

class ConfigRepository {
    #cache = new Map();
    #ready = false;

    #resolveKey(key) {
        if (key.startsWith('config:')) {
            return key;
        }

        const stripped = key.startsWith('VRCX_') ? key.slice(5) : key;
        return `config:vrcx_${stripped.toLowerCase()}`;
    }

    #getSchemaDefault(key) {
        const stripped = key.startsWith('VRCX_') ? key.slice(5) : key;
        return ConfigKeys[stripped]?.default ?? null;
    }

    async init() {
        if (this.#ready) {
            return;
        }

        await sqliteRepository.executeNonQuery(
            'CREATE TABLE IF NOT EXISTS configs (`key` TEXT PRIMARY KEY, `value` TEXT)'
        );

        const rows = await sqliteRepository.query('SELECT key, value FROM configs');
        if (Array.isArray(rows)) {
            for (const row of rows) {
                if (Array.isArray(row) && row[0] != null && row[1] != null) {
                    this.#cache.set(row[0], row[1]);
                } else if (row && typeof row === 'object') {
                    const key = row.key ?? row[0];
                    const value = row.value ?? row[1];
                    if (key != null && value != null) {
                        this.#cache.set(key, value);
                    }
                }
            }
        }

        this.#ready = true;
    }

    async #ensureReady() {
        if (!this.#ready) {
            await this.init();
        }
    }

    async getRawValue(key) {
        await this.#ensureReady();
        const dbKey = this.#resolveKey(key);
        const value = this.#cache.get(dbKey);
        if (value === null || value === undefined || value === 'undefined') {
            return null;
        }
        return value;
    }

    async getString(key, defaultValue = null) {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== null) {
                return defaultValue;
            }
            return this.#getSchemaDefault(key);
        }
        return asString(value, defaultValue ?? '');
    }

    async get(key, defaultValue = null) {
        return this.getString(key, defaultValue);
    }

    async getBool(key, defaultValue = undefined) {
        const value = await this.getRawValue(key);
        if (value === null) {
            if (defaultValue !== undefined) {
                return defaultValue;
            }
            return this.#getSchemaDefault(key);
        }
        return value === 'true';
    }

    async getInt(key, defaultValue = undefined) {
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

    async getFloat(key, defaultValue = undefined) {
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

    async getObject(key, defaultValue = null) {
        const value = await this.getString(key, null);
        return safeJsonParse(value, defaultValue);
    }

    async getArray(key, defaultValue = null) {
        const value = await this.getObject(key, null);
        return Array.isArray(value) ? value : defaultValue;
    }

    async setString(key, value) {
        await this.#ensureReady();
        const dbKey = this.#resolveKey(key);
        const stringValue = String(value);
        this.#cache.set(dbKey, stringValue);
        return sqliteRepository.executeNonQuery(
            'INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)',
            { '@key': dbKey, '@value': stringValue }
        );
    }

    async set(key, value) {
        return this.setString(key, value);
    }

    async setBool(key, value) {
        return this.setString(key, value ? 'true' : 'false');
    }

    async setInt(key, value) {
        return this.setString(key, value);
    }

    async setFloat(key, value) {
        return this.setString(key, value);
    }

    async setObject(key, value) {
        return this.setString(key, safeJsonStringify(value));
    }

    async setMany(entries) {
        await this.#ensureReady();
        const normalizedEntries = entries.map(([key, value]) => [
            this.#resolveKey(key),
            String(value)
        ]);

        await sqliteRepository.transaction(async (tx) => {
            for (const [dbKey, stringValue] of normalizedEntries) {
                await tx.executeNonQuery(
                    'INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)',
                    { '@key': dbKey, '@value': stringValue }
                );
            }
        });

        for (const [dbKey, stringValue] of normalizedEntries) {
            this.#cache.set(dbKey, stringValue);
        }
    }

    async setArray(key, value) {
        return this.setObject(key, value);
    }

    async remove(key) {
        await this.#ensureReady();
        const dbKey = this.#resolveKey(key);
        this.#cache.delete(dbKey);
        return sqliteRepository.executeNonQuery('DELETE FROM configs WHERE key = @key', {
            '@key': dbKey
        });
    }

    async has(key) {
        return (await this.getRawValue(key)) !== null;
    }
}

const configRepository = new ConfigRepository();

export { ConfigRepository };
export default configRepository;
