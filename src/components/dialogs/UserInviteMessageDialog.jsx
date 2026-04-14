import { useEffect, useRef, useState } from 'react';
import { LoaderCircleIcon, RefreshCwIcon } from 'lucide-react';

import { toolsRepository } from '@/repositories/index.js';
import { Button } from '@/ui/shadcn/button.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';

function normalizeRows(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (Array.isArray(value?.messages)) {
        return value.messages;
    }
    if (value && typeof value === 'object') {
        return Object.values(value).filter((row) => row && typeof row === 'object');
    }
    return [];
}

function UserInviteMessageDialog({
    open,
    onOpenChange,
    currentUserId,
    endpoint,
    messageType = 'message',
    title,
    description,
    sending = false,
    onSelect
}) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const requestIdRef = useRef(0);

    async function loadRows() {
        if (!open) {
            return;
        }
        if (!currentUserId) {
            requestIdRef.current += 1;
            setRows([]);
            setError('No current user session is available.');
            setLoading(false);
            return;
        }
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError('');
        try {
            const response = await toolsRepository.getInviteMessages({
                currentUserId,
                messageType
            }, { endpoint });
            if (requestIdRef.current !== requestId) {
                return;
            }
            setRows(normalizeRows(response));
        } catch (nextError) {
            if (requestIdRef.current !== requestId) {
                return;
            }
            setError(nextError instanceof Error ? nextError.message : 'Failed to load invite messages.');
            setRows([]);
        } finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        if (open) {
            void loadRows();
        } else {
            requestIdRef.current += 1;
            setRows([]);
            setError('');
            setLoading(false);
        }
    }, [currentUserId, endpoint, messageType, open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[min(92vw,48rem)]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-auto rounded-md border">
                    <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-background">
                            <tr className="border-b">
                                <th className="w-24 px-3 py-2">Slot</th>
                                <th className="px-3 py-2">Message</th>
                                <th className="w-40 px-3 py-2">Updated</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">
                                        <LoaderCircleIcon className="mr-2 inline size-4 animate-spin" />
                                        Loading...
                                    </td>
                                </tr>
                            ) : error ? (
                                <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-destructive">{error}</td></tr>
                            ) : rows.length ? rows.map((row, index) => (
                                <tr
                                    key={`${row?.slot ?? index}`}
                                    className="cursor-pointer border-b last:border-b-0 hover:bg-muted/50"
                                    onClick={() => onSelect?.(row)}>
                                    <td className="px-3 py-2 font-mono text-xs">{row?.slot ?? index}</td>
                                    <td className="px-3 py-2">{row?.message || row?.text || '—'}</td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground">{row?.updatedAt || row?.updated_at || '—'}</td>
                                </tr>
                            )) : (
                                <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">No invite messages.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" disabled={loading || sending} onClick={() => void loadRows()}>
                        <RefreshCwIcon className="size-3.5" />
                        Refresh
                    </Button>
                    <Button type="button" variant="secondary" disabled={sending} onClick={() => onOpenChange?.(false)}>
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export { UserInviteMessageDialog };
