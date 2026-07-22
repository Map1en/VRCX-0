import { commands } from '@/platform/tauri/bindings';
import type {
    AppDataDirState,
    AppDataDirValidation
} from '@/platform/tauri/bindings';
import { tauriClient } from '@/platform/tauri/client';

export async function openExternalLink(url: string): Promise<void> {
    await commands.appOpenLink(url);
}

export async function exitApplication(): Promise<void> {
    await commands.appExitApplication();
}

export async function restartApplication(): Promise<void> {
    await commands.appRestartApplication();
}

export async function getAppDataDirState(): Promise<AppDataDirState> {
    return commands.appGetAppDataDirState();
}

export async function validateAppDataDir(
    path: string
): Promise<AppDataDirValidation> {
    return commands.appValidateAppDataDir(path);
}

export async function setAppDataDir(path: string): Promise<AppDataDirState> {
    return commands.appSetAppDataDir(path);
}

export async function clearAppDataDir(): Promise<AppDataDirState> {
    return commands.appClearAppDataDir();
}

export async function getClipboardText(): Promise<string> {
    const value = await commands.appGetClipboard().catch(() => '');
    return typeof value === 'string' ? value : '';
}

export async function setTrayIconNotification(notify: boolean): Promise<void> {
    await commands.appSetTrayIconNotification(notify);
}

export async function showDesktopNotification(
    boldText: string,
    text: string,
    image: string = '',
    playSound: boolean = false
): Promise<void> {
    await commands.appDesktopNotification(boldText, text, image, playSound);
}

export async function openUGCPhotosFolder(ugcPath: string): Promise<void> {
    await commands.appOpenUgcPhotosFolder(ugcPath);
}

export async function openFolderAndSelectItem(
    path: string,
    isFolder: boolean
): Promise<void> {
    await commands.appOpenFolderAndSelectItem(path, isFolder);
}

export async function openFolderSelectorDialog(
    defaultPath: string
): Promise<string> {
    const selected = await commands.appOpenFolderSelectorDialog(defaultPath);
    return typeof selected === 'string' ? selected : '';
}

export async function openFileSelectorDialog(
    defaultPath: string,
    defaultExt: string,
    defaultFilter: string
): Promise<string> {
    const selected = await commands.appOpenFileSelectorDialog(
        defaultPath,
        defaultExt,
        defaultFilter
    );
    return typeof selected === 'string' ? selected : '';
}

export async function saveFileSelectorDialog(
    defaultPath: string,
    defaultName: string,
    defaultExt: string,
    defaultFilter: string
): Promise<string> {
    const selected = await commands.appSaveFileSelectorDialog(
        defaultPath,
        defaultName,
        defaultExt,
        defaultFilter
    );
    return typeof selected === 'string' ? selected : '';
}

export async function openCalendarFile(icsContent: string): Promise<void> {
    await commands.appOpenCalendarFile(icsContent);
}

export async function saveCalendarFile(
    defaultName: string,
    icsContent: string
): Promise<void> {
    await commands.appSaveCalendarFile(defaultName, icsContent);
}

export async function saveJsonFile(
    defaultName: string,
    json: string
): Promise<void> {
    await commands.appSaveVrcRegJsonFile(null, defaultName, json);
}

export async function readVrchatConfigFileSafe(): Promise<string> {
    const config = await commands.appReadConfigFileSafe();
    return typeof config === 'string' ? config : '';
}

export async function writeVrchatConfigFile(json: string): Promise<void> {
    await commands.appWriteConfigFile(json);
}

export async function vrchatCacheLocationWouldChange(
    json: string
): Promise<boolean> {
    return commands.appVrchatCacheLocationWouldChange(json);
}

export async function writeVrchatConfigFileWithCacheCleanup(
    json: string
): Promise<string | null> {
    const result = await commands.appWriteConfigFileWithCacheCleanup(json);
    return result.oldCacheCleanupError;
}

export async function setVrchatRegistryKey(
    key: string,
    value: unknown,
    typeInt: number
): Promise<void> {
    await commands.appSetVrchatRegistryKey(key, value, typeInt);
}

export async function getVrchatUserModeration(
    currentUserId: string,
    userId: string
): Promise<number> {
    return commands.appGetVrchatUserModeration(currentUserId, userId);
}

export async function setVrchatUserModeration(
    currentUserId: string,
    userId: string,
    moderationType: string | number
): Promise<boolean> {
    return commands.appSetVrchatUserModeration(
        currentUserId,
        userId,
        Number(moderationType)
    );
}

export async function openDiscordProfile(discordId: string): Promise<void> {
    await commands.appOpenDiscordProfile(discordId);
}

export async function deleteAllScreenshotMetadata(): Promise<void> {
    await commands.appDeleteAllScreenshotMetadata();
}

export async function isWindowMaximized(): Promise<boolean> {
    return Boolean(await tauriClient.webview.isWindowMaximized());
}

export async function minimizeWindow(): Promise<void> {
    await tauriClient.webview.minimizeWindow();
}

export async function toggleMaximizeWindow(): Promise<void> {
    await tauriClient.webview.toggleMaximizeWindow();
}

export async function closeWindow(): Promise<void> {
    await tauriClient.webview.closeWindow();
}
