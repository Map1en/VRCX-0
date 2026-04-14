import { backend } from '../platform/tauri/index.js';
import { asString, safeJsonParse, safeJsonStringify } from './baseRepository.js';

class StorageRepository {
    #prefix = '';

    constructor(prefix = '') {
        this.#prefix = prefix;
    }

    key(key) {
        return `${this.#prefix}${key}`;
    }

    withPrefix(prefix) {
        return new StorageRepository(`${this.#prefix}${prefix}`);
    }

    async getString(key, defaultValue = null) {
        const value = await backend.storage.get(this.key(key));
        if (value === null || value === undefined || value === 'undefined') {
            return defaultValue;
        }
        return asString(value, defaultValue ?? '');
    }

    async get(key, defaultValue = null) {
        return this.getString(key, defaultValue);
    }

    async getJson(key, defaultValue = null) {
        const value = await this.getString(key, null);
        return safeJsonParse(value, defaultValue);
    }

    async setString(key, value) {
        return backend.storage.set(this.key(key), String(value));
    }

    async set(key, value) {
        return this.setString(key, value);
    }

    async setJson(key, value) {
        return this.setString(key, safeJsonStringify(value));
    }

    async remove(key) {
        return backend.storage.remove(this.key(key));
    }

    async has(key) {
        const value = await backend.storage.get(this.key(key));
        return value !== null && value !== undefined && value !== 'undefined';
    }

    async clear() {
        const entries = await backend.storage.getAll();
        const keys = Object.keys(entries || {}).filter((key) =>
            this.#prefix ? key.startsWith(this.#prefix) : true
        );
        await Promise.all(keys.map((key) => backend.storage.remove(key)));
        await backend.storage.flush();
    }
}

const storageRepository = new StorageRepository();

export { StorageRepository };
export default storageRepository;
