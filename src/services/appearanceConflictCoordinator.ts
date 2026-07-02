// Breaks the backgroundImageService <-> communityThemeService import cycle:
// each service registers its primitives here at module load instead of
// importing the other directly.
//
// INVARIANT: both services must stay statically imported during startup
// (startupService imports both), so their handlers are registered before any
// appearance action runs. The cross-service calls below intentionally no-op via
// optional chaining when a side is unregistered. Therefore, if either service is
// ever lazy-loaded or code-split, mutual exclusion (background image XOR
// community theme) silently stops working instead of failing loudly -- a
// background image could be enabled without disabling an active community theme.
// Keep both imports eager; do not lazy-load these two services.
type DisableBackgroundImageOptions = {
    restoreAppTheme?: boolean;
};

type BackgroundImageAppearanceHandlers = {
    disableBackgroundImage: (
        options?: DisableBackgroundImageOptions
    ) => Promise<void>;
    isBackgroundImageActive: () => boolean;
    migrateLegacyNasaApodCommunityTheme: () => Promise<void>;
};

type CommunityThemeAppearanceHandlers = {
    disableInstalledCommunityTheme: () => Promise<void>;
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
    await communityThemeHandlers.stopLocalCommunityThemePreview?.();
    await communityThemeHandlers.disableInstalledCommunityTheme?.();
}

export async function disableBackgroundImageForCommunityTheme(
    options?: DisableBackgroundImageOptions
): Promise<void> {
    await backgroundImageHandlers.disableBackgroundImage?.(options);
}

export function isBackgroundImageAppearanceActive(): boolean {
    return backgroundImageHandlers.isBackgroundImageActive?.() ?? false;
}

export async function migrateLegacyNasaApodCommunityThemeForBackgroundImage(): Promise<void> {
    await backgroundImageHandlers.migrateLegacyNasaApodCommunityTheme?.();
}
