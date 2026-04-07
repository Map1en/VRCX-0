import { reactive, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';

import { logWebRequest } from '../../services/appConfig';
import { database } from '../../services/database';
import { languageCodes } from '../../localization';
import { useGameStore } from '../game';
import { useModalStore } from '../modal';
import { useUpdateLoopStore } from '../updateLoop';
import { useVRCXUpdaterStore } from '../vrcxUpdater';
import { useVrcxStore } from '../vrcx';
import { watchState } from '../../services/watchState';

import configRepository from '../../services/config';
import webApiService from '../../services/webapi';

export const useAdvancedSettingsStore = defineStore('AdvancedSettings', () => {
    const gameStore = useGameStore();
    const vrcxStore = useVrcxStore();
    const VRCXUpdaterStore = useVRCXUpdaterStore();
    const modalStore = useModalStore();
    const updateLoopStore = useUpdateLoopStore();

    const { t } = useI18n();

    const state = reactive({
        folderSelectorDialogVisible: false
    });

    const enablePrimaryPassword = ref(false);
    const bioLanguage = ref('en');
    const relaunchVRChatAfterCrash = ref(false);
    const vrcQuitFix = ref(true);
    const autoSweepVRChatCache = ref(false);
    const selfInviteOverride = ref(false);
    const saveInstancePrints = ref(false);
    const cropInstancePrints = ref(false);
    const saveInstanceStickers = ref(false);
    const avatarRemoteDatabase = ref(true);
    const enableAppLauncher = ref(true);
    const enableAppLauncherAutoClose = ref(true);
    const enableAppLauncherRunProcessOnce = ref(true);
    const screenshotHelper = ref(true);
    const screenshotHelperModifyFilename = ref(false);
    const screenshotHelperCopyToClipboard = ref(false);
    const youTubeApi = ref(false);
    const youTubeApiKey = ref('');
    const translationApi = ref(false);
    const translationApiKey = ref('');
    const translationApiType = ref('google'); // 'google' | 'openai'
    const translationApiEndpoint = ref(
        'https://api.openai.com/v1/chat/completions'
    );
    const translationApiModel = ref('gpt-4o-mini');
    const translationApiPrompt = ref('');
    const progressPie = ref(false);
    const progressPieFilter = ref(true);
    const showConfirmationOnSwitchAvatar = ref(false);
    const gameLogDisabled = ref(false);
    const sqliteTableSizes = ref({});
    const avatarAutoCleanup = ref('Off');
    const purgeInProgress = ref(false);
    const ugcFolderPath = ref('');
    const autoDeleteOldPrints = ref(false);
    const notificationOpacity = ref(100);
    const currentUserInventory = reactive(new Map());
    const isVRChatConfigDialogVisible = ref(false);
    const saveInstanceEmoji = ref(false);
    const vrcRegistryAutoBackup = ref(true);
    const vrcRegistryAskRestore = ref(true);
    watch(
        () => watchState.isLoggedIn,
        () => {
            currentUserInventory.clear();
            isVRChatConfigDialogVisible.value = false;
        },
        { flush: 'sync' }
    );

    async function initAdvancedSettings() {
        const [
            enablePrimaryPasswordConfig,
            bioLanguageConfig,
            relaunchVRChatAfterCrashConfig,
            vrcQuitFixConfig,
            autoSweepVRChatCacheConfig,
            selfInviteOverrideConfig,
            saveInstancePrintsConfig,
            cropInstancePrintsConfig,
            saveInstanceStickersConfig,
            avatarRemoteDatabaseConfig,
            enableAppLauncherConfig,
            enableAppLauncherAutoCloseConfig,
            enableAppLauncherRunProcessOnceConfig,
            screenshotHelperConfig,
            screenshotHelperModifyFilenameConfig,
            screenshotHelperCopyToClipboardConfig,
            youTubeApiConfig,
            youTubeApiKeyConfig,
            translationApiConfig,
            translationApiKeyConfig,
            translationApiTypeConfig,
            translationApiEndpointConfig,
            translationApiModelConfig,
            translationApiPromptConfig,
            progressPieConfig,
            progressPieFilterConfig,
            showConfirmationOnSwitchAvatarConfig,
            gameLogDisabledConfig,
            avatarAutoCleanupConfig,
            ugcFolderPathConfig,
            autoDeleteOldPrintsConfig,
            notificationOpacityConfig,
            saveInstanceEmojiConfig,
            vrcRegistryAutoBackupConfig,
            vrcRegistryAskRestoreConfig
        ] = await Promise.all([
            configRepository.getBool('enablePrimaryPassword', false),
            configRepository.getString('bioLanguage'),
            configRepository.getBool('relaunchVRChatAfterCrash', false),
            configRepository.getBool('vrcQuitFix', true),
            configRepository.getBool('autoSweepVRChatCache', false),
            configRepository.getBool('selfInviteOverride', false),
            configRepository.getBool('saveInstancePrints', false),
            configRepository.getBool('cropInstancePrints', false),
            configRepository.getBool('saveInstanceStickers', false),
            configRepository.getBool('avatarRemoteDatabase', true),
            configRepository.getBool('enableAppLauncher', true),
            configRepository.getBool('enableAppLauncherAutoClose', true),
            configRepository.getBool(
                'VRCX-0_enableAppLauncherRunProcessOnce',
                true
            ),
            configRepository.getBool('screenshotHelper', true),
            configRepository.getBool(
                'VRCX-0_screenshotHelperModifyFilename',
                false
            ),
            configRepository.getBool(
                'VRCX-0_screenshotHelperCopyToClipboard',
                false
            ),
            configRepository.getBool('youtubeAPI', false),
            configRepository.getString('youtubeAPIKey', ''),
            configRepository.getBool('translationAPI', false),
            configRepository.getString('translationAPIKey', ''),
            configRepository.getString('translationAPIType', 'google'),
            configRepository.getString('translationAPIEndpoint', ''),
            configRepository.getString('translationAPIModel', ''),
            configRepository.getString('translationAPIPrompt', ''),
            configRepository.getBool('progressPie', false),
            configRepository.getBool('progressPieFilter', true),
            configRepository.getBool(
                'VRCX-0_showConfirmationOnSwitchAvatar',
                false
            ),
            configRepository.getBool('gameLogDisabled', false),
            configRepository.getString('avatarAutoCleanup', 'Off'),
            configRepository.getString('userGeneratedContentPath', ''),
            configRepository.getBool('autoDeleteOldPrints', false),
            configRepository.getFloat('notificationOpacity', 100),
            configRepository.getBool('saveInstanceEmoji', false),
            configRepository.getBool('vrcRegistryAutoBackup', true),
            configRepository.getBool('vrcRegistryAskRestore', true)
        ]);

        if (!bioLanguageConfig || !languageCodes.includes(bioLanguageConfig)) {
            bioLanguage.value = 'en';
        } else {
            bioLanguage.value = bioLanguageConfig;
        }

        enablePrimaryPassword.value = enablePrimaryPasswordConfig;
        relaunchVRChatAfterCrash.value = relaunchVRChatAfterCrashConfig;
        vrcQuitFix.value = vrcQuitFixConfig;
        autoSweepVRChatCache.value = autoSweepVRChatCacheConfig;
        selfInviteOverride.value = selfInviteOverrideConfig;
        saveInstancePrints.value = saveInstancePrintsConfig;
        cropInstancePrints.value = cropInstancePrintsConfig;
        saveInstanceStickers.value = saveInstanceStickersConfig;
        avatarRemoteDatabase.value = avatarRemoteDatabaseConfig;
        enableAppLauncher.value = enableAppLauncherConfig;
        enableAppLauncherAutoClose.value = enableAppLauncherAutoCloseConfig;
        enableAppLauncherRunProcessOnce.value =
            enableAppLauncherRunProcessOnceConfig;
        screenshotHelper.value = screenshotHelperConfig;
        screenshotHelperModifyFilename.value =
            screenshotHelperModifyFilenameConfig;
        screenshotHelperCopyToClipboard.value =
            screenshotHelperCopyToClipboardConfig;
        youTubeApi.value = youTubeApiConfig;
        youTubeApiKey.value = youTubeApiKeyConfig;
        translationApi.value = translationApiConfig;
        translationApiKey.value = translationApiKeyConfig;
        translationApiType.value = translationApiTypeConfig;
        translationApiEndpoint.value = translationApiEndpointConfig;
        translationApiModel.value = translationApiModelConfig;
        translationApiPrompt.value = translationApiPromptConfig;
        progressPie.value = progressPieConfig;
        progressPieFilter.value = progressPieFilterConfig;
        showConfirmationOnSwitchAvatar.value =
            showConfirmationOnSwitchAvatarConfig;
        gameLogDisabled.value = gameLogDisabledConfig;
        avatarAutoCleanup.value = avatarAutoCleanupConfig;
        ugcFolderPath.value = ugcFolderPathConfig;
        autoDeleteOldPrints.value = autoDeleteOldPrintsConfig;
        notificationOpacity.value = notificationOpacityConfig;
        saveInstanceEmoji.value = saveInstanceEmojiConfig;
        vrcRegistryAutoBackup.value = vrcRegistryAutoBackupConfig;
        vrcRegistryAskRestore.value = vrcRegistryAskRestoreConfig;

        handleSetAppLauncherSettings();
    }

    initAdvancedSettings();

    /**
     * @param {boolean} value
     */
    function setEnablePrimaryPasswordConfigRepository(value) {
        configRepository.setBool('enablePrimaryPassword', value);
    }

    /**
     * @param {boolean} value
     */
    function setEnablePrimaryPassword(value) {
        enablePrimaryPassword.value = value;
    }
    function setRelaunchVRChatAfterCrash() {
        relaunchVRChatAfterCrash.value = !relaunchVRChatAfterCrash.value;
        configRepository.setBool(
            'VRCX-0_relaunchVRChatAfterCrash',
            relaunchVRChatAfterCrash.value
        );
    }
    function setVrcQuitFix() {
        vrcQuitFix.value = !vrcQuitFix.value;
        configRepository.setBool('vrcQuitFix', vrcQuitFix.value);
    }
    function setAutoSweepVRChatCache() {
        autoSweepVRChatCache.value = !autoSweepVRChatCache.value;
        configRepository.setBool(
            'VRCX-0_autoSweepVRChatCache',
            autoSweepVRChatCache.value
        );
    }
    function setSelfInviteOverride() {
        selfInviteOverride.value = !selfInviteOverride.value;
        configRepository.setBool(
            'VRCX-0_selfInviteOverride',
            selfInviteOverride.value
        );
    }
    function setSaveInstancePrints() {
        saveInstancePrints.value = !saveInstancePrints.value;
        configRepository.setBool(
            'VRCX-0_saveInstancePrints',
            saveInstancePrints.value
        );
    }
    function setCropInstancePrints() {
        cropInstancePrints.value = !cropInstancePrints.value;
        configRepository.setBool(
            'VRCX-0_cropInstancePrints',
            cropInstancePrints.value
        );
        cropPrintsChanged();
    }
    function setSaveInstanceStickers() {
        saveInstanceStickers.value = !saveInstanceStickers.value;
        configRepository.setBool(
            'VRCX-0_saveInstanceStickers',
            saveInstanceStickers.value
        );
    }
    /**
     * @param {boolean} value
     */
    function setAvatarRemoteDatabase(value) {
        avatarRemoteDatabase.value = value;
        configRepository.setBool(
            'VRCX-0_avatarRemoteDatabase',
            avatarRemoteDatabase.value
        );
    }
    async function setEnableAppLauncher() {
        enableAppLauncher.value = !enableAppLauncher.value;
        await configRepository.setBool(
            'VRCX-0_enableAppLauncher',
            enableAppLauncher.value
        );
        handleSetAppLauncherSettings();
    }
    async function setEnableAppLauncherAutoClose() {
        enableAppLauncherAutoClose.value = !enableAppLauncherAutoClose.value;
        await configRepository.setBool(
            'VRCX-0_enableAppLauncherAutoClose',
            enableAppLauncherAutoClose.value
        );
        handleSetAppLauncherSettings();
    }
    async function setEnableAppLauncherRunProcessOnce() {
        enableAppLauncherRunProcessOnce.value =
            !enableAppLauncherRunProcessOnce.value;
        await configRepository.setBool(
            'VRCX-0_enableAppLauncherRunProcessOnce',
            enableAppLauncherRunProcessOnce.value
        );
        handleSetAppLauncherSettings();
    }
    async function setScreenshotHelper() {
        screenshotHelper.value = !screenshotHelper.value;
        await configRepository.setBool(
            'VRCX-0_screenshotHelper',
            screenshotHelper.value
        );
    }
    async function setScreenshotHelperModifyFilename() {
        screenshotHelperModifyFilename.value =
            !screenshotHelperModifyFilename.value;
        await configRepository.setBool(
            'VRCX-0_screenshotHelperModifyFilename',
            screenshotHelperModifyFilename.value
        );
    }
    async function setScreenshotHelperCopyToClipboard() {
        screenshotHelperCopyToClipboard.value =
            !screenshotHelperCopyToClipboard.value;
        await configRepository.setBool(
            'VRCX-0_screenshotHelperCopyToClipboard',
            screenshotHelperCopyToClipboard.value
        );
    }
    async function setYouTubeApi() {
        youTubeApi.value = !youTubeApi.value;
        await configRepository.setBool('youtubeAPI', youTubeApi.value);
    }
    async function setTranslationApi() {
        translationApi.value = !translationApi.value;
        await configRepository.setBool(
            'VRCX-0_translationAPI',
            translationApi.value
        );
    }
    /**
     * @param {string} value
     */
    async function setYouTubeApiKey(value) {
        youTubeApiKey.value = value;
        await configRepository.setString(
            'VRCX-0_youtubeAPIKey',
            youTubeApiKey.value
        );
    }
    async function setTranslationApiKey(value) {
        translationApiKey.value = value;
        await configRepository.setString(
            'VRCX-0_translationAPIKey',
            translationApiKey.value
        );
    }
    async function setTranslationApiType(value) {
        translationApiType.value = value || 'google';
        await configRepository.setString(
            'VRCX-0_translationAPIType',
            translationApiType.value
        );
    }
    async function setTranslationApiEndpoint(value) {
        translationApiEndpoint.value = value;
        await configRepository.setString(
            'VRCX-0_translationAPIEndpoint',
            translationApiEndpoint.value
        );
    }
    async function setTranslationApiModel(value) {
        translationApiModel.value = value;
        await configRepository.setString(
            'VRCX-0_translationAPIModel',
            translationApiModel.value
        );
    }
    async function setTranslationApiPrompt(value) {
        translationApiPrompt.value = value;
        await configRepository.setString(
            'VRCX-0_translationAPIPrompt',
            translationApiPrompt.value
        );
    }

    async function fetchAvailableModels(overrides = {}) {
        const baseURL = overrides.endpoint || translationApiEndpoint.value;

        if (!baseURL) {
            toast.warning('Translation endpoint not configured');
            return [];
        }

        let modelsURL = '';
        try {
            const url = new URL(baseURL);
            const basePath = url.pathname.replace(/\/+$/, '');

            if (basePath.endsWith('/chat/completions')) {
                url.pathname = basePath.replace(
                    /\/chat\/completions$/,
                    '/models'
                );
            } else if (basePath.endsWith('/models')) {
                url.pathname = basePath;
            } else {
                url.pathname = `${basePath}/models`;
            }

            url.search = '';
            url.hash = '';
            modelsURL = url.toString();
        } catch {
            const normalizedBaseURL = baseURL.endsWith('/')
                ? baseURL.slice(0, -1)
                : baseURL;

            if (normalizedBaseURL.includes('/chat/completions')) {
                modelsURL = normalizedBaseURL.replace(
                    /\/chat\/completions$/,
                    '/models'
                );
            } else if (normalizedBaseURL.endsWith('/models')) {
                modelsURL = normalizedBaseURL;
            } else {
                modelsURL = `${normalizedBaseURL}/models`;
            }
        }

        const headers = {};
        const keyToUse = overrides.key ?? translationApiKey.value;
        if (keyToUse) {
            headers.Authorization = `Bearer ${keyToUse}`;
        }

        try {
            const response = await webApiService.execute({
                url: modelsURL,
                method: 'GET',
                headers
            });

            if (response.status !== 200) {
                throw new Error(
                    `Failed to fetch models: ${response.status} - ${response.data}`
                );
            }

            const data = JSON.parse(response.data);
            logWebRequest(
                '[EXTERNAL GET]',
                modelsURL,
                `(${response.status})`,
                data
            );

            if (data.data && Array.isArray(data.data)) {
                return data.data
                    .map((model) => model.id)
                    .filter((id) => id && typeof id === 'string')
                    .sort();
            }

            if (Array.isArray(data)) {
                return data
                    .map((model) => model.id || model.name)
                    .filter((id) => id && typeof id === 'string')
                    .sort();
            }

            throw new Error('Unexpected API response format');
        } catch (error) {
            console.error('Failed to fetch models:', error);
            toast.error(`Failed to fetch models: ${error.message}`);
            return [];
        }
    }

    function setBioLanguage(language) {
        bioLanguage.value = language;
        configRepository.setString('bioLanguage', language);
    }
    async function setProgressPie() {
        progressPie.value = !progressPie.value;
        await configRepository.setBool('progressPie', progressPie.value);
    }
    async function setProgressPieFilter() {
        progressPieFilter.value = !progressPieFilter.value;
        await configRepository.setBool(
            'VRCX-0_progressPieFilter',
            progressPieFilter.value
        );
    }
    async function setShowConfirmationOnSwitchAvatar() {
        showConfirmationOnSwitchAvatar.value =
            !showConfirmationOnSwitchAvatar.value;
        await configRepository.setBool(
            'VRCX-0_showConfirmationOnSwitchAvatar',
            showConfirmationOnSwitchAvatar.value
        );
    }
    async function setGameLogDisabled() {
        gameLogDisabled.value = !gameLogDisabled.value;
        await configRepository.setBool(
            'VRCX-0_gameLogDisabled',
            gameLogDisabled.value
        );
    }

    async function setAvatarAutoCleanup(value) {
        avatarAutoCleanup.value = value;
        await configRepository.setString('avatarAutoCleanup', value);
    }

    /**
     * @param {number|null} days - Number of days to keep. Null means delete all.
     */
    async function purgeAvatarFeedData(days) {
        let cutoffDate = null;
        if (days !== null) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            cutoffDate = cutoff.toJSON();
        }
    
        purgeInProgress.value = true;
        const msgBox = toast.warning(
            t(
                'view.settings.advanced.advanced.database_cleanup.purge_in_progress'
            ),
            { duration: Infinity }
        );
    
        try {
            await database.purgeAvatarFeedData(cutoffDate);
            await database.vacuum();
            toast.dismiss(msgBox);
            toast.success(
                t(
                    'view.settings.advanced.advanced.database_cleanup.purge_complete'
                )
            );
            // Brief delay before restart to show success message
            await new Promise((resolve) =>
                setTimeout(resolve, 1500)
            );
            VRCXUpdaterStore.restartVRCX(false);
        } catch (err) {
            console.error(err);
            toast.dismiss(msgBox);
            toast.error(t('view.settings.advanced.advanced.database_cleanup.purge_failed', { error: err }));
        } finally {
            purgeInProgress.value = false;
        }
    }

    /**
     * Run auto-cleanup on startup if configured and enough time has passed.
     * Reads config directly from configRepository to avoid race condition
     * with initAdvancedSettings not having completed yet.
     * @param {string} userId - Current user ID for per-user cleanup tracking.
     */
    async function runAvatarAutoCleanup(userId) {
        const cleanupSetting = await configRepository.getString(
            'VRCX-0_avatarAutoCleanup',
            'Off'
        );
        if (cleanupSetting === 'Off') return;
    
        const configKey = `lastAvatarCleanupDate_${userId}`;
        const lastCleanupStr = await configRepository.getString(
            configKey,
            ''
        );
        const now = new Date();
    
        if (lastCleanupStr) {
            const lastCleanup = new Date(lastCleanupStr);
            const daysSinceLastCleanup =
                (now - lastCleanup) / (1000 * 60 * 60 * 24);
            if (daysSinceLastCleanup < 7) return;
        }
    
        const days = parseInt(cleanupSetting, 10);
        if (isNaN(days) || days <= 0) return;
    
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffDate = cutoff.toJSON();
    
        try {
            await database.purgeAvatarFeedData(cutoffDate);
            await configRepository.setString(
                configKey,
                now.toJSON()
            );
            console.log(
                `Auto-cleaned avatar feed data older than ${days} days`
            );
        } catch (err) {
            console.error('Avatar auto-cleanup failed:', err);
        }
    }

    async function setSaveInstanceEmoji() {
        saveInstanceEmoji.value = !saveInstanceEmoji.value;
        await configRepository.setBool(
            'VRCX-0_saveInstanceEmoji',
            saveInstanceEmoji.value
        );
    }

    async function setUGCFolderPath(path) {
        if (typeof path !== 'string') {
            path = '';
        }
        ugcFolderPath.value = path;
        await configRepository.setString('userGeneratedContentPath', path);
    }

    async function setAutoDeleteOldPrints() {
        autoDeleteOldPrints.value = !autoDeleteOldPrints.value;
        await configRepository.setBool(
            'VRCX-0_autoDeleteOldPrints',
            autoDeleteOldPrints.value
        );
    }

    async function setNotificationOpacity(value) {
        notificationOpacity.value = value;
        await configRepository.setInt('notificationOpacity', value);
    }

    async function setVrcRegistryAutoBackup() {
        vrcRegistryAutoBackup.value = !vrcRegistryAutoBackup.value;
        await configRepository.setBool(
            'VRCX-0_vrcRegistryAutoBackup',
            vrcRegistryAutoBackup.value
        );
    }

    async function setVrcRegistryAskRestore() {
        vrcRegistryAskRestore.value = !vrcRegistryAskRestore.value;
        await configRepository.setBool(
            'VRCX-0_vrcRegistryAskRestore',
            vrcRegistryAskRestore.value
        );
    }

    async function getSqliteTableSizes() {
        const [
            gps,
            status,
            bio,
            avatar,
            onlineOffline,
            friendLogHistory,
            notification,
            location,
            joinLeave,
            portalSpawn,
            videoPlay,
            event,
            external
        ] = await Promise.all([
            database.getGpsTableSize(),
            database.getStatusTableSize(),
            database.getBioTableSize(),
            database.getAvatarTableSize(),
            database.getOnlineOfflineTableSize(),
            database.getFriendLogHistoryTableSize(),
            database.getNotificationTableSize(),
            database.getLocationTableSize(),
            database.getJoinLeaveTableSize(),
            database.getPortalSpawnTableSize(),
            database.getVideoPlayTableSize(),
            database.getEventTableSize(),
            database.getExternalTableSize()
        ]);

        sqliteTableSizes.value = {
            gps,
            status,
            bio,
            avatar,
            onlineOffline,
            friendLogHistory,
            notification,
            location,
            joinLeave,
            portalSpawn,
            videoPlay,
            event,
            external
        };
    }

    function handleSetAppLauncherSettings() {
        invoke('app__set_app_launcher_settings', {
            enabled: enableAppLauncher.value,
            killOnExit: enableAppLauncherAutoClose.value,
            runProcessOnce: enableAppLauncherRunProcessOnce.value
        });
    }

    /**
     * @param {string} videoId
     */
    async function lookupYouTubeVideo(videoId) {
        if (!youTubeApiKey.value) {
            console.warn('no Youtube API key configured');
            return null;
        }
        let data = null;
        let apiKey = '';
        if (youTubeApiKey.value) {
            apiKey = youTubeApiKey.value;
        }
        try {
            const url = `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(
                videoId
            )}&part=snippet,contentDetails&key=${apiKey}`;
            const response = await webApiService.execute({
                url,
                method: 'GET',
                headers: {
                    Referer: 'https://vrcx.app'
                }
            });
            const json = JSON.parse(response.data);
            logWebRequest('[EXTERNAL GET]', url, `(${response.status})`, json);
            if (response.status === 200) {
                data = json;
            } else {
                throw new Error(`Error: ${response.data}`);
            }
        } catch {
            console.error(`YouTube video lookup failed for ${videoId}`);
        }
        return data;
    }

    async function translateText(text, targetLang, overrides) {
        if (!translationApi.value) {
            toast.warning('Translation API disabled');
            return null;
        }

        const provider =
            overrides?.type || translationApiType.value || 'google';

        if (provider === 'google') {
            const keyToUse = overrides?.key ?? translationApiKey.value;
            if (!keyToUse) {
                toast.warning('No Translation API key configured');
                return null;
            }
            try {
                const url = `https://translation.googleapis.com/language/translate/v2?key=${keyToUse}`;
                const response = await webApiService.execute({
                    url,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Referer: 'https://vrcx.app'
                    },
                    body: JSON.stringify({
                        q: text,
                        target: targetLang,
                        format: 'text'
                    })
                });
                if (response.status !== 200) {
                    throw new Error(
                        `Translation API error: ${response.status} - ${response.data}`
                    );
                }
                const data = JSON.parse(response.data);
                logWebRequest(
                    '[EXTERNAL POST]',
                    url,
                    `(${response.status})`,
                    data
                );
                return data.data.translations[0].translatedText;
            } catch (err) {
                toast.error(`Translation failed: ${err.message}`);
                return null;
            }
        }

        const endpoint =
            overrides?.endpoint ||
            translationApiEndpoint.value ||
            'https://api.openai.com/v1/chat/completions';
        const model =
            overrides?.model || translationApiModel.value || 'gpt-5.1';
        const prompt =
            overrides?.prompt ||
            translationApiPrompt.value ||
            `You are a translation assistant. Translate the user message into ${targetLang}. Only return the translated text.`;

        if (!endpoint || !model) {
            toast.warning('Translation endpoint/model missing');
            return null;
        }

        const headers = {
            'Content-Type': 'application/json',
            Referer: 'https://vrcx.app',
            'HTTP-Referer': 'https://vrcx.app',
            'X-Title': 'VRCX'
        };
        const keyToUse = overrides?.key ?? translationApiKey.value;
        if (keyToUse) {
            headers.Authorization = `Bearer ${keyToUse}`;
        }

        try {
            const response = await webApiService.execute({
                url: endpoint,
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: 'system',
                            content: prompt
                        },
                        {
                            role: 'user',
                            content: text
                        }
                    ]
                })
            });

            if (response.status !== 200) {
                throw new Error(
                    `Translation API error: ${response.status} - ${response.data}`
                );
            }

            const data = JSON.parse(response.data);
            logWebRequest(
                '[EXTERNAL POST]',
                endpoint,
                `(${response.status})`,
                data
            );

            const translated = data?.choices?.[0]?.message?.content;
            return typeof translated === 'string' ? translated.trim() : null;
        } catch (err) {
            toast.error(`Translation failed`);
            return null;
        }
    }

    function cropPrintsChanged() {
        if (!cropInstancePrints.value) return;
        modalStore
            .confirm({
                description: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old'
                ),
                title: '',
                confirmText: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old_confirm'
                ),
                cancelText: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old_cancel'
                )
            })
            .then(async ({ ok }) => {
                if (!ok) return;
                const msgBox = toast.warning(
                    'Batch print cropping in progress...',
                    { duration: Infinity, position: 'bottom-right' }
                );
                try {
                    await invoke('app__crop_all_prints', {
                        ugcFolderPath: ugcFolderPath.value
                    });
                    toast.success('Batch print cropping complete');
                } catch (err) {
                    console.error(err);
                    toast.error(`Batch print cropping failed: ${err}`);
                } finally {
                    toast.dismiss(msgBox);
                }
            })
            .catch(() => {});
    }

    function askDeleteAllScreenshotMetadata() {
        modalStore
            .confirm({
                description: t(
                    'view.settings.advanced.advanced.delete_all_screenshot_metadata.ask'
                ),
                title: '',
                confirmText: t(
                    'view.settings.advanced.advanced.delete_all_screenshot_metadata.confirm_yes'
                ),
                cancelText: t(
                    'view.settings.advanced.advanced.delete_all_screenshot_metadata.confirm_no'
                )
            })
            .then(({ ok }) => {
                if (!ok) return;
                deleteAllScreenshotMetadata();
            })
            .catch(() => {});
    }

    function deleteAllScreenshotMetadata() {
        modalStore
            .confirm({
                description: t(
                    'view.settings.advanced.advanced.delete_all_screenshot_metadata.confirm'
                ),
                title: '',
                confirmText: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old_confirm'
                ),
                cancelText: t(
                    'view.settings.advanced.advanced.save_instance_prints_to_file.crop_convert_old_cancel'
                )
            })
            .then(async ({ ok }) => {
                if (!ok) return;
                const msgBox = toast.warning(
                    'Batch metadata removal in progress...',
                    { duration: Infinity, position: 'bottom-right' }
                );
                try {
                    await invoke('app__delete_all_screenshot_metadata');
                    toast.success('Batch metadata removal complete');
                } catch (err) {
                    console.error(err);
                    toast.error(`Batch metadata removal failed: ${err}`);
                } finally {
                    toast.dismiss(msgBox);
                }
            })
            .catch(() => {});
    }

    function resetUGCFolder() {
        setUGCFolderPath('');
    }

    async function openUGCFolder() {
        await invoke('app__open_ugc_photos_folder', {
            ugcPath: ugcFolderPath.value
        });
    }

    async function folderSelectorDialog(oldPath) {
        if (state.folderSelectorDialogVisible) return;
        if (!oldPath) {
            oldPath = '';
        }

        state.folderSelectorDialogVisible = true;
        const newFolder = await invoke('app__open_folder_selector_dialog', {
            defaultPath: oldPath
        });

        state.folderSelectorDialogVisible = false;
        return newFolder;
    }

    async function openUGCFolderSelector() {
        const path = await folderSelectorDialog(ugcFolderPath.value);
        await setUGCFolderPath(path);
    }

    async function showVRChatConfig() {
        isVRChatConfigDialogVisible.value = true;
        if (!gameStore.VRChatUsedCacheSize) {
            gameStore.getVRChatCacheSize();
        }
    }

    function promptAutoClearVRCXCacheFrequency() {
        modalStore
            .prompt({
                title: t('prompt.auto_clear_cache.header'),
                description: t('prompt.auto_clear_cache.description'),
                confirmText: t('prompt.auto_clear_cache.ok'),
                cancelText: t('prompt.auto_clear_cache.cancel'),
                inputValue: (
                    vrcxStore.clearVRCXCacheFrequency /
                    3600 /
                    2
                ).toString(),
                pattern: /\d+$/,
                errorMessage: t('prompt.auto_clear_cache.input_error')
            })
            .then(async ({ ok, value }) => {
                if (!ok) return;
                if (value && !isNaN(parseInt(value, 10))) {
                    vrcxStore.setClearVRCXCacheFrequency(
                        parseInt(value, 10) * 3600 * 2
                    );
                    updateLoopStore.setNextClearVRCXCacheCheck(
                        vrcxStore.clearVRCXCacheFrequency / 2
                    );
                    await configRepository.setString(
                        'VRCX-0_clearVRCXCacheFrequency',
                        vrcxStore.clearVRCXCacheFrequency.toString()
                    );
                }
            })
            .catch(() => {});
    }

    return {
        state,

        bioLanguage,
        enablePrimaryPassword,
        relaunchVRChatAfterCrash,
        vrcQuitFix,
        autoSweepVRChatCache,
        selfInviteOverride,
        saveInstancePrints,
        cropInstancePrints,
        saveInstanceStickers,
        avatarRemoteDatabase,
        enableAppLauncher,
        enableAppLauncherAutoClose,
        enableAppLauncherRunProcessOnce,
        screenshotHelper,
        screenshotHelperModifyFilename,
        screenshotHelperCopyToClipboard,
        youTubeApi,
        translationApi,
        youTubeApiKey,
        translationApiKey,
        translationApiType,
        translationApiEndpoint,
        translationApiModel,
        translationApiPrompt,
        progressPie,
        progressPieFilter,
        showConfirmationOnSwitchAvatar,
        gameLogDisabled,
        sqliteTableSizes,
        avatarAutoCleanup,
        purgeInProgress,
        ugcFolderPath,
        currentUserInventory,
        autoDeleteOldPrints,
        notificationOpacity,
        isVRChatConfigDialogVisible,
        saveInstanceEmoji,
        vrcRegistryAutoBackup,
        vrcRegistryAskRestore,

        setEnablePrimaryPassword,
        setEnablePrimaryPasswordConfigRepository,
        setBioLanguage,
        setRelaunchVRChatAfterCrash,
        setVrcQuitFix,
        setAutoSweepVRChatCache,
        setSelfInviteOverride,
        setSaveInstancePrints,
        setCropInstancePrints,
        setSaveInstanceStickers,
        setAvatarRemoteDatabase,
        setEnableAppLauncher,
        setEnableAppLauncherAutoClose,
        setEnableAppLauncherRunProcessOnce,
        setScreenshotHelper,
        setScreenshotHelperModifyFilename,
        setScreenshotHelperCopyToClipboard,
        setYouTubeApi,
        setTranslationApi,
        setYouTubeApiKey,
        setTranslationApiKey,
        setTranslationApiType,
        setTranslationApiEndpoint,
        setTranslationApiModel,
        setTranslationApiPrompt,
        setProgressPie,
        setProgressPieFilter,
        setShowConfirmationOnSwitchAvatar,
        setGameLogDisabled,
        setAvatarAutoCleanup,
        purgeAvatarFeedData,
        runAvatarAutoCleanup,
        setUGCFolderPath,
        cropPrintsChanged,
        setAutoDeleteOldPrints,
        setNotificationOpacity,
        getSqliteTableSizes,
        handleSetAppLauncherSettings,
        lookupYouTubeVideo,
        translateText,
        fetchAvailableModels,
        resetUGCFolder,
        openUGCFolder,
        openUGCFolderSelector,
        folderSelectorDialog,
        showVRChatConfig,
        promptAutoClearVRCXCacheFrequency,
        setSaveInstanceEmoji,
        setVrcRegistryAutoBackup,
        setVrcRegistryAskRestore,
        askDeleteAllScreenshotMetadata
    };
});
