import { compareReleaseVersions } from '@/shared/utils/releaseVersion';

export type TelemetryErrorDetailKind =
    | 'load_fail'
    | 'render_crash'
    | 'tool_error'
    | 'turn_error'
    | 'panic'
    | 'rust_error';

export type TelemetryErrorDetailInput = {
    kind: TelemetryErrorDetailKind;
    source?: string;
    code?: string;
    name?: string;
    summary?: string;
    appVersion?: string;
};

export type TelemetryErrorDetail = {
    kind: TelemetryErrorDetailKind;
    source?: string;
    code?: string;
    name?: string;
    summary?: string;
    signature: string;
    appVersion?: string;
    count: number;
};

const MAX_SUMMARY_LENGTH = 160;
const MAX_TOKEN_LENGTH = 64;

const vrchatIdPattern =
    /\b(?:usr|wrld|avtr|grp|file|vol|inst|auth|not|rgn|prn)_[A-Za-z0-9-]+\b/g;
const uuidPattern =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const longHexPattern = /\b[0-9a-f]{24,}\b/gi;
const windowsPathPattern = /[A-Za-z]:\\[^\s'"`<>]+/g;
const slashPathPattern = /(?:^|\s)\/[^\s'"`<>]+(?:\/[^\s'"`<>]+)+/g;
const urlPattern = /\bhttps?:\/\/[^\s'"`<>]+/gi;

export function sanitizeTelemetryErrorSummary(value: unknown): string {
    return String(value ?? '')
        .replace(urlPattern, '<url>')
        .replace(windowsPathPattern, '<path>')
        .replace(slashPathPattern, ' <path>')
        .replace(vrchatIdPattern, '<id>')
        .replace(uuidPattern, '<uuid>')
        .replace(longHexPattern, '<hash>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_SUMMARY_LENGTH);
}

export function sanitizeTelemetryErrorToken(value: unknown): string {
    return String(value ?? '')
        .trim()
        .replace(/[^A-Za-z0-9_.:-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, MAX_TOKEN_LENGTH);
}

export function sanitizeTelemetryAppVersion(value: unknown): string {
    return String(value ?? '')
        .trim()
        .replace(/[^A-Za-z0-9._+-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, MAX_TOKEN_LENGTH);
}

function hashString(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildTelemetryErrorDetail(
    input: TelemetryErrorDetailInput
): TelemetryErrorDetail {
    const source = sanitizeTelemetryErrorToken(input.source);
    const code = sanitizeTelemetryErrorToken(input.code);
    const name = sanitizeTelemetryErrorToken(input.name);
    const summary = sanitizeTelemetryErrorSummary(input.summary);
    const appVersion = sanitizeTelemetryAppVersion(input.appVersion);
    const stableParts = [
        input.kind,
        source || '-',
        code || '-',
        name || '-',
        summary || '-'
    ];
    const detail: TelemetryErrorDetail = {
        kind: input.kind,
        signature: `${input.kind}:${hashString(stableParts.join('|'))}`,
        count: 1
    };
    if (source) {
        detail.source = source;
    }
    if (code) {
        detail.code = code;
    }
    if (name) {
        detail.name = name;
    }
    if (summary) {
        detail.summary = summary;
    }
    if (appVersion) {
        detail.appVersion = appVersion;
    }
    return detail;
}

export function recordTelemetryErrorDetail(
    details: Map<string, TelemetryErrorDetail>,
    input: TelemetryErrorDetailInput
): void {
    const detail = buildTelemetryErrorDetail(input);
    const detailKey = detail.appVersion
        ? `${detail.appVersion}:${detail.signature}`
        : detail.signature;
    const existing = details.get(detailKey);
    if (existing) {
        existing.count += 1;
    } else {
        details.set(detailKey, detail);
    }
}

export function serializeTelemetryErrorDetails(
    details: Map<string, TelemetryErrorDetail>,
    limit = 10
): TelemetryErrorDetail[] | undefined {
    if (details.size === 0) {
        return undefined;
    }
    return [...details.values()]
        .sort(
            (a, b) =>
                b.count - a.count ||
                compareReleaseVersions(
                    a.appVersion ?? '',
                    b.appVersion ?? ''
                ) ||
                a.signature.localeCompare(b.signature)
        )
        .slice(0, limit);
}
