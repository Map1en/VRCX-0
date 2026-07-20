import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import configRepository from '@/repositories/configRepository';
import databaseMaintenanceRepository from '@/repositories/databaseMaintenanceRepository';
import feedRepository from '@/repositories/feedRepository';
import mediaRepository from '@/repositories/mediaRepository';
import vrchatAuthRepository from '@/repositories/vrchatAuthRepository';
import {
    addFeedHiddenUserPreference,
    setBoolConfigPreference,
    setCropInstancePrintsPreference,
    setIntConfigPreference,
    setLocalFavoriteFriendsGroupsPreference,
    setOverlayActivityFiltersPreference,
    setProxyEnabledPreference,
    setStringConfigPreference,
    setHmdNotificationActivityFiltersPreference,
    setTableLimitsPreference,
    setTrustColorPreference,
    setUserGeneratedContentPathPreference,
    setVrNotificationActivityFiltersPreference,
    setDesktopNotificationActivityFiltersPreference,
    setWebhookActivityFiltersPreference,
    setTtsNotificationActivityFiltersPreference,
    setWristOverlayEnabledPreference,
    loadTrustColorPreference,
    removeFeedHiddenUserPreference,
    resetTrustColorsPreference
} from '@/services/preferencesService';
import {
    APP_FONT_DEFAULT_KEY,
    applyAppFontPreferences,
    normalizeAppCjkFontPack,
    normalizeAppFontFamily
} from '@/services/themeService';
import {
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT,
    SEARCH_LIMIT_MAX,
    SEARCH_LIMIT_MIN,
    TABLE_MAX_SIZE_MAX,
    TABLE_MAX_SIZE_MIN
} from '@/shared/constants/settings';
import { useModalStore } from '@/state/modalStore';
import {
    normalizePreferenceSnapshot,
    usePreferencesStore
} from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { createDefaultSettingsPrefs } from './settingsDefaultPrefs';
import { isValidFontFamilyList, parseIntegerInput } from './settingsValues';
import { useSettingsMaintenanceActions } from './useSettingsMaintenanceActions';
import { useSettingsPreferenceActions } from './useSettingsPreferenceActions';

type SettingsPreferenceActionDeps = Parameters<
    typeof useSettingsPreferenceActions
>[0];
type SettingsMaintenanceActionDeps = Parameters<
    typeof useSettingsMaintenanceActions
>[0];
type SettingsPagePrefsDraft = ReturnType<typeof createDefaultSettingsPrefs>;
type SettingsPagePrefsSetter = (
    value:
        | SettingsPagePrefsDraft
        | ((current: SettingsPagePrefsDraft) => SettingsPagePrefsDraft)
) => void;
type SettingsActionsDeps = Pick<
    SettingsPreferenceActionDeps,
    | 'commit'
    | 'customFontDraft'
    | 'localFavoriteFriendsGroups'
    | 'prefs'
    | 'setConfigTreeData'
    | 'setCustomFontDialogOpen'
    | 'setCustomFontDraft'
    | 'setCustomFontOptions'
    | 'setCustomFontOptionsLoading'
    | 'setDiscordPrefs'
    | 'setIntegrationPrefs'
    | 'setLocalFavoriteFriendsGroups'
    | 'setOnlineVisitCount'
    | 'setSqliteTableSizes'
    | 'setTableLimitsDialogOpen'
    | 'setTableLimitsDraft'
    | 'setTablePageSizesDialogOpen'
    | 'tableLimitsDraft'
> &
    Pick<
        SettingsMaintenanceActionDeps,
        | 'purgePeriod'
        | 'setAppDataDirState'
        | 'setPurgeDialogOpen'
        | 'setPurgeInProgress'
    > & { setPrefs: SettingsPagePrefsSetter };

export function useSettingsActions(deps: SettingsActionsDeps) {
    const { t, i18n } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const prompt = useModalStore((state) => state.prompt);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const isGameRunning = useRuntimeStore(
        (state) => state.gameState.isGameRunning
    );
    const auth = {
        currentUserId,
        currentUserEndpoint
    };
    const gameState = {
        isGameRunning
    };
    const tableMaxSizeValue = Number.parseInt(
        deps.tableLimitsDraft.maxTableSize,
        10
    );
    const tableMaxSizeError =
        !Number.isFinite(tableMaxSizeValue) ||
        tableMaxSizeValue < TABLE_MAX_SIZE_MIN ||
        tableMaxSizeValue > TABLE_MAX_SIZE_MAX
            ? t('prompt.table_entries_settings.table_max_entries_error', {
                  min: TABLE_MAX_SIZE_MIN,
                  max: TABLE_MAX_SIZE_MAX
              })
            : '';
    const searchLimitValue = Number.parseInt(
        deps.tableLimitsDraft.searchLimit,
        10
    );
    const searchLimitError =
        !Number.isFinite(searchLimitValue) ||
        searchLimitValue < SEARCH_LIMIT_MIN ||
        searchLimitValue > SEARCH_LIMIT_MAX
            ? t('prompt.table_entries_settings.search_limit_returns_error', {
                  min: SEARCH_LIMIT_MIN,
                  max: SEARCH_LIMIT_MAX
              })
            : '';
    const tableLimitsSaveDisabled = Boolean(
        tableMaxSizeError || searchLimitError
    );
    const actionDeps = {
        ...deps,
        APP_FONT_DEFAULT_KEY,
        DEFAULT_MAX_TABLE_SIZE,
        DEFAULT_SEARCH_LIMIT,
        applyAppFontPreferences,
        auth,
        configRepository,
        confirm,
        databaseMaintenanceRepository,
        feedRepository,
        gameState,
        isValidFontFamilyList,
        language: i18n.language,
        loadTrustColorPreference,
        mediaRepository,
        normalizeAppCjkFontPack,
        normalizeAppFontFamily,
        normalizePreferenceSnapshot,
        parseIntegerInput,
        prompt,
        resetTrustColorsPreference,
        setBoolConfigPreference,
        setCropInstancePrintsPreference,
        setIntConfigPreference,
        setLocalFavoriteFriendsGroupsPreference,
        setOverlayActivityFiltersPreference,
        setProxyEnabledPreference,
        setStringConfigPreference,
        setHmdNotificationActivityFiltersPreference,
        setTableLimitsPreference,
        setTrustColorPreference,
        setUserGeneratedContentPathPreference,
        setVrNotificationActivityFiltersPreference,
        setDesktopNotificationActivityFiltersPreference,
        setWebhookActivityFiltersPreference,
        setTtsNotificationActivityFiltersPreference,
        setWristOverlayEnabledPreference,
        t,
        tableLimitsSaveDisabled,
        toast,
        usePreferencesStore,
        setPrefs: deps.setPrefs as SettingsPreferenceActionDeps['setPrefs'],
        vrchatAuthRepository
    };
    const preferenceActions = useSettingsPreferenceActions(actionDeps);
    const maintenanceActions = useSettingsMaintenanceActions({
        ...actionDeps,
        ...preferenceActions
    });
    function normalizeCurrentFeedHiddenUsers() {
        return normalizePreferenceSnapshot({
            feedHiddenUsers: deps.prefs.feedHiddenUsers
        }).feedHiddenUsers;
    }
    async function addFeedHiddenUser(userId: string) {
        const previous = normalizeCurrentFeedHiddenUsers();
        const next = normalizePreferenceSnapshot({
            feedHiddenUsers: [...previous, userId]
        }).feedHiddenUsers;
        await deps.commit(
            () => addFeedHiddenUserPreference(userId),
            () => {
                deps.setPrefs((current) => ({
                    ...current,
                    feedHiddenUsers: next
                }));
                return () =>
                    deps.setPrefs((current) => ({
                        ...current,
                        feedHiddenUsers: previous
                    }));
            }
        );
    }
    async function removeFeedHiddenUser(userId: unknown) {
        const normalizedUserId =
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim();
        if (!normalizedUserId) {
            return;
        }
        const previous = normalizeCurrentFeedHiddenUsers();
        const next = previous.filter((id) => id !== normalizedUserId);
        await deps.commit(
            () => removeFeedHiddenUserPreference(normalizedUserId),
            () => {
                deps.setPrefs((current) => ({
                    ...current,
                    feedHiddenUsers: next
                }));
                return () =>
                    deps.setPrefs((current) => ({
                        ...current,
                        feedHiddenUsers: previous
                    }));
            }
        );
    }
    return {
        ...preferenceActions,
        ...maintenanceActions,
        addFeedHiddenUser,
        removeFeedHiddenUser,
        searchLimitError,
        tableLimitsSaveDisabled,
        tableMaxSizeError
    };
}
