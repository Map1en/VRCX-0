import { HeartIcon, LanguagesIcon, StarIcon } from 'lucide-react';
import {
    type ComponentPropsWithoutRef,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { formatDateFilter } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { useActiveScrollSection } from '@/lib/useActiveScrollSection';
import {
    buildChangelogSections,
    fetchChangelogReleases,
    findChangelogRelease,
    getCurrentVersion,
    resolvePreferredChangelogLanguage,
    type ChangelogSection
} from '@/services/changelogService';
import { openExternalLink } from '@/services/entityMediaService';
import { links } from '@/shared/constants/link';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

function MarkdownLink({
    href,
    children,
    ...props
}: ComponentPropsWithoutRef<'a'>) {
    return (
        <a
            {...props}
            href={href}
            className="text-primary hover:text-primary/80 break-all underline underline-offset-3"
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
    h1: ({ children }: ComponentPropsWithoutRef<'h1'>) => (
        <h1 className="mt-4 mb-2 text-xl font-semibold first:mt-0">
            {children}
        </h1>
    ),
    h2: ({ children }: ComponentPropsWithoutRef<'h2'>) => (
        <h2 className="mt-4 mb-2 text-lg font-semibold first:mt-0">
            {children}
        </h2>
    ),
    h3: ({ children }: ComponentPropsWithoutRef<'h3'>) => (
        <h3 className="mt-3 mb-2 text-base font-semibold first:mt-0">
            {children}
        </h3>
    ),
    h4: ({ children }: ComponentPropsWithoutRef<'h4'>) => (
        <h4 className="mt-3 mb-2 text-sm font-semibold first:mt-0">
            {children}
        </h4>
    ),
    p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
        <p className="text-foreground/90 my-2 leading-relaxed first:mt-0 last:mb-0">
            {children}
        </p>
    ),
    ul: ({ children }: ComponentPropsWithoutRef<'ul'>) => (
        <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }: ComponentPropsWithoutRef<'ol'>) => (
        <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }: ComponentPropsWithoutRef<'li'>) => (
        <li className="text-foreground/90 leading-relaxed">{children}</li>
    ),
    blockquote: ({ children }: ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote className="border-border text-muted-foreground my-2 border-l-2 pl-3">
            {children}
        </blockquote>
    ),
    code: ({
        inline,
        children
    }: ComponentPropsWithoutRef<'code'> & { inline?: boolean }) =>
        inline ? (
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
                {children}
            </code>
        ) : (
            <code className="font-mono text-xs whitespace-pre-wrap">
                {children}
            </code>
        ),
    pre: ({ children }: ComponentPropsWithoutRef<'pre'>) => (
        <pre className="bg-muted my-2 max-w-full overflow-x-auto rounded-md p-3">
            {children}
        </pre>
    ),
    table: ({ children }: ComponentPropsWithoutRef<'table'>) => (
        <div className="my-2 max-w-full overflow-x-auto">
            <table className="text-xs">{children}</table>
        </div>
    )
} satisfies Components;

export function ChangelogMarkdown({ children }: { children: string }) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            skipHtml
            components={markdownComponents}
        >
            {children}
        </ReactMarkdown>
    );
}

const SECTION_ATTRIBUTE = 'data-changelog-section';

function ChangelogReleaseSection({
    section,
    language,
    isCurrent
}: {
    section: ChangelogSection;
    language: string;
    isCurrent: boolean;
}) {
    const { t } = useTranslation();
    const preferredLanguage = resolvePreferredChangelogLanguage(
        section.entries,
        language
    );
    const entry =
        section.entries.find((item) => item.lang === preferredLanguage) ??
        section.entries[0];
    const publishedAt = section.release.publishedAt
        ? formatDateFilter(section.release.publishedAt, 'date')
        : '';

    return (
        <section
            data-changelog-section={section.id}
            className="border-stroke-subtle flex flex-col gap-2 border-b pb-6 last:border-b-0"
        >
            <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-base font-semibold tabular-nums">
                    {section.release.canonicalVersion}
                </h3>
                {publishedAt ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                        {publishedAt}
                    </span>
                ) : null}
                {isCurrent ? (
                    <Badge variant="secondary">
                        {t('dialog.change_log.current_version')}
                    </Badge>
                ) : null}
            </div>
            {section.note ? (
                <div className="bg-muted/40 text-foreground/90 rounded-md border px-3 py-2">
                    <ChangelogMarkdown>{section.note}</ChangelogMarkdown>
                </div>
            ) : null}
            <div className="min-w-0 break-words">
                {entry?.markdown ? (
                    <ChangelogMarkdown>{entry.markdown}</ChangelogMarkdown>
                ) : (
                    <div className="text-muted-foreground">
                        {t('dialog.change_log.empty')}
                    </div>
                )}
            </div>
        </section>
    );
}

export function ChangelogDialog({
    open,
    onOpenChange,
    targetVersion
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    targetVersion?: string;
}) {
    const { i18n, t } = useTranslation();
    const [sections, setSections] = useState<ChangelogSection[]>([]);
    const [currentId, setCurrentId] = useState<string | null>(null);
    const [targetId, setTargetId] = useState<string | null>(null);
    const [activeLanguage, setActiveLanguage] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        let active = true;
        setLoading(true);
        setError('');
        setSections([]);
        setCurrentId(null);
        setTargetId(null);
        setActiveLanguage('');

        fetchChangelogReleases(targetVersion)
            .then((releases) => {
                if (!active) {
                    return;
                }

                const nextSections = buildChangelogSections(releases);
                setSections(nextSections);
                setCurrentId(
                    findChangelogRelease(releases, getCurrentVersion())
                        ?.canonicalVersion ?? null
                );
                setTargetId(
                    findChangelogRelease(releases, targetVersion)
                        ?.canonicalVersion ?? null
                );
                setActiveLanguage(
                    resolvePreferredChangelogLanguage(
                        nextSections.flatMap((section) => section.entries),
                        i18n.resolvedLanguage || i18n.language
                    )
                );
            })
            .catch((nextError: unknown) => {
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
    }, [i18n.language, i18n.resolvedLanguage, open, t, targetVersion]);

    const sectionIds = useMemo(
        () => sections.map((section) => section.id),
        [sections]
    );
    const { activeId, scrollTo } = useActiveScrollSection(
        scrollRef,
        sectionIds,
        SECTION_ATTRIBUTE
    );

    useEffect(() => {
        if (targetId && targetId !== sectionIds[0]) {
            scrollTo(targetId);
        }
    }, [scrollTo, sectionIds, targetId]);

    const languageOptions = useMemo(() => {
        const labels = new Map<string, string>();
        for (const section of sections) {
            for (const entry of section.entries) {
                if (!labels.has(entry.lang)) {
                    labels.set(entry.lang, entry.label);
                }
            }
        }
        return Array.from(labels, ([value, label]) => ({ value, label }));
    }, [sections]);

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            onOpenChangeComplete={(nextOpen) => {
                if (!nextOpen && !open) {
                    setSections([]);
                }
            }}
        >
            <DialogContent className="grid h-[min(85vh,820px)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-5xl">
                <DialogHeader className="flex-row items-center justify-between gap-3 pr-8">
                    <DialogTitle>{t('dialog.change_log.header')}</DialogTitle>
                    {languageOptions.length > 1 ? (
                        <Select
                            value={activeLanguage}
                            items={languageOptions}
                            onValueChange={(value) => {
                                if (value) {
                                    setActiveLanguage(value);
                                }
                            }}
                        >
                            <SelectTrigger
                                size="sm"
                                aria-label={t('dialog.change_log.language')}
                            >
                                <LanguagesIcon className="text-muted-foreground" />
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {languageOptions.map((option) => (
                                        <SelectItem
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    ) : null}
                </DialogHeader>

                {loading ? (
                    <div className="text-muted-foreground flex items-center justify-center gap-2">
                        <Spinner />
                        <span>{t('dialog.change_log.loading')}</span>
                    </div>
                ) : error ? (
                    <div className="text-muted-foreground self-start rounded-md border p-3 text-sm">
                        {error}
                    </div>
                ) : sections.length ? (
                    <div className="grid min-h-0 grid-cols-[9rem_minmax(0,1fr)] gap-4">
                        <Tabs
                            orientation="vertical"
                            value={activeId}
                            onValueChange={scrollTo}
                            className="min-h-0 overflow-y-auto"
                        >
                            <TabsList
                                aria-label={t('dialog.change_log.versions')}
                                className="h-fit w-full gap-0.5"
                            >
                                {sections.map((section) => (
                                    <TabsTrigger
                                        key={section.id}
                                        value={section.id}
                                        className="justify-start px-2.5 tabular-nums"
                                    >
                                        <span className="truncate">
                                            {section.release.canonicalVersion}
                                        </span>
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                        <div
                            ref={scrollRef}
                            className="relative min-h-0 overflow-x-hidden overflow-y-auto pr-2"
                        >
                            <div className="flex flex-col gap-6 pt-px">
                                {sections.map((section) => (
                                    <ChangelogReleaseSection
                                        key={section.id}
                                        section={section}
                                        language={activeLanguage}
                                        isCurrent={section.id === currentId}
                                    />
                                ))}
                                <div className="text-muted-foreground pb-2 text-center text-xs">
                                    {t('dialog.change_log.older_releases')}
                                    {' · '}
                                    <MarkdownLink href={links.releases}>
                                        {t('dialog.change_log.view_on_github')}
                                    </MarkdownLink>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-muted-foreground self-start rounded-md border p-3 text-sm">
                        {t('dialog.change_log.empty')}
                    </div>
                )}

                <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 text-left">
                        <div className="text-sm font-medium">
                            {t('dialog.change_log.support_title')}
                        </div>
                        <div className="text-muted-foreground text-xs leading-relaxed">
                            {t('dialog.change_log.support_description')}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                                openExternalLink(links.githubSponsors);
                            }}
                        >
                            <HeartIcon data-icon="inline-start" />
                            {t('dialog.change_log.support_development')}
                        </Button>
                        <Button
                            type="button"
                            onClick={() => {
                                openExternalLink(links.github);
                            }}
                        >
                            <StarIcon data-icon="inline-start" />
                            {t('dialog.change_log.star_on_github')}
                        </Button>
                        <DialogClose
                            render={
                                <Button type="button" variant="outline">
                                    {t('common.actions.close')}
                                </Button>
                            }
                        />
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
