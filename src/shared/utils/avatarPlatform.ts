interface UnityPackage {
    variant?: string;
    platform?: string;
    performanceRating?: string;
    [key: string]: unknown;
}

function normalizeUnityPackages(unityPackages: unknown): UnityPackage[] {
    return Array.isArray(unityPackages)
        ? unityPackages.filter(
              (unityPackage: any): unityPackage is UnityPackage =>
                  Boolean(unityPackage && typeof unityPackage === 'object')
          )
        : [];
}

export function getAvailablePlatforms(unityPackages: unknown) {
    let isPC = false;
    let isQuest = false;
    let isIos = false;

    for (const unityPackage of normalizeUnityPackages(unityPackages)) {
        if (
            unityPackage.variant &&
            unityPackage.variant !== 'standard' &&
            unityPackage.variant !== 'security'
        ) {
            continue;
        }
        if (unityPackage.platform === 'standalonewindows') {
            isPC = true;
        } else if (unityPackage.platform === 'android') {
            isQuest = true;
        } else if (unityPackage.platform === 'ios') {
            isIos = true;
        }
    }

    return { isPC, isQuest, isIos };
}

export function getPlatformInfo(unityPackages: unknown) {
    let pc: UnityPackage = {};
    let android: UnityPackage = {};
    let ios: UnityPackage = {};

    for (const unityPackage of normalizeUnityPackages(unityPackages)) {
        if (
            unityPackage.variant &&
            unityPackage.variant !== 'standard' &&
            unityPackage.variant !== 'security'
        ) {
            continue;
        }
        if (unityPackage.platform === 'standalonewindows') {
            if (
                unityPackage.performanceRating === 'None' &&
                pc.performanceRating
            ) {
                continue;
            }
            pc = unityPackage;
        } else if (unityPackage.platform === 'android') {
            if (
                unityPackage.performanceRating === 'None' &&
                android.performanceRating
            ) {
                continue;
            }
            android = unityPackage;
        } else if (unityPackage.platform === 'ios') {
            if (
                unityPackage.performanceRating === 'None' &&
                ios.performanceRating
            ) {
                continue;
            }
            ios = unityPackage;
        }
    }

    return { pc, android, ios };
}
