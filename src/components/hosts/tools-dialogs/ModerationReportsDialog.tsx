import { FlagIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';
import { FadeInImage } from '@/components/media/FadeInImage';
import { formatDateFilter } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import type { ModerationReportType } from '@/platform/tauri/bindings';
import vrchatToolsRepository, {
    type ModerationReportRecord
} from '@/repositories/vrchatToolsRepository';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from '@/services/dialogService';
import { toast } from '@/services/toastService';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { getCurrentUserId } from './toolsDialogUtils';

type ReportTab = 'open' | 'closed';
type ReportTypeFilter = 'all' | ModerationReportType;

const reportTypeFilters: readonly ReportTypeFilter[] = [
    'all',
    'user',
    'world',
    'avatar',
    'group'
];

type LoadState =
    | { status: 'loading' }
    | {
          status: 'ready';
          reports: ModerationReportRecord[];
          hasNext: boolean;
      }
    | { status: 'error'; error: unknown };

const contentTypeLabelKeys: Record<string, string> = {
    user: 'view.search.user.header',
    avatar: 'view.search.avatar.header',
    world: 'view.search.world.header',
    group: 'view.search.group.header'
};

const contentDialogOpeners: Record<string, (contentId: string) => void> = {
    user: (userId) => openUserDialog({ userId }),
    avatar: (avatarId) => openAvatarDialog({ avatarId }),
    world: (worldId) => openWorldDialog({ worldId }),
    group: (groupId) => openGroupDialog({ groupId })
};

function mergeReports(
    current: ModerationReportRecord[],
    next: ModerationReportRecord[]
) {
    const seen = new Set(current.map((report) => report.id));
    return [...current, ...next.filter((report) => !seen.has(report.id))];
}

export function ModerationReportsDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
                {open ? <ModerationReportsDialogBody /> : null}
            </DialogContent>
        </Dialog>
    );
}

function ModerationReportsDialogBody() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<ReportTab>('open');
    const [typeFilter, setTypeFilter] = useState<ReportTypeFilter>('all');
    const typeFilterItems = reportTypeFilters.map((value) => ({
        value,
        label: t(`dialog.moderation_reports.type_filter.${value}`)
    }));

    return (
        <>
            <DialogHeader>
                <DialogTitle>
                    {t('dialog.moderation_reports.header')}
                </DialogTitle>
                <DialogDescription>
                    {t('dialog.moderation_reports.description')}
                </DialogDescription>
            </DialogHeader>
            <Tabs
                value={activeTab}
                onValueChange={(value) => {
                    if (value === 'open' || value === 'closed') {
                        setActiveTab(value);
                    }
                }}
                className="min-h-0"
            >
                <div className="flex items-center justify-between gap-2">
                    <TabsList>
                        <TabsTrigger value="open">
                            {t('dialog.moderation_reports.status_open')}
                        </TabsTrigger>
                        <TabsTrigger value="closed">
                            {t('dialog.moderation_reports.status_closed')}
                        </TabsTrigger>
                    </TabsList>
                    <Select<ReportTypeFilter>
                        value={typeFilter}
                        items={typeFilterItems}
                        onValueChange={(value) => {
                            if (value) {
                                setTypeFilter(value);
                            }
                        }}
                    >
                        <SelectTrigger className="min-w-32 shrink-0">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {typeFilterItems.map((item) => (
                                    <SelectItem
                                        key={item.value}
                                        value={item.value}
                                    >
                                        {item.label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
                <TabsContent
                    value={activeTab}
                    className="flex min-h-0 flex-col"
                >
                    <ModerationReportList
                        key={`${activeTab}:${typeFilter}`}
                        closedOnly={activeTab === 'closed'}
                        reportType={typeFilter === 'all' ? null : typeFilter}
                    />
                </TabsContent>
            </Tabs>
        </>
    );
}

function ModerationReportList({
    closedOnly,
    reportType
}: {
    closedOnly: boolean;
    reportType: ModerationReportType | null;
}) {
    const { t } = useTranslation();
    const [loadState, setLoadState] = useState<LoadState>({
        status: 'loading'
    });
    const [loadingMore, setLoadingMore] = useState(false);

    useEffect(() => {
        let active = true;
        vrchatToolsRepository
            .getModerationReports({
                currentUserId: getCurrentUserId(),
                offset: 0,
                closedOnly,
                reportType
            })
            .then((page) => {
                if (active) {
                    setLoadState({
                        status: 'ready',
                        reports: page.results ?? [],
                        hasNext: page.hasNext === true
                    });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setLoadState({ status: 'error', error });
                }
            });
        return () => {
            active = false;
        };
    }, [closedOnly, reportType]);

    async function handleLoadMore() {
        if (loadState.status !== 'ready') {
            return;
        }
        setLoadingMore(true);
        try {
            const page = await vrchatToolsRepository.getModerationReports({
                currentUserId: getCurrentUserId(),
                offset: loadState.reports.length,
                closedOnly,
                reportType
            });
            setLoadState((current) =>
                current.status === 'ready'
                    ? {
                          status: 'ready',
                          reports: mergeReports(
                              current.reports,
                              page.results ?? []
                          ),
                          hasNext: page.hasNext === true
                      }
                    : current
            );
        } catch (error) {
            toast.add({
                type: 'error',
                title: t('dialog.moderation_reports.failed_to_load'),
                description: userFacingErrorMessage(error)
            });
        } finally {
            setLoadingMore(false);
        }
    }

    if (loadState.status === 'loading') {
        return <LoadingState variant="panel" />;
    }
    if (loadState.status === 'error') {
        return (
            <EmptyState
                variant="panel"
                title={t('dialog.moderation_reports.failed_to_load')}
                description={userFacingErrorMessage(loadState.error)}
            />
        );
    }
    if (loadState.reports.length === 0) {
        return (
            <EmptyState
                variant="panel"
                icon={FlagIcon}
                title={
                    closedOnly
                        ? t('dialog.moderation_reports.empty_closed')
                        : t('dialog.moderation_reports.empty_open')
                }
            />
        );
    }

    return (
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
            <ul className="divide-stroke-subtle shrink-0 divide-y overflow-hidden rounded-lg border">
                {loadState.reports.map((report) => (
                    <ModerationReportRow key={report.id} report={report} />
                ))}
            </ul>
            {loadState.hasNext ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-center"
                    disabled={loadingMore}
                    onClick={() => {
                        void handleLoadMore();
                    }}
                >
                    {loadingMore ? <Spinner data-icon="inline-start" /> : null}
                    {t('common.load_more')}
                </Button>
            ) : null}
        </div>
    );
}

function ModerationReportRow({ report }: { report: ModerationReportRecord }) {
    const { t } = useTranslation();
    const type = report.type ?? '';
    const contentId = report.contentId ?? '';
    const name = report.contentName || contentId;
    const typeLabelKey = contentTypeLabelKeys[type];
    const openContent = contentId ? contentDialogOpeners[type] : undefined;
    const thumbnailUrl = report.contentThumbnailImageUrl || '';
    const thumbnailFallback = (
        <FlagIcon className="text-muted-foreground size-4" />
    );

    return (
        <li className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-(--state-hover-surface)">
            <div
                className={cn(
                    'bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden',
                    type === 'user' ? 'rounded-full' : 'rounded-md'
                )}
            >
                {thumbnailUrl ? (
                    <FadeInImage
                        src={thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                        fallback={thumbnailFallback}
                    />
                ) : (
                    thumbnailFallback
                )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline gap-3">
                    {openContent ? (
                        <button
                            type="button"
                            className="hover:text-foreground min-w-0 cursor-pointer truncate text-left text-sm font-medium"
                            onClick={() => openContent(contentId)}
                        >
                            {name}
                        </button>
                    ) : (
                        <span className="min-w-0 truncate text-sm font-medium">
                            {name}
                        </span>
                    )}
                    {report.created ? (
                        <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                            {formatDateFilter(report.created, 'long')}
                        </span>
                    ) : null}
                </div>
                <span className="text-muted-foreground truncate text-xs">
                    {[typeLabelKey ? t(typeLabelKey) : type, report.reason]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
                {report.description ? (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <span className="text-muted-foreground/80 truncate text-xs">
                                    {report.description}
                                </span>
                            }
                        />
                        <TooltipContent className="whitespace-pre-wrap">
                            {report.description}
                        </TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
        </li>
    );
}
