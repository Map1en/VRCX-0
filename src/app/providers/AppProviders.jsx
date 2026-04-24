import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/services/queryClient.js';
import { TooltipProvider } from '@/ui/shadcn/tooltip';

export function AppProviders({ children }) {
    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={100}>
                {children}
            </TooltipProvider>
        </QueryClientProvider>
    );
}
