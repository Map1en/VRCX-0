import { create } from 'zustand';

type FavoriteImportType = 'avatar' | 'world' | 'friend';
type FavoriteImportRow = {
    id: string;
    [key: string]: unknown;
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
    openDialog(options?: { type?: unknown; input?: unknown }): void;
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

export const useFavoriteImportStore = create<FavoriteImportStore>(
    (set: any) => ({
        ...initialState,
        openDialog({ type, input = '' }: any = {}) {
            set((state: any) => ({
                ...initialState,
                open: true,
                type: normalizeType(type),
                input: typeof input === 'string' ? input : String(input ?? ''),
                sessionId: state.sessionId + 1
            }));
        },
        closeDialog() {
            set((state: any) => ({
                ...state,
                open: false,
                loading: false
            }));
        },
        cancelActiveWork() {
            set((state: any) => ({
                ...state,
                loading: false,
                progress: 0,
                progressTotal: 0,
                importProgress: 0,
                importProgressTotal: 0,
                sessionId: state.sessionId + 1
            }));
        },
        setInput(input: any) {
            set({
                input: typeof input === 'string' ? input : String(input ?? '')
            });
        },
        setLoading(loading: any) {
            set({ loading: Boolean(loading) });
        },
        setProgress(progress: any, progressTotal: any) {
            set({ progress, progressTotal });
        },
        setImportProgress(importProgress: any, importProgressTotal: any) {
            set({ importProgress, importProgressTotal });
        },
        setErrors(errors: any) {
            set({
                errors:
                    typeof errors === 'string' ? errors : String(errors ?? '')
            });
        },
        appendError(error: any) {
            const text =
                typeof error === 'string' ? error : String(error ?? '');
            if (!text) {
                return;
            }
            set((state: any) => ({
                errors: `${state.errors || ''}${text}${text.endsWith('\n') ? '' : '\n'}`
            }));
        },
        setRows(rows: any) {
            set({ rows: Array.isArray(rows) ? rows : [] });
        },
        addRow(row: any) {
            if (!row?.id) {
                return;
            }
            set((state: any) => {
                if (state.rows.some((entry: any) => entry.id === row.id)) {
                    return state;
                }
                return { rows: [...state.rows, row] };
            });
        },
        removeRow(id: any) {
            set((state: any) => ({
                rows: state.rows.filter((row: any) => row.id !== id)
            }));
        },
        clearRows() {
            set({ rows: [] });
        },
        setRemoteGroupName(remoteGroupName: any) {
            set({
                remoteGroupName,
                localGroupName: remoteGroupName ? '' : ''
            });
        },
        setLocalGroupName(localGroupName: any) {
            set({
                localGroupName,
                remoteGroupName: localGroupName ? '' : ''
            });
        },
        resetImportState() {
            set((state: any) => ({
                ...initialState,
                open: state.open,
                type: state.type
            }));
        }
    })
);
