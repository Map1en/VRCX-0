type BackendCommand<TReturn = any> = (...args: any[]) => Promise<TReturn>;

export interface BackendNamespace {
    [methodName: string]: BackendCommand;
}

export interface AssetBundleCacheCheckResult {
    Item1: number;
    Item2: boolean;
    Item3: string;
    item1?: number;
    item2?: boolean;
    item3?: string;
}

export interface AssetBundleBackendNamespace extends BackendNamespace {
    GetVRChatCacheFullLocation(
        fileId: string,
        fileVersion: number,
        variant: string,
        variantVersion: number
    ): Promise<string>;
    CheckVRChatCache(
        fileId: string,
        fileVersion: number,
        variant: string,
        variantVersion: number
    ): Promise<AssetBundleCacheCheckResult>;
    DeleteCache(
        fileId: string,
        fileVersion: number,
        variant: string,
        variantVersion: number
    ): Promise<void>;
    DeleteAllCache(): Promise<void>;
    SweepCache(): Promise<string[]>;
    GetCacheSize(): Promise<number>;
}

export interface BackendEvents {
    on(name: string, handler: (payload: unknown) => void): Promise<() => void>;
    off(name: string, handler: (payload: unknown) => void): void;
    emit(name: string, payload?: unknown): void;
    clear(name?: string | null): void;
    subscribe(
        name: string,
        handler: (payload: unknown) => void
    ): Promise<() => void>;
}

export interface BackendWebview {
    getCurrentWebviewWindow(): Promise<unknown>;
    getCurrentWindow(): Promise<unknown>;
    setZoom(zoom: number): Promise<unknown>;
    getScaleFactor(): Promise<number | null>;
    startDraggingWindow(): Promise<unknown>;
    minimizeWindow(): Promise<unknown>;
    toggleMaximizeWindow(): Promise<unknown>;
    closeWindow(): Promise<unknown>;
    isWindowMaximized(): Promise<boolean>;
}

export interface Backend {
    app: BackendNamespace;
    web: BackendNamespace;
    storage: BackendNamespace;
    sqlite: BackendNamespace;
    logWatcher: BackendNamespace;
    discord: BackendNamespace;
    assetBundle: AssetBundleBackendNamespace;
    events: BackendEvents;
    webview: BackendWebview;
}

export const backend: Backend;
export default backend;
