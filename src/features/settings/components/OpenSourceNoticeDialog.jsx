import { useEffect, useMemo, useState } from 'react';

import { openExternalLink } from '@/lib/entityMedia.js';
import { Button } from '@/ui/shadcn/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/shadcn/card.jsx';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog.jsx';
import { Input } from '@/ui/shadcn/input.jsx';

function buildAssetUrl(relativePath) {
    return new URL(relativePath, window.location.href).toString();
}

export function OpenSourceNoticeDialog({ open, onOpenChange, t }) {
    const [entries, setEntries] = useState([]);
    const [noticePath, setNoticePath] = useState('licenses/THIRD_PARTY_NOTICES.txt');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEntryId, setSelectedEntryId] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const filteredEntries = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) {
            return entries;
        }
        return entries.filter((entry) =>
            [
                entry.name,
                entry.version,
                entry.license,
                entry.sourceLabel,
                ...(Array.isArray(entry.projects) ? entry.projects : [])
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(query)
        );
    }, [entries, searchQuery]);
    const selectedEntry = filteredEntries.find((entry) => entry.id === selectedEntryId) || filteredEntries[0] || null;

    useEffect(() => {
        if (!open || loaded || loading) {
            return;
        }
        let active = true;
        setLoading(true);
        setLoadError(false);
        fetch(buildAssetUrl('licenses/third-party-licenses.json'), { cache: 'no-store' })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load third-party license manifest: ${response.status}`);
                }
                return response.json();
            })
            .then((manifest) => {
                if (!active) {
                    return;
                }
                const nextEntries = Array.isArray(manifest.entries) ? manifest.entries : [];
                setEntries(nextEntries);
                setNoticePath(manifest.noticePath || 'licenses/THIRD_PARTY_NOTICES.txt');
                setSelectedEntryId(nextEntries[0]?.id || '');
                setLoaded(true);
            })
            .catch(() => {
                if (active) {
                    setLoadError(true);
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [loaded, loading, open]);

    useEffect(() => {
        if (!filteredEntries.some((entry) => entry.id === selectedEntryId)) {
            setSelectedEntryId(filteredEntries[0]?.id || '');
        }
    }, [filteredEntries, selectedEntryId]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-5xl">
                <DialogHeader>
                    <DialogTitle>{t('dialog.open_source.header')}</DialogTitle>
                    <DialogDescription>
                        {t('dialog.open_source.notice_location_prefix')} <code>{noticePath}</code>
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 space-y-4 overflow-hidden">
                    <Input
                        value={searchQuery}
                        placeholder={t('dialog.open_source.search_placeholder')}
                        onChange={(event) => setSearchQuery(event.target.value)}
                    />
                    {loading ? (
                        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                            {t('dialog.open_source.loading')}
                        </div>
                    ) : loadError ? (
                        <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                            {t('dialog.open_source.unavailable')}
                        </div>
                    ) : (
                        <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                            <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
                                {filteredEntries.map((entry) => (
                                    <button
                                        key={entry.id}
                                        type="button"
                                        className={`w-full rounded-md border p-3 text-left text-sm hover:bg-muted/40 ${entry.id === selectedEntry?.id ? 'border-primary bg-accent' : ''}`}
                                        onClick={() => setSelectedEntryId(entry.id)}>
                                        <span className="block truncate font-medium">{entry.name}</span>
                                        <span className="block truncate text-xs text-muted-foreground">
                                            {entry.version || t('dialog.open_source.no_version')}{' \u00b7 '}{entry.license}
                                        </span>
                                    </button>
                                ))}
                                {!filteredEntries.length ? (
                                    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                                        {t('dialog.open_source.no_results')}
                                    </div>
                                ) : null}
                            </div>
                            <Card className="min-h-[30rem]">
                                {selectedEntry ? (
                                    <>
                                        <CardHeader>
                                            <CardTitle>{selectedEntry.name}</CardTitle>
                                            <CardDescription>
                                                {selectedEntry.license}{' \u00b7 '}{selectedEntry.sourceLabel || ''}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-3">
                                            <div className="flex flex-wrap gap-2">
                                                {selectedEntry.projectUrl ? (
                                                    <Button type="button" size="sm" variant="outline" onClick={() => void openExternalLink(selectedEntry.projectUrl)}>
                                                        {t('dialog.open_source.open_project')}
                                                    </Button>
                                                ) : null}
                                                {selectedEntry.licenseUrl ? (
                                                    <Button type="button" size="sm" variant="outline" onClick={() => void openExternalLink(selectedEntry.licenseUrl)}>
                                                        {t('dialog.open_source.open_license_url')}
                                                    </Button>
                                                ) : null}
                                            </div>
                                            {selectedEntry.noticeText ? (
                                                <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
                                                    {selectedEntry.noticeText}
                                                </pre>
                                            ) : (
                                                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                                                    {t('dialog.open_source.notice_unavailable')}
                                                </div>
                                            )}
                                        </CardContent>
                                    </>
                                ) : (
                                    <CardContent className="flex min-h-[30rem] items-center justify-center text-sm text-muted-foreground">
                                        {t('dialog.open_source.select_package')}
                                    </CardContent>
                                )}
                            </Card>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
