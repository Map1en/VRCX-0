import { QueryClient } from '@tanstack/react-query';

export const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true
        }
    }
});
