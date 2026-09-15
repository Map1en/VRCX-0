import type { LoadStatus } from '@/domain/shared/types';
import type { RemoteModerationRow } from '@/platform/tauri/bindings';

export type ModerationLoadStatus = LoadStatus;

export type ModerationRow = RemoteModerationRow;

export type ModerationUserTarget = {
    userId?: string;
    title?: string;
};

export type DeleteModerationOptions = {
    skipConfirm?: boolean;
};
