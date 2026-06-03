import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { openExternalLink } from '@/services/entityMediaService';
import {
    fetchLatestChangelogRelease,
    parseChangelog,
    resolvePreferredChangelogLanguage,
    type LocalizedChangelogEntry
} from '@/services/changelogService';
import { links } from '@/shared/constants/link';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

function MarkdownLink({ href, children, ...props }: any) {
    return (
        <a
            {...props}
            href={href}
            className="text-primary underline underline-offset-3 hover:text-primary/80"
            onClick={(event) => {
                event.preventDefault();
                openExternalLink(href);
            }}
        >
            {children}
        </a>
    );
}

const markdownComponents = {
    a: MarkdownLink,
    h1: ({ children }: any) => (
        <h1 className="mt-4 mb-2 text-xl font-semibold first:mt-0">
            {children}
        </h1>
    ),
    h2: ({ children }: any) => (
        <h2 className="mt-4 mb-2 text-lg font-semibold first:mt-0">
            {children}
        </h2>
    ),
    h3: ({ children }: any) => (
        <h3 className="mt-3 mb-2 text-base font-semibold first:mt-0">
            {children}
        </h3>
    ),
    h4: ({ children }: any) => (
        <h4 className="mt-3 mb-2 text-sm font-semibold first:mt-0">
            {children}
        </h4>
    ),
    p: ({ children }: any) => (
        <p className="text-foreground/90 my-2 leading-relaxed first:mt-0 last:mb-0">
            {children}
        </p>
    ),
    ul: ({ children }: any) => (
        <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }: any) => (
        <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }: any) => (
        <li className="text-foreground/90 leading-relaxed">{children}</li>
    ),
    blockquote: ({ children }: any) => (
        <blockquote className="border-border text-muted-foreground my-2 border-l-2 pl-3">
            {children}
        </blockquote>
    ),
    code: ({ inline, children }: any) =>
        inline ? (
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
                {children}
            </code>
        ) : (
            <code className="font-mono text-xs whitespace-pre-wrap">
                {children}
            </code>
        ),
    pre: ({ children }: any) => (
        <pre className="bg-muted my-2 overflow-x-auto rounded-md p-3">
            {children}
        </pre>
    )
};

export function ChangelogDialog({ open, onOpenChange }: any) {
    const { i18n, t } = useTranslation();
    const [latestRelease, setLatestRelease] = useState<any>(null);
    const [entries, setEntries] = useState<LocalizedChangelogEntry[]>([]);
    const [note, setNote] = useState('');
    const [activeLanguage, setActiveLanguage] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        setError('');
        setLatestRelease(null);
        setEntries([]);
        setNote('');
        setActiveLanguage('');

        fetchLatestChangelogRelease()
            .then((release: any) => {
                if (!active) {
                    return;
                }

                const parsedChangelog = parseChangelog(release?.body || '');
                const nextEntries = parsedChangelog.entries;
                setLatestRelease(release);
                setEntries(nextEntries);
                setNote(parsedChangelog.note);
                setActiveLanguage(
                    resolvePreferredChangelogLanguage(
                        nextEntries,
                        i18n.language
                    )
                );
            })
            .catch((nextError: any) => {
                if (active) {
                    setError(
                        userFacingErrorMessage(
                            nextError,
                            t('dialog.change_log.failed_to_load')
                        )
                    );
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
    }, [i18n.language, open, t]);

    const selectedEntry = useMemo(
        () =>
            entries.find((entry) => entry.lang === activeLanguage) ||
            entries[0] ||
            null,
        [activeLanguage, entries]
    );
    const releaseName =
        latestRelease?.displayName ||
        latestRelease?.tagName ||
        t('dialog.change_log.latest_release');
    const githubUrl = latestRelease?.htmlUrl || links.releases;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t('dialog.change_log.header')}
                    </DialogTitle>
                    <div className="text-muted-foreground text-sm">
                        {releaseName}
                    </div>
                </DialogHeader>

                {loading ? (
                    <div className="text-muted-foreground flex min-h-48 items-center justify-center gap-2">
                        <Spinner />
                        <span>{t('dialog.change_log.loading')}</span>
                    </div>
                ) : error ? (
                    <div className="text-muted-foreground rounded-md border p-3 text-sm">
                        {error}
                    </div>
                ) : selectedEntry ? (
                    <div className="space-y-3">
                        {note ? (
                            <div className="bg-muted/40 text-foreground/90 rounded-md border px-3 py-2 text-sm">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    skipHtml
                                    components={markdownComponents}
                                >
                                    {note}
                                </ReactMarkdown>
                            </div>
                        ) : null}
                        <Tabs
                            value={activeLanguage}
                            onValueChange={setActiveLanguage}
                        >
                            <TabsList className="max-w-full justify-start overflow-x-auto overflow-y-hidden">
                                {entries.map((entry) => (
                                    <TabsTrigger
                                        key={`${entry.lang}-${entry.tag}`}
                                        value={entry.lang}
                                    >
                                        {entry.label}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                            {entries.map((entry) => (
                                <TabsContent
                                    key={`${entry.lang}-${entry.tag}-content`}
                                    value={entry.lang}
                                >
                                    <ScrollArea className="h-[min(58vh,520px)] rounded-md border">
                                        <div className="p-3 text-sm">
                                            {entry.markdown ? (
                                                <ReactMarkdown
                                                    remarkPlugins={[remarkGfm]}
                                                    skipHtml
                                                    components={
                                                        markdownComponents
                                                    }
                                                >
                                                    {entry.markdown}
                                                </ReactMarkdown>
                                            ) : (
                                                <div className="text-muted-foreground">
                                                    {t(
                                                        'dialog.change_log.empty'
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </ScrollArea>
                                </TabsContent>
                            ))}
                        </Tabs>
                    </div>
                ) : (
                    <div className="text-muted-foreground rounded-md border p-3 text-sm">
                        {t('dialog.change_log.empty')}
                    </div>
                )}

                <DialogFooter showCloseButton>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            openExternalLink(githubUrl);
                        }}
                    >
                        {t('dialog.change_log.github')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
