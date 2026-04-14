import { asString, safeJsonStringify } from './baseRepository.js';
import configRepository from './configRepository.js';
import webRepository from './webRepository.js';

function normalizeLoginParams(entry) {
    const rawLoginParams = entry?.loginParams ?? entry?.loginParmas ?? {};

    return {
        username: asString(rawLoginParams.username, ''),
        password: asString(rawLoginParams.password, ''),
        endpoint: asString(rawLoginParams.endpoint, ''),
        websocket: asString(rawLoginParams.websocket, '')
    };
}

function normalizeSavedCredentialRecord(key, entry) {
    if (!entry || typeof entry !== 'object' || !entry.user || typeof entry.user !== 'object') {
        return { edited: false, normalizedKey: null, value: null };
    }

    const userId = asString(entry.user.id, key).trim();
    if (!userId) {
        return { edited: false, normalizedKey: null, value: null };
    }

    const normalizedValue = {
        user: entry.user,
        loginParams: normalizeLoginParams(entry)
    };

    if (entry.cookies !== undefined && entry.cookies !== null && entry.cookies !== '') {
        normalizedValue.cookies = entry.cookies;
    }

    const hasEndpointField = Object.prototype.hasOwnProperty.call(
        entry.loginParams ?? {},
        'endpoint'
    );
    const hasWebsocketField = Object.prototype.hasOwnProperty.call(
        entry.loginParams ?? {},
        'websocket'
    );
    const edited =
        userId !== key ||
        Boolean(entry.loginParmas) ||
        !hasEndpointField ||
        !hasWebsocketField;

    return {
        edited,
        normalizedKey: userId,
        value: normalizedValue
    };
}

function sortSavedCredentials(savedCredentials, lastUserLoggedIn) {
    return Object.values(savedCredentials).sort((left, right) => {
        const leftIsLast = left.user?.id === lastUserLoggedIn;
        const rightIsLast = right.user?.id === lastUserLoggedIn;

        if (leftIsLast !== rightIsLast) {
            return leftIsLast ? -1 : 1;
        }

        const leftName = asString(left.user?.displayName || left.user?.username, '').toLowerCase();
        const rightName = asString(right.user?.displayName || right.user?.username, '').toLowerCase();
        return leftName.localeCompare(rightName);
    });
}

function resolveAutoLoginStatus({
    lastUserLoggedIn,
    savedCredentials,
    autoLoginDelayEnabled,
    autoLoginDelaySeconds
}) {
    if (!lastUserLoggedIn) {
        return {
            status: 'not-configured',
            reason: 'No previous login was recorded.'
        };
    }

    const savedCredential = savedCredentials[lastUserLoggedIn];
    if (!savedCredential) {
        return {
            status: 'missing-last-user',
            reason: 'The last logged-in account is no longer present in saved credentials.'
        };
    }

    if (!savedCredential.loginParams.username || !savedCredential.loginParams.password) {
        return {
            status: 'missing-credentials',
            reason: 'The saved account is missing username or password data.'
        };
    }

    if (autoLoginDelayEnabled && autoLoginDelaySeconds > 0) {
        return {
            status: 'available',
            reason: `Saved credentials are available. Auto-login delay is ${autoLoginDelaySeconds} second(s).`
        };
    }

    return {
        status: 'available',
        reason: 'Saved credentials are available and auto-login can run immediately.'
    };
}

class AuthRepository {
    async getSavedCredentialsMap() {
        const rawSavedCredentials = await configRepository.getObject('savedCredentials', {});
        const source =
            rawSavedCredentials && typeof rawSavedCredentials === 'object'
                ? rawSavedCredentials
                : {};

        const normalized = {};
        let edited = false;

        for (const [key, value] of Object.entries(source)) {
            const normalizedRecord = normalizeSavedCredentialRecord(key, value);
            if (!normalizedRecord.normalizedKey || !normalizedRecord.value) {
                edited = true;
                continue;
            }

            normalized[normalizedRecord.normalizedKey] = normalizedRecord.value;
            edited = edited || normalizedRecord.edited;
        }

        if (edited || safeJsonStringify(source) !== safeJsonStringify(normalized)) {
            await configRepository.setObject('savedCredentials', normalized);
        }

        return normalized;
    }

    async getSavedCredential(userId) {
        if (!userId) {
            return null;
        }

        const savedCredentials = await this.getSavedCredentialsMap();
        return savedCredentials[userId] ?? null;
    }

    async deleteSavedCredential(userId) {
        const savedCredentials = await this.getSavedCredentialsMap();
        delete savedCredentials[userId];
        await configRepository.setObject('savedCredentials', savedCredentials);

        const lastUserLoggedIn = await configRepository.getString('lastUserLoggedIn', null);
        if (lastUserLoggedIn === userId) {
            await configRepository.remove('lastUserLoggedIn');
        }

        return this.getSavedAuthSnapshot();
    }

    async setCustomEndpointEnabled(value) {
        await configRepository.setBool('enableCustomEndpoint', Boolean(value));
        return this.getSavedAuthSnapshot();
    }

    async recordLoginSuccess({
        user,
        loginParams = {},
        storedLoginParams = null,
        saveCredentials = false
    }) {
        const userId = asString(user?.id, '').trim();
        if (!userId) {
            throw new Error('AuthRepository.recordLoginSuccess requires a user id');
        }

        const savedCredentials = await this.getSavedCredentialsMap();
        const existingRecord = savedCredentials[userId] ?? null;

        if (saveCredentials) {
            savedCredentials[userId] = {
                user,
                loginParams: normalizeLoginParams({
                    loginParams: storedLoginParams ?? loginParams
                })
            };
            delete savedCredentials[userId].cookies;
        } else if (existingRecord) {
            savedCredentials[userId] = {
                ...existingRecord,
                user
            };
            const cookies = await webRepository.getCookies();
            if (cookies !== undefined && cookies !== null && cookies !== '') {
                savedCredentials[userId].cookies = cookies;
            } else {
                delete savedCredentials[userId].cookies;
            }
        }

        await configRepository.setObject('savedCredentials', savedCredentials);
        await configRepository.setString('lastUserLoggedIn', userId);
        return this.getSavedAuthSnapshot();
    }

    async recordLogout(userOrUserId, options = {}) {
        const user =
            userOrUserId && typeof userOrUserId === 'object'
                ? userOrUserId
                : null;
        const userId = asString(user?.id ?? userOrUserId, '').trim();
        const clearLastUserLoggedIn =
            options.clearLastUserLoggedIn !== undefined
                ? Boolean(options.clearLastUserLoggedIn)
                : Boolean(userId);
        if (userId) {
            const savedCredentials = await this.getSavedCredentialsMap();
            if (savedCredentials[userId]) {
                if (user) {
                    savedCredentials[userId] = {
                        ...savedCredentials[userId],
                        user
                    };
                }

                const cookies =
                    options.cookies !== undefined
                        ? options.cookies
                        : await webRepository.getCookies();
                if (cookies !== undefined && cookies !== null && cookies !== '') {
                    savedCredentials[userId].cookies = cookies;
                } else {
                    delete savedCredentials[userId].cookies;
                }

                await configRepository.setObject('savedCredentials', savedCredentials);
            }
        }

        if (clearLastUserLoggedIn) {
            await configRepository.remove('lastUserLoggedIn');
        }
        return this.getSavedAuthSnapshot();
    }

    async getSavedAuthSnapshot() {
        let [
            savedCredentials,
            lastUserLoggedIn,
            legacyPrimaryPasswordEnabled,
            enableCustomEndpoint,
            autoLoginDelayEnabled,
            autoLoginDelaySeconds
        ] = await Promise.all([
            this.getSavedCredentialsMap(),
            configRepository.getString('lastUserLoggedIn', null),
            configRepository.getBool('enablePrimaryPassword', false),
            configRepository.getBool('enableCustomEndpoint', false),
            configRepository.getBool('autoLoginDelayEnabled', false),
            configRepository.getInt('autoLoginDelaySeconds', 0)
        ]);

        if (legacyPrimaryPasswordEnabled) {
            savedCredentials = {};
            lastUserLoggedIn = null;
            await configRepository.setMany([
                ['savedCredentials', '{}']
            ]);
            await configRepository.remove('enablePrimaryPassword');
            await configRepository.remove('lastUserLoggedIn');
        }

        const autoLogin = resolveAutoLoginStatus({
            lastUserLoggedIn,
            savedCredentials,
            autoLoginDelayEnabled,
            autoLoginDelaySeconds
        });

        return {
            lastUserLoggedIn,
            savedCredentialCount: Object.keys(savedCredentials).length,
            savedCredentials,
            savedCredentialsList: sortSavedCredentials(savedCredentials, lastUserLoggedIn),
            enableCustomEndpoint: Boolean(enableCustomEndpoint),
            autoLoginDelayEnabled: Boolean(autoLoginDelayEnabled),
            autoLoginDelaySeconds: Number.isFinite(autoLoginDelaySeconds)
                ? autoLoginDelaySeconds
                : 0,
            autoLoginStatus: autoLogin.status,
            autoLoginReason: autoLogin.reason
        };
    }
}

const authRepository = new AuthRepository();

export { AuthRepository };
export default authRepository;
