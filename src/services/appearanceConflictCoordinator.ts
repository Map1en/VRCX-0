type DisableBackgroundImageOptions = {
    restoreAppTheme?: boolean;
};

type BackgroundImageAppearanceHandlers = {
    disableBackgroundImage: (
        options?: DisableBackgroundImageOptions
    ) => Promise<void>;
    isBackgroundImageActive: () => boolean;
};

type CommunityThemeAppearanceHandlers = {
    refreshInstalledCommunityTheme: () => Promise<void>;
    stopLocalCommunityThemePreview: () => Promise<void>;
};

let backgroundImageHandlers: Partial<BackgroundImageAppearanceHandlers> = {};
let communityThemeHandlers: Partial<CommunityThemeAppearanceHandlers> = {};

export function registerBackgroundImageAppearanceHandlers(
    handlers: BackgroundImageAppearanceHandlers
): void {
    backgroundImageHandlers = handlers;
}

export function registerCommunityThemeAppearanceHandlers(
    handlers: CommunityThemeAppearanceHandlers
): void {
    communityThemeHandlers = handlers;
}

export async function disableCommunityThemesForBackgroundImage(): Promise<void> {
    await communityThemeHandlers.refreshInstalledCommunityTheme?.();
    await communityThemeHandlers.stopLocalCommunityThemePreview?.();
}

export async function disableBackgroundImageForCommunityTheme(
    options?: DisableBackgroundImageOptions
): Promise<void> {
    await backgroundImageHandlers.disableBackgroundImage?.(options);
}

export function isBackgroundImageAppearanceActive(): boolean {
    return backgroundImageHandlers.isBackgroundImageActive?.() ?? false;
}
