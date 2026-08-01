import { create } from 'zustand';

type FavoriteImportType = 'avatar' | 'world' | 'friend';
export type FavoriteImportRow = {
    id: string;
    [key: string]: unknown;
};
type FavoriteImportOpenOptions = {
    type?: unknown;
    input?: unknown;
};
type FavoriteImportStore = {
    open: boolean;
    type: FavoriteImportType;
    input: string;
    rows: FavoriteImportRow[];
    loading: boolean;
    progress: number;
    progressTotal: number;
    importProgress: number;
    importProgressTotal: number;
    errors: string;
    remoteGroupName: string;
    localGroupName: string;
    sessionId: number;
    openDialog(options?: FavoriteImportOpenOptions): void;
    closeDialog(): void;
    cancelActiveWork(): void;
    setInput(input: unknown): void;
    setLoading(loading: unknown): void;
    setProgress(progress: number, progressTotal: number): void;
    setImportProgress(
        importProgress: number,
        importProgressTotal: number
    ): void;
    setErrors(errors: unknown): void;
    appendError(error: unknown): void;
    setRows(rows: unknown): void;
    addRow(row: FavoriteImportRow | null | undefined): void;
    removeRow(id: string): void;
    clearRows(): void;
    setRemoteGroupName(remoteGroupName: string): void;
    setLocalGroupName(localGroupName: string): void;
    resetImportState(): void;
};

type FavoriteImportState = Pick<
    FavoriteImportStore,
    | 'open'
    | 'type'
    | 'input'
    | 'rows'
    | 'loading'
    | 'progress'
    | 'progressTotal'
    | 'importProgress'
    | 'importProgressTotal'
    | 'errors'
    | 'remoteGroupName'
    | 'localGroupName'
    | 'sessionId'
>;

const initialState: FavoriteImportState = {
    open: false,
    type: 'avatar',
    input: '',
    rows: [],
    loading: false,
    progress: 0,
    progressTotal: 0,
    importProgress: 0,
    importProgressTotal: 0,
    errors: '',
    remoteGroupName: '',
    localGroupName: '',
    sessionId: 0
};

function normalizeType(value: unknown): FavoriteImportType {
    return value === 'avatar' || value === 'world' || value === 'friend'
        ? value
        : 'avatar';
}

function isFavoriteImportRow(value: unknown): value is FavoriteImportRow {
    return Boolean(
        value &&
        typeof value === 'object' &&
        typeof Reflect.get(value, 'id') === 'string'
    );
}

function normalizeRows(value: unknown): FavoriteImportRow[] {
    return Array.isArray(value) ? value.filter(isFavoriteImportRow) : [];
}

export const useFavoriteImportStore = create<FavoriteImportStore>((set) => ({
    ...initialState,
    openDialog({ type, input = '' }: FavoriteImportOpenOptions = {}) {
        set((state) => {
            return {
                ...initialState,
                open: true,
                type: normalizeType(type),
                input: typeof input === 'string' ? input : String(input ?? ''),
                sessionId: state.sessionId + 1
            };
        });
    },
    closeDialog() {
        set((state) => ({
            ...state,
            open: false,
            loading: false
        }));
    },
    cancelActiveWork() {
        set((state) => ({
            ...state,
            loading: false,
            progress: 0,
            progressTotal: 0,
            importProgress: 0,
            importProgressTotal: 0,
            sessionId: state.sessionId + 1
        }));
    },
    setInput(input) {
        set({
            input: typeof input === 'string' ? input : String(input ?? '')
        });
    },
    setLoading(loading) {
        set({ loading: Boolean(loading) });
    },
    setProgress(progress, progressTotal) {
        set({ progress, progressTotal });
    },
    setImportProgress(importProgress, importProgressTotal) {
        set({ importProgress, importProgressTotal });
    },
    setErrors(errors) {
        set({
            errors: typeof errors === 'string' ? errors : String(errors ?? '')
        });
    },
    appendError(error) {
        const text = typeof error === 'string' ? error : String(error ?? '');
        if (!text) {
            return;
        }
        set((state) => ({
            errors: `${state.errors || ''}${text}${text.endsWith('\n') ? '' : '\n'}`
        }));
    },
    setRows(rows) {
        set({ rows: normalizeRows(rows) });
    },
    addRow(row) {
        if (!row?.id) {
            return;
        }
        set((state) => {
            if (state.rows.some((entry) => entry.id === row.id)) {
                return state;
            }
            return { rows: [...state.rows, row] };
        });
    },
    removeRow(id) {
        set((state) => ({
            rows: state.rows.filter((row) => row.id !== id)
        }));
    },
    clearRows() {
        set({ rows: [] });
    },
    setRemoteGroupName(remoteGroupName) {
        set({
            remoteGroupName,
            localGroupName: remoteGroupName ? '' : ''
        });
    },
    setLocalGroupName(localGroupName) {
        set({
            localGroupName,
            remoteGroupName: localGroupName ? '' : ''
        });
    },
    resetImportState() {
        set((state) => ({
            ...initialState,
            open: state.open,
            type: state.type
        }));
    }
}));
