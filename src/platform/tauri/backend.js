import { createBackendNamespace } from './commands.js';
import { backendEvents } from './events.js';
import { webview } from './webview.js';

const app = createBackendNamespace('app');
const discordCommands = createBackendNamespace('discord');

const discord = new Proxy(
    discordCommands,
    {
        get(target, property) {
            if (property === 'OpenDiscordProfile') {
                return (discordId) => app.OpenDiscordProfile(discordId);
            }

            if (typeof property !== 'string') {
                return undefined;
            }

            return target[property];
        }
    }
);

export const backend = Object.freeze({
    app,
    web: createBackendNamespace('web'),
    storage: createBackendNamespace('storage'),
    sqlite: createBackendNamespace('sqlite'),
    logWatcher: createBackendNamespace('logWatcher'),
    discord,
    assetBundle: createBackendNamespace('assetBundle'),
    events: backendEvents,
    webview
});

export default backend;
