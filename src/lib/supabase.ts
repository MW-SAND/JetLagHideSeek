import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
    realtime: {
        params: {
            eventsPerSecond: 10,
        },
    },
});

/**
 * Ensure the current browser session has an anonymous auth identity.
 * Called once on app load — subsequent calls are no-ops if already signed in.
 */
export const ensureAnonymousAuth = async () => {
    const {
        data: { session },
    } = await supabase.auth.getSession();
    if (session) return session;

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return data.session;
};
