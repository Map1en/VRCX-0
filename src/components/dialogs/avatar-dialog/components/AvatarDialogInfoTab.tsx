import type { TFunction } from 'i18next';
import { isValidElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { PlatformFileAnalysis } from '@/domain/entities/world';
import { formatDateFilter, timeToText } from '@/lib/dateTime';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type { EconomyListingRecord } from '@/repositories/vrchatEconomyRepository';
import { Alert, AlertDescription } from '@/ui/shadcn/alert';

import {
    EntityDialogTabContent,
    EntityInfoBlock,
    EntityInfoSection,
    EntityInfoSections,
    EntityMemoTextarea
} from '../../EntityDialogScaffold';
import type {
    AvatarPlatformInfo,
    AvatarTagGroups,
    AvatarViewRecord
} from '../avatarDialogTypes';
import { performanceRankClass } from '../avatarPerformancePresentation';
import { AvatarDialogListings } from './AvatarDialogListings';
import { AvatarDialogTagList } from './AvatarDialogTagList';

const EMPTY_VALUE = '\u2014';

const PLATFORM_ROWS = [
    { key: 'pc', label: 'pc_performance', analysisKey: 'standalonewindows' },
    { key: 'android', label: 'android_performance', analysisKey: 'android' },
    { key: 'ios', label: 'ios_performance', analysisKey: 'ios' }
] as const;

function getAttributes(avatar: AvatarViewRecord, t: TFunction): string[] {
    const styles = [avatar.styles?.primary, avatar.styles?.secondary]
        .filter(Boolean)
        .join(' / ');
    return [
        styles ? `${t('view.favorite.avatars.styles')} ${styles}` : '',
        avatar.unityPackageUrl || avatar.unityPackage?.url
            ? t('dialog.avatar.tags.future_proofing')
            : ''
    ].filter(Boolean);
}

export function AvatarDialogInfoTab({
    avatar,
    memo,
    detail,
    tags,
    platformInfo,
    fileAnalysis,
    listings,
    avatarUrl,
    onOpenAuthor,
    onOpenPerformance,
    onSaveMemo
}: {
    avatar: AvatarViewRecord;
    memo: string;
    detail: ReactNode;
    tags: AvatarTagGroups;
    platformInfo: AvatarPlatformInfo;
    fileAnalysis: PlatformFileAnalysis;
    listings: EconomyListingRecord[];
    avatarUrl: string;
    onOpenAuthor(): void;
    onOpenPerformance(): void;
    onSaveMemo(value: string): void | Promise<void>;
}) {
    const { t } = useTranslation();

    const { localTags, authorTags, otherTags } = tags;
    const attributes = getAttributes(avatar, t);
    const createdAt = avatar.created_at || avatar.createdAt;
    const updatedAt = avatar.updated_at || avatar.updatedAt;
    const platformRows = PLATFORM_ROWS.filter(
        ({ key }) => platformInfo?.[key]?.platform
    );
    const hasTags = attributes.length || authorTags.length || otherTags.length;

    return (
        <EntityDialogTabContent value="info" forceMount>
            <EntityInfoSections>
                {detail ? (
                    <Alert>
                        <AlertDescription>
                            {isValidElement(detail)
                                ? detail
                                : userFacingErrorMessage(
                                      detail,
                                      t('common.error.failed_to_load_data')
                                  )}
                        </AlertDescription>
                    </Alert>
                ) : null}

                <EntityInfoSection
                    title={t('dialog.avatar.info.sections.personal')}
                >
                    <EntityMemoTextarea
                        label={t('dialog.avatar.info.memo')}
                        value={memo}
                        placeholder={t('dialog.avatar.info.memo_placeholder')}
                        onSave={onSaveMemo}
                    />
                    {avatar.$timeSpent ? (
                        <EntityInfoBlock
                            label={t('dialog.avatar.info.time_spent')}
                            value={timeToText(avatar.$timeSpent)}
                        />
                    ) : null}
                    {localTags.length ? (
                        <EntityInfoBlock
                            label={t('dialog.avatar.label.local_tags')}
                            full
                        >
                            <AvatarDialogTagList
                                tags={localTags.map((entry) => entry.tag)}
                            />
                        </EntityInfoBlock>
                    ) : null}
                </EntityInfoSection>

                <EntityInfoSection
                    title={t('dialog.avatar.info.sections.details')}
                >
                    <EntityInfoBlock
                        label={t('table.import.author')}
                        value={avatar.authorName || EMPTY_VALUE}
                        onClick={avatar.authorId ? onOpenAuthor : undefined}
                    />
                    {avatar.version ? (
                        <EntityInfoBlock
                            label={t('dialog.avatar.info.version')}
                            value={String(avatar.version)}
                        />
                    ) : null}
                    {updatedAt ? (
                        <EntityInfoBlock
                            label={t('dialog.avatar.info.last_updated')}
                            value={formatDateFilter(updatedAt, 'long')}
                        />
                    ) : null}
                    {createdAt ? (
                        <EntityInfoBlock
                            label={t('dialog.avatar.info.created_at')}
                            value={formatDateFilter(createdAt, 'long')}
                        />
                    ) : null}
                    <AvatarDialogListings
                        listings={listings}
                        productId={
                            typeof avatar.productId === 'string'
                                ? avatar.productId
                                : ''
                        }
                        avatarUrl={avatarUrl}
                    />
                </EntityInfoSection>

                {platformRows.length ? (
                    <EntityInfoSection
                        title={t('dialog.avatar.info.sections.performance')}
                    >
                        {platformRows.map(({ key, label, analysisKey }) => {
                            const rating = platformInfo[key].performanceRating;
                            return (
                                <EntityInfoBlock
                                    key={key}
                                    label={t(`dialog.avatar.info.${label}`)}
                                    value={
                                        rating ? (
                                            <span
                                                className={performanceRankClass(
                                                    rating
                                                )}
                                            >
                                                {t(
                                                    `dialog.avatar.performance.ranks.${rating}`,
                                                    { defaultValue: rating }
                                                )}
                                            </span>
                                        ) : (
                                            EMPTY_VALUE
                                        )
                                    }
                                    hint={fileAnalysis[analysisKey]?._fileSize}
                                    onClick={onOpenPerformance}
                                />
                            );
                        })}
                    </EntityInfoSection>
                ) : null}

                {hasTags ? (
                    <EntityInfoSection
                        title={t('dialog.avatar.info.sections.tags')}
                    >
                        {attributes.length ? (
                            <EntityInfoBlock
                                label={t('dialog.avatar.info.attributes')}
                                full
                            >
                                <AvatarDialogTagList tags={attributes} />
                            </EntityInfoBlock>
                        ) : null}
                        {authorTags.length ? (
                            <EntityInfoBlock
                                label={t('dialog.world.info.author_tags')}
                                full
                            >
                                <AvatarDialogTagList
                                    tags={authorTags}
                                    trimPrefix="author_tag_"
                                />
                            </EntityInfoBlock>
                        ) : null}
                        {otherTags.length ? (
                            <EntityInfoBlock
                                label={t('dialog.avatar.label.vrchat_tags')}
                                full
                            >
                                <AvatarDialogTagList tags={otherTags} />
                            </EntityInfoBlock>
                        ) : null}
                    </EntityInfoSection>
                ) : null}
            </EntityInfoSections>
        </EntityDialogTabContent>
    );
}
