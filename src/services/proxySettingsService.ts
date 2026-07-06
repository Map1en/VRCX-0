import {
    commands,
    type ProxySettingsTestResult
} from '@/platform/tauri/bindings';

import {
    setProxyEnabledPreference,
    setProxyServerPreference
} from './preferencesService';

type ProxySettingsPreferenceInput = {
    enabled: boolean;
    server: string;
};

type ProxySettingsPreferenceOptions = {
    restart?: boolean;
};

export function proxySettingsErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || '');
}

export async function saveProxySettingsPreferences(
    { enabled, server }: ProxySettingsPreferenceInput,
    { restart = false }: ProxySettingsPreferenceOptions = {}
): Promise<void> {
    await setProxyServerPreference(server, { restart: false });
    await setProxyEnabledPreference(enabled, { restart });
}

export async function testProxySettings(
    proxy: string
): Promise<ProxySettingsTestResult> {
    return commands.appProxySettingsTest({
        proxy: String(proxy ?? '').trim()
    });
}
