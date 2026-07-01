import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';

import { postTelemetry } from './telemetryClient';
import {
    TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY,
    isAnonymousUsageTelemetryEnabled
} from './telemetryConfig';
import {
    recordTelemetryErrorDetail,
    serializeTelemetryErrorDetails
} from './telemetryErrorDetails';
import { buildTelemetryContext } from './telemetryPayload';
import type {
    TelemetryClientErrorPayload,
    TelemetryErrorDetail,
    TelemetryErrorDetailKind,
    TelemetrySessionState
} from './telemetryTypes';

const MAX_DRAIN_LIMIT = 100;
const MAX_UPLOAD_DETAILS = 20;

const pendingDetails = new Map<string, TelemetryErrorDetail>();
let pendingCursor: string | null = null;

function errorKindForSource(source: string): TelemetryErrorDetailKind | null {
    if (source === 'rust:panic') {
        return 'panic';
    }
    if (source === 'rust:tracing') {
        return 'rust_error';
    }
    return null;
}

function latestIso(left: string | null, right: string): string {
    return left === null || right > left ? right : left;
}

async function currentDrainCursor(): Promise<string> {
    if (pendingCursor) {
        return pendingCursor;
    }
    return (
        await configRepository.getString(
            TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY,
            ''
        )
    ).trim();
}

async function drainRustErrors(): Promise<void> {
    const sinceIso = await currentDrainCursor();
    const entries = await commands.appDrainClientErrorLog(
        sinceIso || null,
        MAX_DRAIN_LIMIT
    );
    for (const entry of entries) {
        if (sinceIso && entry.tsIso <= sinceIso) {
            continue;
        }
        pendingCursor = latestIso(pendingCursor, entry.tsIso);
        const kind = errorKindForSource(entry.source);
        const appVersion = entry.appVersion?.trim();
        if (!kind || !appVersion) {
            continue;
        }
        recordTelemetryErrorDetail(pendingDetails, {
            kind,
            source: entry.source,
            summary: entry.message,
            appVersion
        });
    }
}

async function advanceCursor(): Promise<void> {
    if (pendingCursor) {
        await configRepository.setString(
            TELEMETRY_CLIENT_ERROR_CURSOR_CONFIG_KEY,
            pendingCursor
        );
        pendingCursor = null;
    }
}

export async function seedRustErrors(): Promise<void> {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    await drainRustErrors();
}

export async function sendRustErrors(
    session: TelemetrySessionState
): Promise<void> {
    if (!isAnonymousUsageTelemetryEnabled()) {
        return;
    }
    await drainRustErrors();
    const all = serializeTelemetryErrorDetails(
        pendingDetails,
        pendingDetails.size
    );
    if (!all?.length) {
        await advanceCursor();
        return;
    }
    const context = buildTelemetryContext(session);
    for (let index = 0; index < all.length; index += MAX_UPLOAD_DETAILS) {
        const payload: TelemetryClientErrorPayload = {
            ...context,
            errors: all.slice(index, index + MAX_UPLOAD_DETAILS)
        };
        await postTelemetry('/api/v1/telemetry/client-error', payload);
    }
    await advanceCursor();
}

export function resetRustErrors(): void {
    pendingDetails.clear();
    pendingCursor = null;
}
