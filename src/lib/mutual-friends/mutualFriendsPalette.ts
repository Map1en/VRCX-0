const DARK_COMMUNITY_PALETTE = [
    '#7c8cf8',
    '#5ec98d',
    '#e8b45c',
    '#ef7a83',
    '#5fb6e0',
    '#b085e8',
    '#4ec9c0',
    '#f0925e',
    '#e984c4'
];

const LIGHT_COMMUNITY_PALETTE = [
    '#4f5fd9',
    '#2f9e63',
    '#c08321',
    '#d2545f',
    '#2f8fc4',
    '#8a5cd0',
    '#1f9a92',
    '#cf6b32',
    '#c85aa0'
];

export const MUTUAL_GRAPH_NAMED_COMMUNITY_LIMIT = 6;

const DARK_NEUTRAL_COMMUNITY_COLOR = '#6b7280';
const LIGHT_NEUTRAL_COMMUNITY_COLOR = '#a1a8b3';

export interface MutualFriendsGraphTheme {
    communityPalette: string[];
    neutralCommunityColor: string;
    backgroundColor: string;
    edgeColor: string;
    edgeCrossColor: string;
    edgeActiveColor: string;
    labelColor: string;
    emphasisLabelColor: string;
    hoverCardBackground: string;
    hoverCardForeground: string;
    hoverCardMutedForeground: string;
    hoverCardBorder: string;
}

function readCssColor(
    container: HTMLElement | null,
    property: string,
    fallback: string
) {
    if (!container) {
        return fallback;
    }
    const value = getComputedStyle(container).getPropertyValue(property).trim();
    return value || fallback;
}

function resolveCssColorToRgba(value: string, fallback: string) {
    if (!value) {
        return fallback;
    }
    const context = document
        .createElement('canvas')
        .getContext('2d', { willReadFrequently: true });
    if (!context) {
        return fallback;
    }
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    return alpha ? `rgba(${red}, ${green}, ${blue}, ${alpha / 255})` : fallback;
}

export function mutualFriendsCommunityPalette(isDarkMode: boolean) {
    return isDarkMode ? DARK_COMMUNITY_PALETTE : LIGHT_COMMUNITY_PALETTE;
}

export function mutualFriendsNeutralCommunityColor(isDarkMode: boolean) {
    return isDarkMode
        ? DARK_NEUTRAL_COMMUNITY_COLOR
        : LIGHT_NEUTRAL_COMMUNITY_COLOR;
}

export function communityColor(
    palette: string[],
    communityIndex: number,
    isNamed: boolean,
    neutralColor: string
) {
    if (!isNamed || !palette.length) {
        return neutralColor;
    }
    const index = Number.isFinite(communityIndex)
        ? Math.max(0, Math.trunc(communityIndex))
        : 0;
    return palette[index] ?? neutralColor;
}

export function buildMutualFriendsGraphTheme(
    isDarkMode: boolean,
    container: HTMLElement | null = null
): MutualFriendsGraphTheme {
    const labelColor = isDarkMode ? '#e2e8f0' : '#111827';
    return {
        communityPalette: mutualFriendsCommunityPalette(isDarkMode),
        neutralCommunityColor: mutualFriendsNeutralCommunityColor(isDarkMode),
        backgroundColor: isDarkMode ? '#0a0a0a' : '#ffffff',
        edgeColor: isDarkMode ? '#242c37' : '#dfe4ea',
        edgeCrossColor: isDarkMode ? '#4d5f78' : '#a3b0c2',
        edgeActiveColor: isDarkMode ? '#8fa3bd' : '#64748b',
        labelColor,
        emphasisLabelColor: resolveCssColorToRgba(
            readCssColor(
                container ?? document.documentElement,
                '--primary',
                ''
            ),
            labelColor
        ),
        hoverCardBackground: readCssColor(
            container,
            '--popover',
            isDarkMode ? '#1c1c1c' : '#ffffff'
        ),
        hoverCardForeground: readCssColor(
            container,
            '--popover-foreground',
            isDarkMode ? '#fafafa' : '#111827'
        ),
        hoverCardMutedForeground: readCssColor(
            container,
            '--muted-foreground',
            isDarkMode ? '#a1a1a1' : '#6b7280'
        ),
        hoverCardBorder: isDarkMode
            ? 'rgba(255,255,255,0.12)'
            : 'rgba(15,23,42,0.10)'
    };
}
