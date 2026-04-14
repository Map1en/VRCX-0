import { QueryClientProvider } from '@tanstack/react-query';

import { TooltipProvider } from '@/ui/shadcn/tooltip.jsx';
import { queryClient } from '@/services/queryClient.js';

import { I18nProvider } from './I18nProvider.jsx';

export function AppProviders({ children }) {
    return (
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <TooltipProvider delayDuration={100}>{children}</TooltipProvider>
            </I18nProvider>
        </QueryClientProvider>
    );
}
