export function getAvailablePlatforms(unityPackages) {
    let isPC = false;
    let isQuest = false;
    let isIos = false;

    if (typeof unityPackages === 'object' && unityPackages) {
        for (const unityPackage of unityPackages) {
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
    }

    return { isPC, isQuest, isIos };
}

export function getPlatformInfo(unityPackages) {
    let pc = {};
    let android = {};
    let ios = {};

    if (typeof unityPackages === 'object' && unityPackages) {
        for (const unityPackage of unityPackages) {
            if (
                unityPackage.variant &&
                unityPackage.variant !== 'standard' &&
                unityPackage.variant !== 'security'
            ) {
                continue;
            }
            if (unityPackage.platform === 'standalonewindows') {
                if (unityPackage.performanceRating === 'None' && pc.performanceRating) {
                    continue;
                }
                pc = unityPackage;
            } else if (unityPackage.platform === 'android') {
                if (unityPackage.performanceRating === 'None' && android.performanceRating) {
                    continue;
                }
                android = unityPackage;
            } else if (unityPackage.platform === 'ios') {
                if (unityPackage.performanceRating === 'None' && ios.performanceRating) {
                    continue;
                }
                ios = unityPackage;
            }
        }
    }

    return { pc, android, ios };
}
