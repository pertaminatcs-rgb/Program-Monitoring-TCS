import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase/config.mjs';
import { createDashboardStore, createDashboardAuth } from './supabase/store.mjs';
import { mountDashboard, mountLogin } from './dashboard.mjs';

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

let clientPromise;
function getClient() {
    if (!clientPromise) clientPromise = (async () => {
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error('The data connection has not been configured.');
        const sdk = await loadSdk();
        return sdk.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            auth: { persistSession: true, storage: globalThis.sessionStorage, autoRefreshToken: true, detectSessionInUrl: false }
        });
    })().catch(error => { clientPromise = null; throw error });
    return clientPromise;
}

const dashboard = mountDashboard({
    document,
    getStore: async () => createDashboardStore(await getClient())
});
const login = mountLogin({ document, dashboard, getAuth: async () => createDashboardAuth(await getClient()) });
await Promise.all([dashboard.start(), login.start()]);
