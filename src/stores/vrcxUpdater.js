import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import { invoke } from '@tauri-apps/api/core';

import { logWebRequest } from '../services/appConfig';
import { branches } from '../shared/constants';
import {
    getLatestWhatsNewRelease,
    getWhatsNewRelease,
    normalizeReleaseVersion
} from '../shared/constants/whatsNewReleases';
import { changeLogRemoveLinks } from '../shared/utils';
import {
    compareReleaseVersions,
    formatReleaseDisplayVersion,
    isBetaReleaseVersion,
    parseReleaseVersion
} from '../shared/utils/releaseVersion';

import configRepository from '../services/config';

import * as workerTimers from 'worker-timers';

const emptyWhatsNewDialog = () => ({
    visible: false,
    titleKey: '',
    subtitleKey: '',
    items: []
});

export const useVRCXUpdaterStore = defineStore('VRCXUpdater', () => {
    const { t } = useI18n();

    const noUpdater = ref(false);

    const currentVersion = ref(VERSION || '');
    const appVersion = computed(
        () => formatReleaseDisplayVersion(currentVersion.value) || '-'
    );
    const autoUpdateVRCX = ref('Auto Download');
    const latestAppVersion = ref('');
    const branch = ref('Stable');
    const vrcxId = ref('');
    const checkingForVRCXUpdate = ref(false);
    const VRCXUpdateDialog = ref({
        visible: false,
        updatePending: false,
        updatePendingIsLatest: false,
        release: '',
        releases: []
    });
    const changeLogDialog = ref({
        visible: false,
        buildName: '',
        changeLog: ''
    });
    const whatsNewDialog = ref(emptyWhatsNewDialog());
    const pendingVRCXUpdate = ref(false);
    const pendingVRCXInstall = ref('');
    const updateInProgress = ref(false);
    const updateProgress = ref(0);
    const updateToastRelease = ref('');
    const pendingVRCXInstallDisplay = computed(() =>
        formatReleaseDisplayVersion(pendingVRCXInstall.value)
    );

    async function initVRCXUpdaterSettings() {
        const [VRCX0_autoUpdateVRCX, VRCX0_id, savedBranch] = await Promise.all([
            configRepository.getString('autoUpdateVRCX', 'Auto Download'),
            configRepository.getString('id', ''),
            configRepository.getString('branch', '')
        ]);

        if (VRCX0_autoUpdateVRCX === 'Auto Install') {
            autoUpdateVRCX.value = 'Auto Download';
        } else {
            autoUpdateVRCX.value = VRCX0_autoUpdateVRCX;
        }
        if (noUpdater.value) {
            autoUpdateVRCX.value = 'Off';
        }

        vrcxId.value = VRCX0_id;

        await initBranch(savedBranch);
        await loadVrcxId();

        let checkedForUpdatesDuringAnnouncement = false;
        if (await shouldAnnounceCurrentVersion()) {
            const shown = await showWhatsNewDialog();
            if (shown) {
                await markCurrentVersionAsSeen();
            } else if (isRecognizedStableReleaseVersion()) {
                const result = await showChangeLogDialog({ prefetch: true });
                checkedForUpdatesDuringAnnouncement = result.checkedForUpdates;
                if (result.shown) {
                    await markCurrentVersionAsSeen();
                }
            }
        } else {
            await syncCurrentVersionState();
        }
        if (
            autoUpdateVRCX.value !== 'Off' &&
            !checkedForUpdatesDuringAnnouncement
        ) {
            await checkForVRCXUpdate();
        }
    }

    /**
     * @param {string} value
     */
    async function setAutoUpdateVRCX(value) {
        if (value === 'Off') {
            pendingVRCXUpdate.value = false;
        }
        autoUpdateVRCX.value = value;
        await configRepository.setString('autoUpdateVRCX', value);
    }
    /**
     * @param {string} value
     */
    function setLatestAppVersion(value) {
        latestAppVersion.value = value;
    }
    /**
     * @param {string} value
     */
    function setBranch(value) {
        const nextBranch = value === 'Beta' ? 'Beta' : 'Stable';
        branch.value = nextBranch;
        configRepository.setString('branch', nextBranch);
    }

    async function initBranch(savedBranch = '') {
        if (!currentVersion.value) {
            return;
        }
        if (savedBranch === 'Stable' || savedBranch === 'Beta') {
            branch.value = savedBranch;
        } else if (isBetaReleaseVersion(currentVersion.value)) {
            branch.value = 'Beta';
        } else {
            branch.value = 'Stable';
        }
        await configRepository.setString('branch', branch.value);
    }

    async function hasVersionChanged() {
        const lastVersion = await configRepository.getString(
            'VRCX-0_lastVRCXVersion',
            ''
        );
        return lastVersion !== currentVersion.value;
    }

    async function markCurrentVersionAsSeen() {
        await configRepository.setString(
            'VRCX-0_lastVRCXVersion',
            currentVersion.value
        );
    }

    async function syncCurrentVersionState() {
        if (await hasVersionChanged()) {
            await markCurrentVersionAsSeen();
            return true;
        }
        return false;
    }

    async function shouldAnnounceCurrentVersion() {
        if (branch.value !== 'Stable' || !isRecognizedStableReleaseVersion()) {
            return false;
        }
        const lastVersion = await configRepository.getString(
            'VRCX-0_lastVRCXVersion',
            ''
        );
        return Boolean(lastVersion) && lastVersion !== currentVersion.value;
    }

    function isRecognizedStableReleaseVersion() {
        return Boolean(normalizeReleaseVersion(appVersion.value));
    }

    /**
     * @returns {Promise<boolean>}
     */
    async function showWhatsNewDialog() {
        const release = getWhatsNewRelease(appVersion.value);

        if (!release) {
            whatsNewDialog.value = emptyWhatsNewDialog();
            return false;
        }

        whatsNewDialog.value = {
            visible: true,
            titleKey: release.titleKey,
            subtitleKey: release.subtitleKey,
            items: release.items.map((item) => ({ ...item }))
        };

        return true;
    }

    // function showLatestWhatsNewDialog() {
    //     const release = getLatestWhatsNewRelease();

    //     if (!release) {
    //         return false;
    //     }

    //     whatsNewDialog.value = {
    //         visible: true,
    //         titleKey: release.titleKey,
    //         subtitleKey: release.subtitleKey,
    //         items: release.items.map((item) => ({ ...item }))
    //     };

    //     return true;
    // }

    function closeWhatsNewDialog() {
        whatsNewDialog.value.visible = false;
    }

    async function openChangeLogDialogOnly() {
        changeLogDialog.value.visible = true;
        if (
            !changeLogDialog.value.buildName ||
            !changeLogDialog.value.changeLog
        ) {
            await checkForVRCXUpdate();
        }
    }
    async function loadVrcxId() {
        if (!vrcxId.value) {
            vrcxId.value = crypto.randomUUID();
            await configRepository.setString('id', vrcxId.value);
        }
    }
    function getAssetOfInterest(assets) {
        let downloadUrl = '';
        let hashString = '';
        let size = 0;
        for (const asset of assets) {
            if (asset.state !== 'uploaded') {
                continue;
            }
            if (
                asset.name.endsWith('.exe') &&
                (asset.content_type === 'application/x-msdownload' ||
                    asset.content_type === 'application/x-msdos-program')
            ) {
                downloadUrl = asset.browser_download_url;
                if (asset.digest && asset.digest.startsWith('sha256:')) {
                    hashString = asset.digest.replace('sha256:', '');
                }
                size = asset.size;
                break;
            }
        }
        return { downloadUrl, hashString, size };
    }

    /**
     * @param {string} selectedBranch
     * @returns {'Stable' | 'Beta'}
     */
    function sanitizeBranch(selectedBranch) {
        return selectedBranch === 'Beta' ? 'Beta' : 'Stable';
    }

    /**
     * @param {any} release
     * @returns {null | {
     *   canonicalVersion: string,
     *   displayVersion: string,
     *   tagName: string,
     *   displayName: string,
     *   prerelease: boolean,
     *   publishedAt: string,
     *   body: string,
     *   assets: any[]
     * }}
     */
    function normalizeGitHubRelease(release) {
        const parsedVersion = parseReleaseVersion(release?.tag_name);
        if (!parsedVersion) {
            return null;
        }

        return {
            canonicalVersion: parsedVersion.canonicalVersion,
            displayVersion: parsedVersion.displayVersion,
            tagName: release.tag_name,
            displayName: release.name || `VRCX-0 ${parsedVersion.displayVersion}`,
            prerelease: Boolean(release.prerelease),
            publishedAt: release.published_at || '',
            body: release.body || '',
            assets: Array.isArray(release.assets) ? release.assets : []
        };
    }

    /**
     * @param {'Stable' | 'Beta'} selectedBranch
     * @param {any[]} releases
     * @returns {ReturnType<typeof normalizeGitHubRelease>[]}
     */
    function normalizeReleaseList(selectedBranch, releases) {
        const shouldKeepPrerelease = selectedBranch === 'Beta';

        return releases
            .map((release) => normalizeGitHubRelease(release))
            .filter((release) => {
                if (!release) {
                    return false;
                }
                if (release.prerelease !== shouldKeepPrerelease) {
                    return false;
                }

                const { downloadUrl } = getAssetOfInterest(release.assets);
                return Boolean(downloadUrl);
            })
            .sort((left, right) =>
                compareReleaseVersions(
                    right.canonicalVersion,
                    left.canonicalVersion
                )
            );
    }

    /**
     * @param {'Stable' | 'Beta'} selectedBranch
     * @param {string} currentAppVersion
     * @param {string} latestReleaseVersion
     * @returns {boolean}
     */
    function hasUpdateForBranch(
        selectedBranch,
        currentAppVersion,
        latestReleaseVersion
    ) {
        const currentParsed = parseReleaseVersion(currentAppVersion);
        const latestParsed = parseReleaseVersion(latestReleaseVersion);

        if (!currentParsed || !latestParsed) {
            return false;
        }

        if (selectedBranch === 'Beta') {
            const dateDelta =
                latestParsed.year - currentParsed.year ||
                latestParsed.month - currentParsed.month ||
                latestParsed.day - currentParsed.day;
            if (dateDelta !== 0) {
                return dateDelta > 0;
            }

            if (
                currentParsed.channel === 'Stable' &&
                latestParsed.channel === 'Beta'
            ) {
                return true;
            }
        }

        return (
            compareReleaseVersions(
                latestParsed.canonicalVersion,
                currentParsed.canonicalVersion
            ) > 0
        );
    }

    /**
     * @param {string} url
     * @returns {Promise<any[] | null>}
     */
    async function fetchGitHubReleases(url) {
        checkingForVRCXUpdate.value = true;
        let response;
        let json;
        try {
            response = await webApiService.execute({
                url,
                method: 'GET',
                headers: {
                    Accept: 'application/vnd.github+json'
                }
            });
            json = JSON.parse(response.data);
        } catch (error) {
            console.error('Failed to check for VRCX update', error);
            return null;
        } finally {
            checkingForVRCXUpdate.value = false;
        }

        if (response.status !== 200) {
            toast.error(
                t('message.vrcx_updater.failed', {
                    message: `${response.status} ${response.data}`
                })
            );
            return null;
        }

        logWebRequest('[EXTERNAL GET]', url, `(${response.status})`, json);

        if (typeof json !== 'object' || json?.message) {
            toast.error(
                t('message.vrcx_updater.failed', {
                    message: json?.message
                })
            );
            return null;
        }

        return Array.isArray(json) ? json : [json];
    }

    /**
     * @param {'Stable' | 'Beta'} selectedBranch
     * @returns {Promise<ReturnType<typeof normalizeGitHubRelease>[] | null>}
     */
    async function fetchBranchReleases(selectedBranch) {
        const releases = await fetchGitHubReleases(
            branches[selectedBranch].urlReleases
        );
        if (!releases) {
            return null;
        }
        return normalizeReleaseList(selectedBranch, releases);
    }

    /**
     * @param {'Stable' | 'Beta'} selectedBranch
     * @returns {Promise<ReturnType<typeof normalizeGitHubRelease> | null>}
     */
    async function fetchLatestBranchRelease(selectedBranch) {
        if (selectedBranch === 'Stable') {
            const releases = await fetchGitHubReleases(
                branches[selectedBranch].urlLatest
            );
            if (!releases?.length) {
                return null;
            }
            return normalizeGitHubRelease(releases[0]);
        }

        const releases = await fetchBranchReleases(selectedBranch);
        return releases?.[0] || null;
    }

    async function checkForVRCXUpdate() {
        if (!currentVersion.value || !parseReleaseVersion(currentVersion.value)) {
            return false;
        }
        const selectedBranch = sanitizeBranch(branch.value);
        if (selectedBranch !== branch.value) {
            setBranch(selectedBranch);
        }

        const latestRelease = await fetchLatestBranchRelease(selectedBranch);
        if (!latestRelease) {
            return false;
        }

        pendingVRCXUpdate.value = false;
        changeLogDialog.value.buildName = latestRelease.displayName;
        changeLogDialog.value.changeLog = changeLogRemoveLinks(latestRelease.body);
        setLatestAppVersion(latestRelease.displayVersion);
        VRCXUpdateDialog.value.updatePendingIsLatest = false;

        if (autoUpdateVRCX.value === 'Off') {
            return true;
        }
        if (latestRelease.canonicalVersion === pendingVRCXInstall.value) {
            VRCXUpdateDialog.value.updatePendingIsLatest = true;
        } else if (
            hasUpdateForBranch(
                selectedBranch,
                currentVersion.value,
                latestRelease.canonicalVersion
            )
        ) {
            const { downloadUrl, hashString, size } = getAssetOfInterest(
                latestRelease.assets
            );
            if (!downloadUrl) {
                return true;
            }
            pendingVRCXUpdate.value = true;
            if (updateToastRelease.value !== latestRelease.canonicalVersion) {
                updateToastRelease.value = latestRelease.canonicalVersion;
                toast(t('nav_menu.update_available'), {
                    description: latestRelease.displayVersion,
                    duration: 5000,
                    action: {
                        label: t('nav_menu.update'),
                        onClick: () => showVRCXUpdateDialog()
                    }
                });
            }
            if (autoUpdateVRCX.value === 'Auto Download') {
                await downloadVRCXUpdate(
                    downloadUrl,
                    hashString,
                    size,
                    latestRelease.canonicalVersion
                );
            }
        }
        return true;
    }
    async function showVRCXUpdateDialog() {
        const D = VRCXUpdateDialog.value;
        D.visible = true;
        D.updatePendingIsLatest = false;
        D.updatePending = await invoke('app__check_for_update_exe');
        if (updateInProgress.value) {
            return;
        }
        await loadBranchVersions();
    }

    async function loadBranchVersions() {
        const D = VRCXUpdateDialog.value;
        const selectedBranch = sanitizeBranch(branch.value);
        if (selectedBranch !== branch.value) {
            setBranch(selectedBranch);
        }

        const releases = await fetchBranchReleases(selectedBranch);
        if (!releases) {
            return;
        }
        D.releases = releases;
        D.release = releases[0]?.canonicalVersion || '';
        VRCXUpdateDialog.value.updatePendingIsLatest = false;
        if (D.release === pendingVRCXInstall.value) {
            // update already downloaded and latest version
            VRCXUpdateDialog.value.updatePendingIsLatest = true;
        }
        setBranch(selectedBranch);
    }
    async function downloadVRCXUpdate(
        downloadUrl,
        hashString,
        size,
        releaseName
    ) {
        if (updateInProgress.value) {
            return;
        }
        try {
            updateInProgress.value = true;
            await downloadFileProgress();
            await invoke('app__download_update', {
                fileUrl: downloadUrl,
                hashString,
                downloadSize: size
            });
            pendingVRCXInstall.value = releaseName;
        } catch (err) {
            console.error(err);
            toast.error(`${t('message.vrcx_updater.failed_install')} ${err}`);
        } finally {
            updateInProgress.value = false;
            updateProgress.value = 0;
        }
    }
    async function downloadFileProgress() {
        updateProgress.value = await invoke('app__check_update_progress');
        if (updateInProgress.value) {
            workerTimers.setTimeout(() => downloadFileProgress(), 150);
        }
    }
    function installVRCXUpdate() {
        for (const release of VRCXUpdateDialog.value.releases) {
            if (
                release.canonicalVersion !==
                VRCXUpdateDialog.value.release
            ) {
                continue;
            }
            const { downloadUrl, hashString, size } = getAssetOfInterest(
                release.assets
            );
            if (!downloadUrl) {
                return;
            }
            const releaseName = release.canonicalVersion;
            downloadVRCXUpdate(downloadUrl, hashString, size, releaseName);
            break;
        }
    }
    async function showChangeLogDialog(options = {}) {
        const { prefetch = false } = options;

        if (prefetch) {
            const loaded = await ensureChangeLogReady();
            if (!loaded) {
                return { shown: false, checkedForUpdates: true };
            }
            changeLogDialog.value.visible = true;
            return { shown: true, checkedForUpdates: true };
        }

        changeLogDialog.value.visible = true;
        void ensureChangeLogReady();
        return { shown: true, checkedForUpdates: true };
    }

    async function ensureChangeLogReady() {
        if (
            changeLogDialog.value.buildName &&
            changeLogDialog.value.changeLog
        ) {
            return true;
        }
        return checkForVRCXUpdate();
    }
    function restartVRCX(isUpgrade) {
        invoke('app__restart_application', { isUpgrade });
    }
    function updateProgressText() {
        if (updateProgress.value === 100) {
            return t('message.vrcx_updater.checking_hash');
        }
        return `${updateProgress.value}%`;
    }
    async function cancelUpdate() {
        await invoke('app__cancel_update');
        updateInProgress.value = false;
        updateProgress.value = 0;
    }

    initVRCXUpdaterSettings();

    return {
        appVersion,
        autoUpdateVRCX,
        latestAppVersion,
        branch,
        currentVersion,
        vrcxId,
        checkingForVRCXUpdate,
        VRCXUpdateDialog,
        changeLogDialog,
        whatsNewDialog,
        pendingVRCXUpdate,
        pendingVRCXInstall,
        pendingVRCXInstallDisplay,
        updateInProgress,
        updateProgress,
        noUpdater,

        setAutoUpdateVRCX,
        setBranch,

        showWhatsNewDialog,
        closeWhatsNewDialog,
        openChangeLogDialogOnly,
        checkForVRCXUpdate,
        loadBranchVersions,
        installVRCXUpdate,
        showVRCXUpdateDialog,
        showChangeLogDialog,
        restartVRCX,
        updateProgressText,
        cancelUpdate
    };
});
