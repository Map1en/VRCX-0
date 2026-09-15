const PREVIEW_LABELS = new Set(['preview', 'test']);
const DEVKIT_LABEL = 'devkit';

function getVrcxBuildLabel(): string {
    return typeof VRCX_0_BUILD_LABEL === 'string'
        ? VRCX_0_BUILD_LABEL.trim().toLowerCase()
        : '';
}

function getVrcxBuildBadge(): string {
    return typeof VRCX_0_BUILD_BADGE === 'string'
        ? VRCX_0_BUILD_BADGE.trim()
        : '';
}

function isLocalDevBuild(): boolean {
    return import.meta.env.DEV;
}

export function isUpdateCheckDisabledBuild(): boolean {
    return VRCX_0_DISABLE_UPDATE_CHECK;
}

export function isPreviewBuildLabel(label = getVrcxBuildLabel()): boolean {
    return PREVIEW_LABELS.has(label);
}

export function isDevKitBuild(label = getVrcxBuildLabel()): boolean {
    return label === DEVKIT_LABEL;
}

export function isDeveloperToolsBuild(): boolean {
    const label = getVrcxBuildLabel();
    return (
        isLocalDevBuild() || isPreviewBuildLabel(label) || isDevKitBuild(label)
    );
}

export function isDevToolsBuild(): boolean {
    return isLocalDevBuild() || isDevKitBuild();
}

function getBuildBadgeI18nKey(): string | null {
    const label = getVrcxBuildLabel();
    if (isDevKitBuild(label)) {
        return 'app_menu.devkit_build_badge';
    }
    if (isPreviewBuildLabel(label)) {
        return 'app_menu.preview_build_badge';
    }
    return null;
}

export function getBuildBadgeLabel(t: (key: string) => string): string {
    const buildBadge = getVrcxBuildBadge();
    if (buildBadge) {
        return buildBadge;
    }

    const buildBadgeKey = getBuildBadgeI18nKey();
    return buildBadgeKey ? t(buildBadgeKey) : '';
}
