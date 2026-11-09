import { ReceiptIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    economyImageUrl,
    formatCredits
} from '@/components/economy/economyDisplay';
import { EmptyState, LoadingState } from '@/components/layout/PageScaffold';
import { FadeInImage } from '@/components/media/FadeInImage';
import { formatDateFilter } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import vrchatEconomyRepository, {
    type EconomyPurchaseRecord,
    type EconomyTransactionRecord
} from '@/repositories/vrchatEconomyRepository';
import { openUserDialog } from '@/services/dialogService';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { getCurrentUserId } from './toolsDialogUtils';

type HistoryTab = 'purchases' | 'transactions';

type LoadState<T> =
    | { status: 'loading' }
    | { status: 'ready'; rows: T[] }
    | { status: 'error'; error: unknown };

const ALL_TYPES = 'all';

function useEconomyRows<T>(
    load: (force: boolean) => Promise<T[]>,
    refreshToken: number,
    enabled: boolean
) {
    const [state, setState] = useState<LoadState<T>>({ status: 'loading' });

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        let active = true;
        setState({ status: 'loading' });
        load(refreshToken > 0)
            .then((rows) => {
                if (active) {
                    setState({ status: 'ready', rows });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setState({ status: 'error', error });
                }
            });
        return () => {
            active = false;
        };
    }, [enabled, load, refreshToken]);

    return state;
}

export function PurchaseHistoryDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
                {open ? <PurchaseHistoryDialogBody /> : null}
            </DialogContent>
        </Dialog>
    );
}

function PurchaseHistoryDialogBody() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<HistoryTab>('purchases');
    const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
    const [refreshTokens, setRefreshTokens] = useState<
        Record<HistoryTab, number>
    >({ purchases: 0, transactions: 0 });
    const [transactionsVisited, setTransactionsVisited] = useState(false);
    const purchases = useEconomyRows(
        loadPurchases,
        refreshTokens.purchases,
        true
    );
    const transactions = useEconomyRows(
        loadTransactions,
        refreshTokens.transactions,
        transactionsVisited
    );
    const purchaseTypes =
        purchases.status === 'ready'
            ? [
                  ...new Set(
                      purchases.rows
                          .map((purchase) => purchase.listingType ?? '')
                          .filter(Boolean)
                  )
              ]
            : [];
    const typeFilterItems = [
        { value: ALL_TYPES, label: t('dialog.purchase_history.all_types') },
        ...purchaseTypes.map((type) => ({ value: type, label: type }))
    ];

    return (
        <>
            <DialogHeader>
                <DialogTitle>{t('dialog.purchase_history.header')}</DialogTitle>
                <DialogDescription>
                    {t('dialog.purchase_history.description')}
                </DialogDescription>
            </DialogHeader>
            <Tabs
                value={activeTab}
                onValueChange={(value) => {
                    if (value === 'purchases' || value === 'transactions') {
                        setActiveTab(value);
                    }
                    if (value === 'transactions') {
                        setTransactionsVisited(true);
                    }
                }}
                className="min-h-0"
            >
                <div className="flex items-center gap-2">
                    <TabsList>
                        <TabsTrigger value="purchases">
                            {t('dialog.purchase_history.purchases')}
                        </TabsTrigger>
                        <TabsTrigger value="transactions">
                            {t('dialog.purchase_history.transactions')}
                        </TabsTrigger>
                    </TabsList>
                    {activeTab === 'purchases' && purchaseTypes.length > 1 ? (
                        <Select<string>
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
                    ) : null}
                    <HintTooltip label={t('common.actions.refresh')}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="ml-auto"
                            onClick={() =>
                                setRefreshTokens((current) => ({
                                    ...current,
                                    [activeTab]: current[activeTab] + 1
                                }))
                            }
                        >
                            <RefreshCwIcon />
                        </Button>
                    </HintTooltip>
                </div>
                <TabsContent
                    value="purchases"
                    className="flex min-h-0 flex-col"
                >
                    <PurchaseList state={purchases} typeFilter={typeFilter} />
                </TabsContent>
                <TabsContent
                    value="transactions"
                    className="flex min-h-0 flex-col"
                >
                    <TransactionList state={transactions} />
                </TabsContent>
            </Tabs>
        </>
    );
}

async function loadPurchases(force: boolean) {
    const currentUserId = getCurrentUserId();
    const purchases = await vrchatEconomyRepository.getPurchases({
        userId: currentUserId,
        force
    });
    return purchases
        .filter((purchase) => purchase.buyerId === currentUserId)
        .sort(
            (a, b) =>
                Date.parse(b.purchaseDate ?? '') -
                Date.parse(a.purchaseDate ?? '')
        );
}

async function loadTransactions(force: boolean) {
    return vrchatEconomyRepository.getTransactions({
        userId: getCurrentUserId(),
        force
    });
}

function PurchaseList({
    state,
    typeFilter
}: {
    state: LoadState<EconomyPurchaseRecord>;
    typeFilter: string;
}) {
    const { t } = useTranslation();

    if (state.status === 'loading') {
        return <LoadingState variant="panel" />;
    }
    if (state.status === 'error') {
        return (
            <EmptyState
                variant="panel"
                title={t('dialog.purchase_history.failed_to_load')}
                description={userFacingErrorMessage(state.error)}
            />
        );
    }
    const rows =
        typeFilter === ALL_TYPES
            ? state.rows
            : state.rows.filter(
                  (purchase) => purchase.listingType === typeFilter
              );
    if (rows.length === 0) {
        return (
            <EmptyState
                variant="panel"
                icon={ReceiptIcon}
                title={t('dialog.purchase_history.empty_purchases')}
            />
        );
    }

    return (
        <ul className="divide-stroke-subtle min-h-0 divide-y overflow-y-auto rounded-lg border">
            {rows.map((purchase, index) => (
                <PurchaseRow
                    key={purchase.purchaseId || index}
                    purchase={purchase}
                />
            ))}
        </ul>
    );
}

function PurchaseRow({ purchase }: { purchase: EconomyPurchaseRecord }) {
    const { t } = useTranslation();
    const imageUrl = economyImageUrl(undefined, purchase.listingImageId, 128);
    const fallback = <ReceiptIcon className="text-muted-foreground size-4" />;
    const price = Number(purchase.purchasePrice) || 0;
    const showEndDate =
        Boolean(purchase.purchaseEndDate) &&
        purchase.listingType !== 'permanent';

    return (
        <li className="flex items-center gap-3 px-3 py-2.5">
            <div className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md">
                {imageUrl ? (
                    <FadeInImage
                        src={imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                        fallback={fallback}
                    />
                ) : (
                    fallback
                )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span
                        className={cn(
                            'min-w-0 truncate text-sm font-medium',
                            purchase.purchaseActive === false &&
                                'text-muted-foreground'
                        )}
                    >
                        {purchase.listingDisplayName || purchase.listingId}
                    </span>
                    {purchase.isGift ? (
                        <Badge variant="secondary">
                            {t('dialog.purchase_history.gift')}
                        </Badge>
                    ) : null}
                    {purchase.purchaseActive === false ? (
                        <Badge variant="outline">
                            {t('dialog.purchase_history.inactive')}
                        </Badge>
                    ) : null}
                </div>
                <span className="text-muted-foreground truncate text-xs">
                    {[
                        purchase.listingType,
                        purchase.sellerDisplayName
                            ? t('dialog.purchase_history.seller', {
                                  name: purchase.sellerDisplayName
                              })
                            : ''
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
                <span className="text-muted-foreground/80 truncate text-xs tabular-nums">
                    {formatDateFilter(purchase.purchaseDate, 'long')}
                    {showEndDate
                        ? ` · ${t('dialog.purchase_history.ends', {
                              date: formatDateFilter(
                                  purchase.purchaseEndDate,
                                  'long'
                              )
                          })}`
                        : ''}
                </span>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums">
                {price > 0 ? formatCredits(price) : t('economy.free')}
            </span>
        </li>
    );
}

function TransactionList({
    state
}: {
    state: LoadState<EconomyTransactionRecord>;
}) {
    const { t } = useTranslation();

    if (state.status === 'loading') {
        return <LoadingState variant="panel" />;
    }
    if (state.status === 'error') {
        return (
            <EmptyState
                variant="panel"
                title={t('dialog.purchase_history.failed_to_load')}
                description={userFacingErrorMessage(state.error)}
            />
        );
    }
    if (state.rows.length === 0) {
        return (
            <EmptyState
                variant="panel"
                icon={ReceiptIcon}
                title={t('dialog.purchase_history.empty_transactions')}
            />
        );
    }

    return (
        <ul className="divide-stroke-subtle min-h-0 divide-y overflow-y-auto rounded-lg border">
            {state.rows.map((transaction, index) => (
                <TransactionRow
                    key={transaction.transactionLineId || index}
                    transaction={transaction}
                />
            ))}
        </ul>
    );
}

function TransactionParty({
    labelKey,
    userId,
    displayName
}: {
    labelKey: string;
    userId: string | undefined;
    displayName: string | undefined;
}) {
    const { t } = useTranslation();
    if (!displayName) {
        return null;
    }
    return (
        <span className="min-w-0 truncate">
            {t(labelKey)}{' '}
            {userId ? (
                <button
                    type="button"
                    className="hover:text-foreground cursor-pointer"
                    onClick={() => openUserDialog({ userId })}
                >
                    {displayName}
                </button>
            ) : (
                displayName
            )}
        </span>
    );
}

function TransactionRow({
    transaction
}: {
    transaction: EconomyTransactionRecord;
}) {
    const { t } = useTranslation();
    const amount = Number(transaction.amount) || 0;
    const balance = Number(transaction.balance);

    return (
        <li className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-medium">
                        {transaction.listingDisplayName ||
                            transaction.reasonLabel ||
                            transaction.transactionLineId}
                    </span>
                    {transaction.reasonLabel &&
                    transaction.listingDisplayName ? (
                        <Badge variant="secondary">
                            {transaction.reasonLabel}
                        </Badge>
                    ) : null}
                </div>
                <span className="text-muted-foreground flex min-w-0 gap-2 text-xs">
                    <TransactionParty
                        labelKey="dialog.purchase_history.from"
                        userId={transaction.fromUserId}
                        displayName={transaction.fromUserDisplayName}
                    />
                    <TransactionParty
                        labelKey="dialog.purchase_history.to"
                        userId={transaction.toUserId}
                        displayName={transaction.toUserDisplayName}
                    />
                </span>
                <span className="text-muted-foreground/80 truncate text-xs tabular-nums">
                    {[
                        formatDateFilter(transaction.date, 'long'),
                        transaction.platform
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
            </div>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span
                    className={cn(
                        'text-sm font-medium tabular-nums',
                        amount > 0 && 'text-emerald-400'
                    )}
                >
                    {amount > 0 ? '+' : ''}
                    {formatCredits(amount)}
                </span>
                {Number.isFinite(balance) ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                        {t('dialog.purchase_history.balance', {
                            value: formatCredits(balance)
                        })}
                    </span>
                ) : null}
            </span>
        </li>
    );
}
