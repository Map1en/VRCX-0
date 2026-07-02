import { ConfigKeys, type ConfigKeyName } from '@/repositories/configKeys';
import type {
    PreferencesSnapshot,
    TableLimitsPreference
} from '@/state/preferencesStore';

export type ConfigKeyOfType<
    ValueType extends 'string' | 'int' | 'bool' | 'float'
> = {
    [Key in ConfigKeyName]: (typeof ConfigKeys)[Key]['type'] extends ValueType
        ? Key
        : never;
}[ConfigKeyName];
export type PreferenceKey = Extract<keyof PreferencesSnapshot, string>;
export type PreferenceConfigKeyOfType<
    ValueType extends 'string' | 'int' | 'bool'
> = Extract<ConfigKeyOfType<ValueType>, PreferenceKey>;
export type ConfigKeyAlias<Key extends string> = Key | `VRCX_${Key}`;

export type BoolConfigPreferenceKey = ConfigKeyAlias<
    PreferenceConfigKeyOfType<'bool'>
>;
export type StringConfigPreferenceKey = ConfigKeyAlias<
    PreferenceConfigKeyOfType<'string'>
>;
export type IntConfigPreferenceKey = ConfigKeyAlias<
    PreferenceConfigKeyOfType<'int'>
>;
export type StorePreferenceConfigKey = ConfigKeyAlias<PreferenceKey>;
export type IntConfigPreferenceOptions = {
    min?: number;
    max?: number;
    fallback?: number;
};
export type ProxyServerPreferenceOptions = {
    restart?: boolean;
};
export type TranslationApiConfigPreferenceInput = {
    bioLanguage?: unknown;
    translationAPIType?: unknown;
    translationAPIKey?: unknown;
    translationEndpointId?: unknown;
    translationAPIEndpoint?: unknown;
    translationAPIModel?: unknown;
    translationAPIPrompt?: unknown;
};

export type { PreferencesSnapshot, TableLimitsPreference };
