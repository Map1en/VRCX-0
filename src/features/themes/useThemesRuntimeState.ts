import { useBackgroundImageStore } from '@/state/backgroundImageStore';
import { useCommunityThemeStore } from '@/state/communityThemeStore';
import { useShellStore } from '@/state/shellStore';

export function useThemesRuntimeState() {
    const themeMode = useShellStore((state) => state.themeMode);
    const themeColor = useShellStore((state) => state.themeColor);
    const backgroundImageEnabled = useBackgroundImageStore(
        (state) => state.enabled
    );
    const backgroundImageProjectionMode = useBackgroundImageStore(
        (state) => state.mode
    );
    const backgroundImageCustomSource = useBackgroundImageStore(
        (state) => state.customSource
    );
    const decorationImageUrl = useBackgroundImageStore(
        (state) => state.decorationImageUrl
    );
    const backgroundImageMode = decorationImageUrl
        ? 'decoration'
        : backgroundImageProjectionMode;
    const catalog = useCommunityThemeStore((state) => state.catalog);
    const enabled = useCommunityThemeStore((state) => state.enabled);
    const installedTheme = useCommunityThemeStore(
        (state) => state.installedTheme
    );
    const installedThemes = useCommunityThemeStore(
        (state) => state.installedThemes
    );
    const localPreview = useCommunityThemeStore((state) => state.localPreview);
    const localPreviewWatch = useCommunityThemeStore(
        (state) => state.localPreviewWatch
    );
    const overrideCssLength = useCommunityThemeStore(
        (state) => state.overrideCssLength
    );
    const loading = useCommunityThemeStore((state) => state.loading);
    const error = useCommunityThemeStore((state) => state.error);

    return {
        themeMode,
        themeColor,
        backgroundImageEnabled,
        backgroundImageMode,
        backgroundImageCustomSource,
        catalog,
        enabled,
        installedTheme,
        installedThemes,
        localPreview,
        localPreviewWatch,
        overrideCssLength,
        loading,
        error
    };
}
