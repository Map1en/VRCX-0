import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useFriendStore } from '../friend';
import { useModalStore } from '../modal';
import { useVRCXUpdaterStore } from '../vrcxUpdater';
import { useVrcxStore } from '../vrcx';

import configRepository from '../../services/config';

export const useGeneralSettingsStore = defineStore('GeneralSettings', () => {
    const vrcxStore = useVrcxStore();
    const VRCXUpdaterStore = useVRCXUpdaterStore();
    const friendStore = useFriendStore();
    const modalStore = useModalStore();

    const { t } = useI18n();

    const isStartAtWindowsStartup = ref(false);
    const isStartAsMinimizedState = ref(false);
    const disableGpuAcceleration = ref(false);
    const isCloseToTray = ref(false);
    const localFavoriteFriendsGroups = ref([]);
    const udonExceptionLogging = ref(false);
    const logResourceLoad = ref(false);
    const logEmptyAvatars = ref(false);
    const autoLoginDelayEnabled = ref(false);
    const autoLoginDelaySeconds = ref(0);
    const autoStateChangeEnabled = ref(false);
    const autoStateChangeAloneStatus = ref('join me');
    const autoStateChangeCompanyStatus = ref('busy');
    const autoStateChangeInstanceTypes = ref([]);
    const autoStateChangeNoFriends = ref(false);
    const autoStateChangeAloneDescEnabled = ref(false);
    const autoStateChangeAloneDesc = ref('');
    const autoStateChangeCompanyDescEnabled = ref(false);
    const autoStateChangeCompanyDesc = ref('');
    const autoStateChangeGroups = ref([]);
    const autoAcceptInviteRequests = ref('Off');
    const autoAcceptInviteGroups = ref([]);
    const recentActionCooldownEnabled = ref(false);
    const recentActionCooldownMinutes = ref(60);

    async function initGeneralSettings() {
        const [
            isStartAtWindowsStartupConfig,
            isStartAsMinimizedStateConfig,
            isCloseToTrayConfig,
            isCloseToTrayConfigBoolConfig,
            disableGpuAccelerationStrConfig,
            localFavoriteFriendsGroupsStrConfig,
            udonExceptionLoggingConfig,
            logResourceLoadConfig,
            logEmptyAvatarsConfig,
            autoLoginDelayEnabledConfig,
            autoLoginDelaySecondsConfig,
            autoStateChangeEnabledConfig,
            autoStateChangeAloneStatusConfig,
            autoStateChangeCompanyStatusConfig,
            autoStateChangeInstanceTypesStrConfig,
            autoStateChangeNoFriendsConfig,
            autoStateChangeAloneDescEnabledConfig,
            autoStateChangeAloneDescConfig,
            autoStateChangeCompanyDescEnabledConfig,
            autoStateChangeCompanyDescConfig,
            autoStateChangeGroupsStrConfig,
            autoAcceptInviteRequestsConfig,
            autoAcceptInviteGroupsStrConfig,
            recentActionCooldownEnabledConfig,
            recentActionCooldownMinutesConfig
        ] = await Promise.all([
            configRepository.getBool('StartAtWindowsStartup', false),
            VRCXStorage.Get('VRCX-0_StartAsMinimizedState'),
            VRCXStorage.Get('VRCX-0_CloseToTray'),
            configRepository.getBool('CloseToTray'),
            VRCXStorage.Get('VRCX-0_DisableGpuAcceleration'),
            configRepository.getString('localFavoriteFriendsGroups', '[]'),
            configRepository.getBool('udonExceptionLogging', false),
            configRepository.getBool('logResourceLoad', false),
            configRepository.getBool('logEmptyAvatars', false),
            configRepository.getBool('autoLoginDelayEnabled', false),
            configRepository.getInt('autoLoginDelaySeconds', 0),
            configRepository.getBool('autoStateChangeEnabled', false),
            configRepository.getString(
                'VRCX-0_autoStateChangeAloneStatus',
                'join me'
            ),
            configRepository.getString(
                'VRCX-0_autoStateChangeCompanyStatus',
                'busy'
            ),
            configRepository.getString(
                'VRCX-0_autoStateChangeInstanceTypes',
                '[]'
            ),
            configRepository.getBool('autoStateChangeNoFriends', false),
            configRepository.getBool(
                'VRCX-0_autoStateChangeAloneDescEnabled',
                false
            ),
            configRepository.getString('autoStateChangeAloneDesc', ''),
            configRepository.getBool(
                'VRCX-0_autoStateChangeCompanyDescEnabled',
                false
            ),
            configRepository.getString('autoStateChangeCompanyDesc', ''),
            configRepository.getString('autoStateChangeGroups', '[]'),
            configRepository.getString('autoAcceptInviteRequests', 'Off'),
            configRepository.getString('autoAcceptInviteGroups', '[]'),
            configRepository.getBool('recentActionCooldownEnabled', false),
            configRepository.getInt('recentActionCooldownMinutes', 60)
        ]);

        isStartAtWindowsStartup.value = isStartAtWindowsStartupConfig;
        isStartAsMinimizedState.value =
            isStartAsMinimizedStateConfig === 'true';

        if (isCloseToTrayConfigBoolConfig) {
            isCloseToTray.value = isCloseToTrayConfigBoolConfig;

            await VRCXStorage.Set(
                'VRCX-0_CloseToTray',
                isCloseToTray.value.toString()
            );
            await configRepository.remove('CloseToTray');
        } else {
            isCloseToTray.value = isCloseToTrayConfig === 'true';
        }

        disableGpuAcceleration.value =
            disableGpuAccelerationStrConfig === 'true';
        localFavoriteFriendsGroups.value = JSON.parse(
            localFavoriteFriendsGroupsStrConfig
        );
        udonExceptionLogging.value = udonExceptionLoggingConfig;
        logResourceLoad.value = logResourceLoadConfig;
        logEmptyAvatars.value = logEmptyAvatarsConfig;
        autoLoginDelayEnabled.value = autoLoginDelayEnabledConfig;
        autoLoginDelaySeconds.value = autoLoginDelaySecondsConfig;
        autoStateChangeEnabled.value = autoStateChangeEnabledConfig;
        autoStateChangeAloneStatus.value = autoStateChangeAloneStatusConfig;
        autoStateChangeCompanyStatus.value = autoStateChangeCompanyStatusConfig;
        autoStateChangeInstanceTypes.value = JSON.parse(
            autoStateChangeInstanceTypesStrConfig
        );
        autoStateChangeNoFriends.value = autoStateChangeNoFriendsConfig;
        autoStateChangeAloneDescEnabled.value =
            autoStateChangeAloneDescEnabledConfig;
        autoStateChangeAloneDesc.value = autoStateChangeAloneDescConfig;
        autoStateChangeCompanyDescEnabled.value =
            autoStateChangeCompanyDescEnabledConfig;
        autoStateChangeCompanyDesc.value = autoStateChangeCompanyDescConfig;
        autoStateChangeGroups.value = JSON.parse(
            autoStateChangeGroupsStrConfig
        );
        autoAcceptInviteRequests.value = autoAcceptInviteRequestsConfig;
        autoAcceptInviteGroups.value = JSON.parse(
            autoAcceptInviteGroupsStrConfig
        );
        recentActionCooldownEnabled.value = recentActionCooldownEnabledConfig;
        recentActionCooldownMinutes.value = recentActionCooldownMinutesConfig;
    }

    initGeneralSettings();

    function setIsStartAtWindowsStartup() {
        isStartAtWindowsStartup.value = !isStartAtWindowsStartup.value;
        configRepository.setBool(
            'VRCX-0_StartAtWindowsStartup',
            isStartAtWindowsStartup.value
        );
        AppApi.SetStartup(isStartAtWindowsStartup.value);
    }
    function setIsStartAsMinimizedState() {
        isStartAsMinimizedState.value = !isStartAsMinimizedState.value;
        VRCXStorage.Set(
            'VRCX-0_StartAsMinimizedState',
            isStartAsMinimizedState.value.toString()
        );
    }
    function setIsCloseToTray() {
        isCloseToTray.value = !isCloseToTray.value;
        VRCXStorage.Set('VRCX-0_CloseToTray', isCloseToTray.value.toString());
    }
    function setDisableGpuAcceleration() {
        disableGpuAcceleration.value = !disableGpuAcceleration.value;
        VRCXStorage.Set(
            'VRCX-0_DisableGpuAcceleration',
            disableGpuAcceleration.value.toString()
        );
    }
    /**
     * @param {string[]} value
     */
    function setLocalFavoriteFriendsGroups(value) {
        localFavoriteFriendsGroups.value = value;
        configRepository.setString(
            'VRCX-0_localFavoriteFriendsGroups',
            JSON.stringify(value)
        );
        friendStore.updateLocalFavoriteFriends();
    }
    function setUdonExceptionLogging() {
        udonExceptionLogging.value = !udonExceptionLogging.value;
        configRepository.setBool(
            'VRCX-0_udonExceptionLogging',
            udonExceptionLogging.value
        );
    }
    function setLogResourceLoad() {
        logResourceLoad.value = !logResourceLoad.value;
        configRepository.setBool('logResourceLoad', logResourceLoad.value);
    }
    function setLogEmptyAvatars() {
        logEmptyAvatars.value = !logEmptyAvatars.value;
        configRepository.setBool('logEmptyAvatars', logEmptyAvatars.value);
    }
    function setAutoLoginDelayEnabled() {
        autoLoginDelayEnabled.value = !autoLoginDelayEnabled.value;
        configRepository.setBool(
            'VRCX-0_autoLoginDelayEnabled',
            autoLoginDelayEnabled.value
        );
    }
    function setAutoLoginDelaySeconds(value) {
        const parsed = parseInt(value, 10);
        autoLoginDelaySeconds.value = Number.isNaN(parsed)
            ? 0
            : Math.min(10, Math.max(0, parsed));
        configRepository.setInt(
            'VRCX-0_autoLoginDelaySeconds',
            autoLoginDelaySeconds.value
        );
    }
    function promptAutoLoginDelaySeconds() {
        modalStore
            .prompt({
                title: t('prompt.auto_login_delay.header'),
                description: t('prompt.auto_login_delay.description'),
                inputValue: String(autoLoginDelaySeconds.value),
                pattern: /^(10|[0-9])$/,
                errorMessage: t('prompt.auto_login_delay.input_error')
            })
            .then(({ ok, value }) => {
                if (!ok) return;
                setAutoLoginDelaySeconds(value);
            })
            .catch((err) => {
                console.error(err);
            });
    }
    function setAutoStateChangeEnabled() {
        autoStateChangeEnabled.value = !autoStateChangeEnabled.value;
        configRepository.setBool(
            'VRCX-0_autoStateChangeEnabled',
            autoStateChangeEnabled.value
        );
    }
    /**
     * @param {string} value
     */
    function setAutoStateChangeAloneStatus(value) {
        autoStateChangeAloneStatus.value = value;
        configRepository.setString(
            'VRCX-0_autoStateChangeAloneStatus',
            autoStateChangeAloneStatus.value
        );
    }
    /**
     * @param {string} value
     */
    function setAutoStateChangeCompanyStatus(value) {
        autoStateChangeCompanyStatus.value = value;
        configRepository.setString(
            'VRCX-0_autoStateChangeCompanyStatus',
            autoStateChangeCompanyStatus.value
        );
    }
    function setAutoStateChangeInstanceTypes(value) {
        autoStateChangeInstanceTypes.value = value;
        configRepository.setString(
            'VRCX-0_autoStateChangeInstanceTypes',
            JSON.stringify(autoStateChangeInstanceTypes.value)
        );
    }
    function setAutoStateChangeNoFriends() {
        autoStateChangeNoFriends.value = !autoStateChangeNoFriends.value;
        configRepository.setBool(
            'VRCX-0_autoStateChangeNoFriends',
            autoStateChangeNoFriends.value
        );
    }
    function setAutoStateChangeAloneDescEnabled() {
        autoStateChangeAloneDescEnabled.value =
            !autoStateChangeAloneDescEnabled.value;
        configRepository.setBool(
            'VRCX-0_autoStateChangeAloneDescEnabled',
            autoStateChangeAloneDescEnabled.value
        );
    }
    /**
     * @param {string} value
     */
    function setAutoStateChangeAloneDesc(value) {
        autoStateChangeAloneDesc.value = value;
        configRepository.setString(
            'VRCX-0_autoStateChangeAloneDesc',
            autoStateChangeAloneDesc.value
        );
    }
    function setAutoStateChangeCompanyDescEnabled() {
        autoStateChangeCompanyDescEnabled.value =
            !autoStateChangeCompanyDescEnabled.value;
        configRepository.setBool(
            'VRCX-0_autoStateChangeCompanyDescEnabled',
            autoStateChangeCompanyDescEnabled.value
        );
    }
    /**
     * @param {string} value
     */
    function setAutoStateChangeCompanyDesc(value) {
        autoStateChangeCompanyDesc.value = value;
        configRepository.setString(
            'VRCX-0_autoStateChangeCompanyDesc',
            autoStateChangeCompanyDesc.value
        );
    }
    /**
     * @param {Array} value
     */
    function setAutoStateChangeGroups(value) {
        autoStateChangeGroups.value = value;
        configRepository.setString(
            'VRCX-0_autoStateChangeGroups',
            JSON.stringify(autoStateChangeGroups.value)
        );
    }

    /**
     * @param {string} value
     */
    function setAutoAcceptInviteRequests(value) {
        autoAcceptInviteRequests.value = value;
        configRepository.setString(
            'VRCX-0_autoAcceptInviteRequests',
            autoAcceptInviteRequests.value
        );
    }

    /**
     * @param {string[]} value
     */
    function setAutoAcceptInviteGroups(value) {
        autoAcceptInviteGroups.value = value;
        configRepository.setString(
            'VRCX-0_autoAcceptInviteGroups',
            JSON.stringify(autoAcceptInviteGroups.value)
        );
    }

    function promptProxySettings() {
        // Element Plus: prompt(message, title, options)
        modalStore
            .prompt({
                title: t('prompt.proxy_settings.header'),
                description: t('prompt.proxy_settings.description'),
                confirmText: t('prompt.proxy_settings.restart'),
                cancelText: t('prompt.proxy_settings.close'),
                inputValue: vrcxStore.proxyServer
            })
            .then(async ({ ok, value }) => {
                if (ok) {
                    vrcxStore.setProxyServer(value);
                    await persistProxyServer();
                    const { restartVRCX } = VRCXUpdaterStore;
                    const isUpgrade = false;
                    restartVRCX(isUpgrade);
                    return;
                }

                // User clicked close/cancel, still save the value but don't restart
                if (vrcxStore.proxyServer !== undefined) {
                    await persistProxyServer();
                }
            })
            .catch((err) => {
                console.error(err);
            });
    }

    async function persistProxyServer() {
        await VRCXStorage.Set('VRCX-0_ProxyServer', vrcxStore.proxyServer);
        await VRCXStorage.Flush();
    }

    function setRecentActionCooldownEnabled() {
        recentActionCooldownEnabled.value =
            !recentActionCooldownEnabled.value;
        configRepository.setBool(
            'VRCX-0_recentActionCooldownEnabled',
            recentActionCooldownEnabled.value
        );
    }

    /**
     * @param {number} value
     */
    function setRecentActionCooldownMinutes(value) {
        const parsed = parseInt(value, 10);
        recentActionCooldownMinutes.value = Number.isNaN(parsed)
            ? 60
            : Math.min(1440, Math.max(1, parsed));
        configRepository.setInt(
            'VRCX-0_recentActionCooldownMinutes',
            recentActionCooldownMinutes.value
        );
    }

    return {
        isStartAtWindowsStartup,
        isStartAsMinimizedState,
        isCloseToTray,
        disableGpuAcceleration,
        localFavoriteFriendsGroups,
        udonExceptionLogging,
        logResourceLoad,
        logEmptyAvatars,
        autoLoginDelayEnabled,
        autoLoginDelaySeconds,
        autoStateChangeEnabled,
        autoStateChangeAloneStatus,
        autoStateChangeCompanyStatus,
        autoStateChangeInstanceTypes,
        autoStateChangeNoFriends,
        autoStateChangeAloneDescEnabled,
        autoStateChangeAloneDesc,
        autoStateChangeCompanyDescEnabled,
        autoStateChangeCompanyDesc,
        autoStateChangeGroups,
        autoAcceptInviteRequests,
        autoAcceptInviteGroups,
        recentActionCooldownEnabled,
        recentActionCooldownMinutes,

        setIsStartAtWindowsStartup,
        setIsStartAsMinimizedState,
        setIsCloseToTray,
        setDisableGpuAcceleration,
        setLocalFavoriteFriendsGroups,
        setUdonExceptionLogging,
        setLogResourceLoad,
        setLogEmptyAvatars,
        setAutoLoginDelayEnabled,
        promptAutoLoginDelaySeconds,
        setAutoStateChangeEnabled,
        setAutoStateChangeAloneStatus,
        setAutoStateChangeCompanyStatus,
        setAutoStateChangeInstanceTypes,
        setAutoStateChangeNoFriends,
        setAutoStateChangeAloneDescEnabled,
        setAutoStateChangeAloneDesc,
        setAutoStateChangeCompanyDescEnabled,
        setAutoStateChangeCompanyDesc,
        setAutoStateChangeGroups,
        setAutoAcceptInviteRequests,
        setAutoAcceptInviteGroups,
        promptProxySettings,
        setRecentActionCooldownEnabled,
        setRecentActionCooldownMinutes
    };
});
