import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase/config.mjs';
import { createDashboardStore } from './supabase/store.mjs';
import { mountDashboard } from './dashboard.mjs';

function loadSdk() {
    if (globalThis.supabase?.createClient) return Promise.resolve(globalThis.supabase);
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3';
        script.onload = () => globalThis.supabase?.createClient
            ? resolve(globalThis.supabase)
            : reject(new Error('The data connection component is unavailable.'));
        script.onerror = () => reject(new Error('Unable to load the data connection. Check your internet connection and try again.'));
        document.head.appendChild(script);
    });
}

const dashboard = mountDashboard({
    document,
    getStore: async () => {
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error('The data connection has not been configured.');
        const sdk = await loadSdk();
        const client = sdk.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        return createDashboardStore(client);
    }
});
await dashboard.start();
