import { convertFileSrc } from '@/platform/tauri/assets';
import {
    commands,
    type BackgroundImageConfigureInput,
    type BackgroundImageCustomSource,
    type BackgroundImageMode,
    type BackgroundImageProjection,
    type BackgroundImageProviderId,
    type BackgroundImageSnapshot
} from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import {
    disableCommunityThemesForBackgroundImage,
    registerBackgroundImageAppearanceHandlers
} from '@/services/appearanceConflictCoordinator';
import { profileBackgroundTextures } from '@/shared/constants/profileBackgrounds';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';

import { syncBackgroundImageAppearance } from './appearanceService';

const BACKGROUND_IMAGE_DECORATION_URL_CONFIG_KEY =
    'backgroundImageDecorationUrl';

export type BackgroundImageSelectionMode = BackgroundImageMode | 'decoration';

export const backgroundImageRemoteProviders: {
    id: BackgroundImageProviderId;
    name: string;
}[] = [
    { id: 'nasa-epic', name: 'NASA EPIC' },
    { id: 'aic-public-domain', name: 'Art Institute of Chicago' },
    { id: 'nasa-apod-safe', name: 'NASA APOD' }
];

let lastAppliedProjectionRevision = -1;

export function isBackgroundImageCustomSourceRotating(
    source: BackgroundImageCustomSource | null,
    imageCount?: number | null
): boolean {
    if (!source) {
        return false;
    }
    if (typeof imageCount === 'number') {
        return imageCount > 1;
    }
    return source.kind === 'folder' || source.paths.length > 1;
}

function toDisplaySnapshot(
    snapshot: BackgroundImageSnapshot | null
): BackgroundImageSnapshot | null {
    if (!snapshot?.imagePath || snapshot.imageUrl) {
        return snapshot;
    }
    return {
        ...snapshot,
        imageUrl: `${convertFileSrc(snapshot.imagePath, 'vrcx-0-bg-img')}?v=${encodeURIComponent(
            snapshot.resolvedForKey
        )}`
    };
}

function applyProjectionState(projection: BackgroundImageProjection): boolean {
    if (projection.revision <= lastAppliedProjectionRevision) {
        return false;
    }
    lastAppliedProjectionRevision = projection.revision;
    useBackgroundImageStore.getState().applyProjection({
        mode: projection.mode,
        enabled: projection.enabled,
        providerId: projection.providerId,
        customSource: projection.customSource,
        snapshot: toDisplaySnapshot(projection.snapshot),
        error: projection.error
    });
    return true;
}

export function applyBackgroundImageProjectionEvent(
    projection: BackgroundImageProjection
): void {
    if (!applyProjectionState(projection)) {
        return;
    }
    syncBackgroundImageAppearance(false).catch((error: unknown) => {
        console.warn(
            'Failed to apply background image projection event:',
            error
        );
    });
}

async function runBackgroundImageCommand(
    command: () => Promise<BackgroundImageProjection>,
    { restoreAppTheme = true }: { restoreAppTheme?: boolean } = {}
): Promise<BackgroundImageProjection> {
    const store = useBackgroundImageStore.getState();
    store.setLoading(true);
    store.setError(null);
    try {
        const projection = await command();
        if (projection.enabled) {
            await disableCommunityThemesForBackgroundImage();
        }
        applyProjectionState(projection);
        await syncBackgroundImageAppearance(restoreAppTheme);
        return projection;
    } catch (error) {
        useBackgroundImageStore
            .getState()
            .setError(error instanceof Error ? error.message : String(error));
        throw error;
    } finally {
        useBackgroundImageStore.getState().setLoading(false);
    }
}

function configureBackgroundImage(
    input: BackgroundImageConfigureInput,
    options: { restoreAppTheme?: boolean } = {}
): Promise<BackgroundImageProjection> {
    return runBackgroundImageCommand(
        () => commands.appBackgroundImageConfigure(input),
        options
    );
}

export async function initializeBackgroundImage(
    prefetchedProjection?: BackgroundImageProjection
): Promise<void> {
    const projection =
        prefetchedProjection ?? (await commands.appBackgroundImageStateGet());
    applyProjectionState(projection);
    const decorationImageUrl = (
        await configRepository.getString(
            BACKGROUND_IMAGE_DECORATION_URL_CONFIG_KEY,
            ''
        )
    ).trim();
    if (decorationImageUrl) {
        useBackgroundImageStore
            .getState()
            .setDecorationImageUrl(decorationImageUrl);
    }
    await syncBackgroundImageAppearance(false);
}

export async function setBackgroundImageMode(
    nextMode: BackgroundImageSelectionMode
): Promise<boolean> {
    if (nextMode === 'off') {
        await disableBackgroundImage();
        return true;
    }
    if (nextMode === 'daily') {
        await clearBackgroundImageDecoration();
        return enableBackgroundImageDaily();
    }
    if (nextMode === 'decoration') {
        const source =
            profileBackgroundTextures.find(
                (texture) =>
                    texture.imageUrl ===
                    useBackgroundImageStore.getState().decorationImageUrl
            ) ?? profileBackgroundTextures[0];
        return setBackgroundImageDecoration(source.imageUrl);
    }
    await clearBackgroundImageDecoration();
    const projection = await configureBackgroundImage({ kind: 'enableCustom' });
    return projection.enabled;
}

export async function setBackgroundImageDecoration(
    imageUrl: string
): Promise<boolean> {
    const nextImageUrl = imageUrl.trim();
    if (!nextImageUrl) {
        return false;
    }
    if (!useBackgroundImageStore.getState().decorationImageUrl) {
        await configureBackgroundImage(
            { kind: 'disable' },
            { restoreAppTheme: false }
        );
    }
    await configRepository.setString(
        BACKGROUND_IMAGE_DECORATION_URL_CONFIG_KEY,
        nextImageUrl
    );
    useBackgroundImageStore.getState().setDecorationImageUrl(nextImageUrl);
    await syncBackgroundImageAppearance(false);
    return true;
}

async function clearBackgroundImageDecoration(): Promise<void> {
    if (!useBackgroundImageStore.getState().decorationImageUrl) {
        return;
    }
    await configRepository.setString(
        BACKGROUND_IMAGE_DECORATION_URL_CONFIG_KEY,
        ''
    );
    useBackgroundImageStore.getState().setDecorationImageUrl('');
}

export async function enableBackgroundImageDaily(
    providerId?: BackgroundImageProviderId
): Promise<boolean> {
    const projection = await configureBackgroundImage({
        kind: 'enableDaily',
        providerId: providerId ?? null
    });
    return projection.enabled;
}

export async function setBackgroundImageProvider(
    providerId: BackgroundImageProviderId
): Promise<void> {
    await configureBackgroundImage({ kind: 'setProvider', providerId });
}

export async function setBackgroundImageCustomFiles(
    paths: string[]
): Promise<boolean> {
    const projection = await configureBackgroundImage({
        kind: 'setCustomFiles',
        paths
    });
    return projection.enabled;
}

export async function setBackgroundImageCustomFolder(
    folderPath: string
): Promise<boolean> {
    const projection = await configureBackgroundImage({
        kind: 'setCustomFolder',
        folderPath
    });
    return projection.enabled;
}

export async function chooseBackgroundImageFiles(): Promise<boolean> {
    const state = useBackgroundImageStore.getState();
    const defaultPath =
        state.customSource?.kind === 'files'
            ? state.customSource.paths[0]
            : state.customSource?.folderPath;
    const paths = await commands.appOpenBackgroundImageFilesSelectorDialog(
        defaultPath || null
    );
    if (!paths.length) {
        return false;
    }
    return setBackgroundImageCustomFiles(paths);
}

export async function chooseBackgroundImageFolder(): Promise<boolean> {
    const state = useBackgroundImageStore.getState();
    const defaultPath =
        state.customSource?.kind === 'folder'
            ? state.customSource.folderPath
            : state.customSource?.paths[0];
    const folderPath = await commands.appOpenFolderSelectorDialog(
        defaultPath || null
    );
    if (!folderPath) {
        return false;
    }
    return setBackgroundImageCustomFolder(folderPath);
}

export async function setBackgroundImageCustomRotationIntervalMinutes(
    rotationIntervalMinutes: number
): Promise<boolean> {
    if (!useBackgroundImageStore.getState().customSource) {
        return false;
    }
    await configureBackgroundImage({
        kind: 'setRotationIntervalMinutes',
        rotationIntervalMinutes
    });
    return true;
}

export async function disableBackgroundImage({
    restoreAppTheme = true
}: {
    restoreAppTheme?: boolean;
} = {}): Promise<void> {
    if (useBackgroundImageStore.getState().decorationImageUrl) {
        await clearBackgroundImageDecoration();
        await syncBackgroundImageAppearance(restoreAppTheme);
        return;
    }
    await configureBackgroundImage({ kind: 'disable' }, { restoreAppTheme });
}

export async function refreshBackgroundImage(): Promise<boolean> {
    const projection = await runBackgroundImageCommand(() =>
        commands.appBackgroundImageRefresh()
    );
    return projection.enabled;
}

export function isBackgroundImageActive(): boolean {
    return useBackgroundImageStore.getState().enabled;
}

registerBackgroundImageAppearanceHandlers({
    disableBackgroundImage,
    isBackgroundImageActive
});
