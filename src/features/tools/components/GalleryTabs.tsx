import { useTranslation } from 'react-i18next';

import { FreezeWhenHidden } from '@/components/FreezeWhenHidden';
import { useVisitedTabs } from '@/lib/useVisitedTabs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
    FILE_TABS,
    TAB_ORDER,
    type FileAssetTab,
    type GalleryTab
} from '../galleryConstants';
import type { GalleryFileTabState } from '../galleryTypes';
import { GalleryFileTab } from './GalleryFileTab';
import {
    GalleryPrintsTab,
    type GalleryPrintsTabState
} from './GalleryPrintsTab';

const GALLERY_TAB_CONTENT_CLASS_NAME =
    'mt-2 flex min-h-0 flex-1 data-hidden:hidden';

export function GalleryTabs({
    activeTab,
    onActiveTabChange,
    tabCounts,
    fileTab,
    printsTab
}: {
    activeTab: GalleryTab;
    onActiveTabChange: (value: string) => void;
    tabCounts: Record<GalleryTab, string>;
    fileTab: GalleryFileTabState;
    printsTab: GalleryPrintsTabState;
}) {
    const { t } = useTranslation();
    const visitedTabs = useVisitedTabs(activeTab, fileTab.currentUserId ?? '');

    return (
        <Tabs
            value={activeTab}
            onValueChange={onActiveTabChange}
            className="min-h-0 flex-1"
        >
            <TabsList className="max-w-full flex-wrap justify-start">
                {TAB_ORDER.map((tab: GalleryTab) => {
                    const definition = tab === 'prints' ? null : FILE_TABS[tab];
                    return (
                        <TabsTrigger
                            key={tab}
                            value={tab}
                            className="flex-none"
                        >
                            {definition?.titleKey
                                ? t(definition.titleKey)
                                : t(`dialog.gallery_icons.${tab}`)}
                            <span className="text-muted-foreground text-xs">
                                {tabCounts[tab]}
                            </span>
                        </TabsTrigger>
                    );
                })}
            </TabsList>

            {(['gallery', 'icons'] satisfies FileAssetTab[]).map((tab) => (
                <TabsContent
                    key={tab}
                    value={tab}
                    keepMounted={visitedTabs.has(tab)}
                    className={GALLERY_TAB_CONTENT_CLASS_NAME}
                >
                    <FreezeWhenHidden active={activeTab === tab}>
                        <GalleryFileTab
                            tab={tab}
                            definition={FILE_TABS[tab]}
                            fileTab={fileTab}
                        />
                    </FreezeWhenHidden>
                </TabsContent>
            ))}
            <TabsContent
                value="prints"
                keepMounted={visitedTabs.has('prints')}
                className={GALLERY_TAB_CONTENT_CLASS_NAME}
            >
                <FreezeWhenHidden active={activeTab === 'prints'}>
                    <GalleryPrintsTab printsTab={printsTab} />
                </FreezeWhenHidden>
            </TabsContent>
        </Tabs>
    );
}
