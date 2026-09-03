interface UnityPackage {
    variant?: string;
    platform?: string;
    performanceRating?: string;
    [key: string]: unknown;
}

interface AvatarPerformance {
    android?: string;
    ios?: string;
    standalonewindows?: string;
}

interface PlatformAnalysis {
    performanceRating?: string;
    [key: string]: unknown;
}

interface PlatformFileAnalysis {
    android?: PlatformAnalysis;
    ios?: PlatformAnalysis;
    standalonewindows?: PlatformAnalysis;
}

function hasDetailValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

function hasAnalysisDetails(analysis: PlatformAnalysis | undefined): boolean {
    if (!analysis) {
        return false;
    }
    if (
        [
            analysis.fileSize,
            analysis.uncompressedSize,
            analysis._fileSize,
            analysis._uncompressedSize,
            analysis._totalTextureUsage
        ].some(hasDetailValue)
    ) {
        return true;
    }
    const avatarStats = analysis.avatarStats;
    return Boolean(
        avatarStats &&
        typeof avatarStats === 'object' &&
        Object.values(avatarStats).some(hasDetailValue)
    );
}

export function hasAvatarPerformanceDetails(
    fileAnalysis: PlatformFileAnalysis | null | undefined
): boolean {
    return Boolean(
        fileAnalysis && Object.values(fileAnalysis).some(hasAnalysisDetails)
    );
}

function normalizeUnityPackages(unityPackages: unknown): UnityPackage[] {
    return Array.isArray(unityPackages)
        ? unityPackages.filter((unityPackage): unityPackage is UnityPackage =>
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

function normalizeRating(value: unknown): string {
    const rating = typeof value === 'string' ? value.trim() : '';
    return rating && rating !== 'None' ? rating : '';
}

function enrichPlatformInfo(
    unityPackage: UnityPackage,
    platform: string,
    fallbackRating: unknown,
    analysis: PlatformAnalysis | undefined
): UnityPackage {
    const performanceRating =
        normalizeRating(analysis?.performanceRating) ||
        normalizeRating(unityPackage.performanceRating) ||
        normalizeRating(fallbackRating);
    if (!unityPackage.platform && !performanceRating && !analysis) {
        return unityPackage;
    }
    const result = {
        ...unityPackage,
        platform: unityPackage.platform || platform
    };
    if (performanceRating) {
        result.performanceRating = performanceRating;
    } else {
        delete result.performanceRating;
    }
    return result;
}

export function getPlatformInfo(
    unityPackages: unknown,
    performance: AvatarPerformance | null | undefined = null,
    fileAnalysis: PlatformFileAnalysis | null | undefined = null
) {
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
                !normalizeRating(unityPackage.performanceRating) &&
                normalizeRating(pc.performanceRating)
            ) {
                continue;
            }
            pc = unityPackage;
        } else if (unityPackage.platform === 'android') {
            if (
                !normalizeRating(unityPackage.performanceRating) &&
                normalizeRating(android.performanceRating)
            ) {
                continue;
            }
            android = unityPackage;
        } else if (unityPackage.platform === 'ios') {
            if (
                !normalizeRating(unityPackage.performanceRating) &&
                normalizeRating(ios.performanceRating)
            ) {
                continue;
            }
            ios = unityPackage;
        }
    }

    return {
        pc: enrichPlatformInfo(
            pc,
            'standalonewindows',
            performance?.standalonewindows,
            fileAnalysis?.standalonewindows
        ),
        android: enrichPlatformInfo(
            android,
            'android',
            performance?.android,
            fileAnalysis?.android
        ),
        ios: enrichPlatformInfo(ios, 'ios', performance?.ios, fileAnalysis?.ios)
    };
}
