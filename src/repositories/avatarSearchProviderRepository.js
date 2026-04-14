import { safeJsonParse } from './baseRepository.js';
import { publishPreferenceChanged } from '@/lib/preferenceEvents.js';
import configRepository from './configRepository.js';
import webRepository from './webRepository.js';
import avatarProfileRepository from './avatarProfileRepository.js';

const DEFAULT_PROVIDER = 'https://api.avtrdb.com/v3/avatar/search/vrcx';
const AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS = [
    'avatarRemoteDatabase',
    'VRCX_avatarRemoteDatabaseProviderList',
    'VRCX_avatarRemoteDatabaseProvider'
];
const LEGACY_PROVIDER_URLS = new Map([
    ['https://avtr.just-h.party/vrcx_search.php', null],
    ['https://api.avtrdb.com/v1/avatar/search/vrcx', DEFAULT_PROVIDER],
    ['https://api.avtrdb.com/v2/avatar/search/vrcx', DEFAULT_PROVIDER]
]);

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function pick(value, ...keys) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    for (const key of keys) {
        if (value[key] !== undefined && value[key] !== null) {
            return value[key];
        }
    }

    return undefined;
}

function normalizeProviderList(values) {
    if (!Array.isArray(values)) {
        return [DEFAULT_PROVIDER];
    }

    const providers = [];
    for (const rawValue of values) {
        const value = normalizeString(rawValue);
        if (!value) {
            continue;
        }

        if (LEGACY_PROVIDER_URLS.has(value)) {
            const replacement = LEGACY_PROVIDER_URLS.get(value);
            if (replacement) {
                providers.push(replacement);
            }
            continue;
        }

        providers.push(value);
    }

    return Array.from(new Set(providers));
}

function buildProviderSearchUrl(providerUrl, query) {
    const url = new URL(providerUrl);
    url.searchParams.set('search', query);
    url.searchParams.set('n', '5000');
    return url.toString();
}

function parseResponse(data) {
    if (typeof data === 'string') {
        return safeJsonParse(data, null);
    }

    return data;
}

function publishAvatarSearchProviderConfig(config) {
    publishPreferenceChanged('VRCX_avatarRemoteDatabaseProviderList', config);
}

function normalizeAvatarProviderItem(avatar) {
    const normalized = avatarProfileRepository.normalize({
        ...avatar,
        id: pick(avatar, 'id', 'Id', '_id', 'avatarId', 'AvatarId'),
        name: pick(avatar, 'name', 'Name'),
        description: pick(avatar, 'description', 'Description'),
        authorId: pick(avatar, 'authorId', 'AuthorId', 'author_id'),
        authorName: pick(avatar, 'authorName', 'AuthorName', 'author_name'),
        imageUrl: pick(avatar, 'imageUrl', 'ImageUrl', 'image_url'),
        thumbnailImageUrl: pick(avatar, 'thumbnailImageUrl', 'ThumbnailImageUrl', 'thumbnail_image_url'),
        created_at: pick(avatar, 'created_at', 'createdAt', 'CreatedAt'),
        updated_at: pick(avatar, 'updated_at', 'updatedAt', 'UpdatedAt'),
        releaseStatus: pick(avatar, 'releaseStatus', 'ReleaseStatus', 'release_status') || 'public'
    });

    return {
        ...normalized,
        created_at: normalized.created_at || '0001-01-01T00:00:00.0000000Z',
        updated_at: normalized.updated_at || '0001-01-01T00:00:00.0000000Z',
        releaseStatus: normalized.releaseStatus || 'public'
    };
}

class AvatarSearchProviderRepository {
    async getConfig() {
        const [enabled, providerListValue, selectedProviderValue] = await Promise.all([
            configRepository.getBool('avatarRemoteDatabase', true),
            configRepository.getString(
                'VRCX_avatarRemoteDatabaseProviderList',
                `["${DEFAULT_PROVIDER}"]`
            ),
            configRepository.getString('VRCX_avatarRemoteDatabaseProvider', '')
        ]);

        let parsedProviderList = safeJsonParse(providerListValue, null);
        if (!Array.isArray(parsedProviderList)) {
            parsedProviderList = [DEFAULT_PROVIDER];
        }

        if (selectedProviderValue && !parsedProviderList.includes(selectedProviderValue)) {
            parsedProviderList = [...parsedProviderList, selectedProviderValue];
        }

        const providerList = normalizeProviderList(parsedProviderList);
        if (JSON.stringify(providerList) !== JSON.stringify(parsedProviderList)) {
            await configRepository.setString(
                'VRCX_avatarRemoteDatabaseProviderList',
                JSON.stringify(providerList)
            );
        }

        if (selectedProviderValue) {
            await configRepository.remove('avatarRemoteDatabaseProvider');
        }
        const selectedProvider = providerList.includes(selectedProviderValue)
            ? selectedProviderValue
            : providerList[0] || '';

        return {
            enabled: Boolean(enabled) && providerList.length > 0,
            providerList,
            selectedProvider
        };
    }

    async saveConfig({ enabled, providerList, selectedProvider = '' }) {
        const normalizedProviderList = normalizeProviderList(providerList);
        const persistedSelectedProvider =
            normalizeString(selectedProvider) ||
            await configRepository.getString('VRCX_avatarRemoteDatabaseProvider', '');
        const resolvedSelectedProvider = normalizedProviderList.includes(persistedSelectedProvider)
            ? persistedSelectedProvider
            : normalizedProviderList[0] || '';
        await Promise.all([
            configRepository.setString(
                'VRCX_avatarRemoteDatabaseProviderList',
                JSON.stringify(normalizedProviderList)
            ),
            configRepository.setBool(
                'VRCX_avatarRemoteDatabase',
                Boolean(enabled) && normalizedProviderList.length > 0
            ),
            resolvedSelectedProvider
                ? configRepository.setString('VRCX_avatarRemoteDatabaseProvider', resolvedSelectedProvider)
                : configRepository.remove('VRCX_avatarRemoteDatabaseProvider')
        ]);

        const savedConfig = {
            enabled: Boolean(enabled) && normalizedProviderList.length > 0,
            providerList: normalizedProviderList,
            selectedProvider: resolvedSelectedProvider
        };
        publishAvatarSearchProviderConfig(savedConfig);
        return savedConfig;
    }

    async saveSelectedProvider(provider) {
        const normalizedProvider = normalizeString(provider);
        if (!normalizedProvider) {
            return '';
        }
        await configRepository.setString('VRCX_avatarRemoteDatabaseProvider', normalizedProvider);
        publishPreferenceChanged('VRCX_avatarRemoteDatabaseProvider', normalizedProvider);
        return normalizedProvider;
    }

    async getVrcxId() {
        let id = await configRepository.getString('id', '');
        if (!id) {
            id = globalThis.crypto?.randomUUID?.() || '';
            if (id) {
                await configRepository.setString('id', id);
            }
        }
        return id;
    }

    async search({ provider, query }) {
        const normalizedProvider = normalizeString(provider);
        const normalizedQuery = normalizeString(query);
        if (!normalizedProvider) {
            throw new Error('Avatar provider is not configured.');
        }
        if (normalizedQuery.length < 3) {
            throw new Error('Avatar search requires at least 3 characters.');
        }

        const [url, vrcxId] = await Promise.all([
            Promise.resolve(buildProviderSearchUrl(normalizedProvider, normalizedQuery)),
            this.getVrcxId()
        ]);

        const response = await webRepository.execute({
            url,
            method: 'GET',
            headers: {
                Referer: 'https://vrcx.app',
                'VRCX-ID': vrcxId
            }
        });
        const json = parseResponse(response.data);

        if (response.status !== 200) {
            throw new Error(`Avatar search failed (${response.status})`);
        }
        if (!Array.isArray(json)) {
            throw new Error('Avatar provider returned an unsupported response.');
        }

        const avatars = new Map();
        for (const item of json) {
            const avatar = normalizeAvatarProviderItem(item);
            if (avatar.id && !avatars.has(avatar.id)) {
                avatars.set(avatar.id, avatar);
            }
        }

        return {
            avatars: Array.from(avatars.values()),
            provider: normalizedProvider,
            query: normalizedQuery,
            status: response.status,
            raw: response.raw
        };
    }
}

const avatarSearchProviderRepository = new AvatarSearchProviderRepository();

export {
    AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
    AvatarSearchProviderRepository
};
export default avatarSearchProviderRepository;
