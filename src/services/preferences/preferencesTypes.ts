import { ConfigKeys, type ConfigKeyName } from '@/repositories/configKeys';
import type {
    PreferencesSnapshot,
    TranslationApiType
} from '@/state/preferencesStore';

type ConfigKeyOfType<ValueType extends 'string' | 'int' | 'bool' | 'float'> = {
    [Key in ConfigKeyName]: (typeof ConfigKeys)[Key]['type'] extends ValueType
        ? Key
        : never;
}[ConfigKeyName];
export type PreferenceKey = Extract<keyof PreferencesSnapshot, string>;
type PreferenceConfigKeyOfType<ValueType extends 'string' | 'int' | 'bool'> =
    Extract<ConfigKeyOfType<ValueType>, PreferenceKey>;
type ConfigKeyAlias<Key extends string> = Key | `VRCX_${Key}`;

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
export type ProxyPreferenceOptions = {
    restart?: boolean;
};
export type ProxyServerPreferenceOptions = ProxyPreferenceOptions;
export type TranslationApiConfigPreferenceInput = {
    bioLanguage?: string;
    translationAPIType?: TranslationApiType;
    translationAPIKey?: string;
    translationEndpointId?: string;
    translationAPIEndpoint?: string;
    translationAPIModel?: string;
    translationAPIPrompt?: string | null;
    translationAPIReasoningEffort?: string;
};
