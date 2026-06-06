declare global {
    const VERSION: string;
    const VRCX_0_BUILD_LABEL: string;
    const VRCX_0_BUILD_BADGE: string;
    const VRCX_0_TELEMETRY_ENABLED: boolean;
    const VRCX_0_TELEMETRY_ENDPOINT: string;
    const VRCX_0_BUNDLED_CJK_FONTS_ENABLED: boolean;

    interface Window {
        $debug?: AppDebug;
        __TAURI_INTERNALS__?: unknown;
        __VRCX_BACKGROUND_ROUTE_RESUME_PENDING__?: boolean;
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

declare module 'react' {
    interface CSSProperties {
        [key: `--${string}`]: string | number | undefined;
    }
}

declare module 'lucide-react' {
    interface LucideProps {
        title?: string;
    }
}
