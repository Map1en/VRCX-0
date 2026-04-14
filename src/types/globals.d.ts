declare global {
    const VERSION: string;

    interface Window {
        $debug?: AppDebug;
        __TAURI_INTERNALS__?: unknown;
    }

    interface AppDebug {
        debug: boolean;
        debugWebSocket: boolean;
        debugUserDiff: boolean;
        debugGameLog: boolean;
        debugWebRequests: boolean;
        debugFriendState: boolean;
        debugIPC: boolean;
        debugVrcPlus: boolean;
        dontLogMeOut: boolean;
        endpointDomain: string;
        endpointDomainVrchat: string;
        websocketDomain: string;
        websocketDomainVrchat: string;
    }
}

export {};
