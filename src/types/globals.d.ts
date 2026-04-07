declare global {
    const VERSION: string;

    interface Window {
        $pinia: any;
        $debug: AppDebug;
        __TAURI_INTERNALS__?: unknown;
        AppApi: typeof AppApi;
        WebApi: typeof WebApi;
        VRCXStorage: typeof VRCXStorage;
        SQLite: typeof SQLite;
        LogWatcher: typeof LogWatcher;
        Discord: typeof Discord;
        AssetBundleManager: typeof AssetBundleManager;
        webApiService: typeof webApiService;
        configRepository: any;
        sqliteService: any;
    }

    interface AppDebug {
        debug: boolean;
        debugWebSocket: boolean;
        debugUserDiff: boolean;
        debugPhotonLogging: boolean;
        debugGameLog: boolean;
        debugWebRequests: boolean;
        debugFriendState: boolean;
        debugIPC: boolean;
        debugVrcPlus: boolean;
        errorNoty: any;
        dontLogMeOut: boolean;
        endpointDomain: string;
        endpointDomainVrchat: string;
        websocketDomain: string;
        websocketDomainVrchat: string;
    }

    const VRCXStorage: {
        Get(key: string): Promise<string>;
        Set(key: string, value: string): Promise<void>;
        Remove(key: string): Promise<void>;
        GetAll(): Promise<string>;
        Flush(): Promise<void>;
    };

    const SQLite: {
        Execute: (sql: string, args: string) => Promise<any[]>;
        ExecuteNonQuery: (sql: string, args: string) => Promise<Number>;
    };

    const LogWatcher: {
        Get(): Promise<Array<[string, string, string, ...any[]]>>;
        SetDateTill(date: string): Promise<void>;
        Reset(): Promise<void>;
        VrcClosedGracefully(): Promise<boolean>;
    };

    const Discord: {
        SetAssets(
            details: string,
            state: string,
            detailsUrl: string,
            bigIcon: string,
            bigIconText: string,
            smallIcon: string,
            smallIconText: string,
            startTime: number,
            endTime: number,
            partyId: string,
            partySize: number,
            partyMaxSize: number,
            buttonText: string,
            buttonUrl: string,
            appId: string,
            activityType: number,
            statusDisplayType: number
        ): Promise<void>;
        SetActive(active: boolean): Promise<boolean>;
    };

    const AppApi: {
        ShowDevTools(): Promise<void>;
        DesktopNotification(
            boldText: string,
            text?: string,
            image?: string
        ): Promise<void>;
        RestartApplication(isUpgrade: boolean): Promise<void>;
        CheckForUpdateExe(): Promise<boolean>;
        FocusWindow(): Promise<void>;
        ChangeTheme(value: number): Promise<void>;
        DoFunny(): Promise<void>;
        GetClipboard(): Promise<string>;
        SetStartup(enabled: boolean): Promise<void>;
        CopyImageToClipboard(path: string): Promise<void>;
        FlashWindow(): Promise<void>;
        SetUserAgent(): Promise<void>;
        SetTrayIconNotification(notify: boolean): Promise<void>;
        OpenCalendarFile(icsContent: string): Promise<void>;

        OpenLink(url: string): Promise<void>;
        OpenDiscordProfile(discordId: string): Promise<void>;
        IPCAnnounceStart(): Promise<void>;
        SendIpc(type: string, data: string): Promise<void>;
        CurrentCulture(): Promise<string>;
        CurrentLanguage(): Promise<string>;
        VrcClosedGracefully(): Promise<boolean>;
        SetAppLauncherSettings(
            enabled: boolean,
            killOnExit: boolean,
            runProcessOnce: boolean
        ): Promise<void>;
        GetFileBase64(path: string): Promise<string | null>;
        TryOpenInstanceInVrc(launchUrl: string): Promise<boolean>;

        SignFile(blob: string): Promise<string>;

        GetVRChatAppDataLocation(): Promise<string>;
        GetVRChatPhotosLocation(): Promise<string>;
        GetUGCPhotoLocation(path?: string): Promise<string>;
        GetVRChatScreenshotsLocation(): Promise<string>;
        GetVRChatCacheLocation(): Promise<string>;
        OpenVrcxAppDataFolder(): Promise<boolean>;
        OpenVrcAppDataFolder(): Promise<boolean>;
        OpenVrcPhotosFolder(): Promise<boolean>;
        OpenUGCPhotosFolder(ugcPath?: string): Promise<boolean>;
        OpenVrcScreenshotsFolder(): Promise<boolean>;
        OpenCrashVrcCrashDumps(): Promise<boolean>;
        OpenShortcutFolder(): Promise<void>;
        OpenFolderAndSelectItem(
            path: string,
            isFolder?: boolean
        ): Promise<void>;
        OpenFileSelectorDialog(
            defaultPath?: string,
            defaultExt?: string,
            defaultFilter?: string
        ): Promise<string>;
        OpenFolderSelectorDialog(defaultPath?: string): Promise<string>;

        CheckGameRunning(): Promise<void>;
        IsGameRunning(): Promise<boolean>;
        IsSteamVRRunning(): Promise<boolean>;
        QuitGame(): Promise<number>;
        StartGame(arguments: string): Promise<boolean>;
        StartGameFromPath(path: string, arguments: string): Promise<boolean>;

        GetVRChatRegistryKey(key: string): Promise<any>;
        GetVRChatRegistryKeyString(key: string): Promise<string>;
        SetVRChatRegistryKey(
            key: string,
            value: any,
            typeInt: number
        ): Promise<boolean>;
        GetVRChatRegistry(): Promise<Record<string, Record<string, any>>>;
        SetVRChatRegistry(json: string): Promise<void>;
        HasVRChatRegistryFolder(): Promise<boolean>;
        DeleteVRChatRegistryFolder(): Promise<void>;
        ReadVrcRegJsonFile(filepath: string): Promise<string>;

        PopulateImageHosts(json: string): Promise<void>;
        GetImage(url: string, fileId: string, version: string): Promise<string>;
        ResizeImageToFitLimits(base64data: string): Promise<string>;
        CropAllPrints(ugcFolderPath: string): Promise<void>;
        CropPrintImage(path: string): Promise<boolean>;
        SavePrintToFile(
            url: string,
            ugcFolderPath: string,
            monthFolder: string,
            fileName: string
        ): Promise<string>;
        SaveStickerToFile(
            url: string,
            ugcFolderPath: string,
            monthFolder: string,
            fileName: string
        ): Promise<string>;
        SaveEmojiToFile(
            url: string,
            ugcFolderPath: string,
            monthFolder: string,
            fileName: string
        ): Promise<string>;

        AddScreenshotMetadata(
            path: string,
            metadataString: string,
            worldId: string,
            changeFilename?: boolean
        ): Promise<string>;
        GetExtraScreenshotData(
            path: string,
            carouselCache: boolean
        ): Promise<string>;
        GetScreenshotMetadata(path: string): Promise<string>;
        FindScreenshotsBySearch(
            searchQuery: string,
            searchType?: number
        ): Promise<string>;
        GetLastScreenshot(): Promise<string>;
        DeleteScreenshotMetadata(path: string): Promise<boolean>;
        DeleteAllScreenshotMetadata(): Promise<void>;

        GetVRChatModerations(
            currentUserId: string
        ): Promise<Record<string, number> | null>;
        GetVRChatUserModeration(
            currentUserId: string,
            userId: string
        ): Promise<number>;
        SetVRChatUserModeration(
            currentUserId: string,
            userId: string,
            type: number
        ): Promise<boolean>;

        ReadConfigFile(): Promise<string>;
        ReadConfigFileSafe(): Promise<string>;
        WriteConfigFile(json: string): Promise<void>;

        DownloadUpdate(
            fileUrl: string,
            hashString: string,
            downloadSize: number
        ): Promise<void>;
        CancelUpdate(): Promise<void>;
        CheckUpdateProgress(): Promise<number>;

        XSNotification(
            title: string,
            content: string,
            timeout: number,
            opacity: number,
            image?: string
        ): Promise<void>;
        OVRTNotification(
            hudNotification: boolean,
            wristNotification: boolean,
            title: string,
            body: string,
            timeout: number,
            opacity: number,
            image?: string
        ): Promise<void>;
    };

    const WebApi: {
        ClearCookies(): Promise<void>;
        GetCookies(): Promise<string>;
        SetCookies(cookie: string): Promise<void>;
        Execute(options: any): Promise<{ Item1: number; Item2: string }>;
    };

    const AssetBundleManager: {
        SweepCache(): Promise<string>;
        GetCacheSize(): Promise<number>;
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
        ): Promise<{ Item1: number; Item2: boolean; Item3: string }>;
        DeleteCache(
            fileId: string,
            fileVersion: number,
            variant: string,
            variantVersion: number
        ): Promise<void>;
        DeleteAllCache: () => Promise<void>;
    };

    const webApiService: {
        clearCookies(): Promise<void>;
        getCookies(): Promise<string>;
        setCookies(cookie: string): Promise<void>;
        execute(options: {
            url: string;
            method?: string;
            uploadFilePUT?: boolean;
            fileData?: string;
            fileMIME?: string;
            fileMD5?: string;
            headers?: Record<string, string>;
            data?: any;
        }): Promise<{ status: number; data: string }>;
    };
}

export {};
