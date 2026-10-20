import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://cekgmugupbbmehpeoqnp.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNla2dtdWd1cGJibWVocGVvcW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MDY4MDAsImV4cCI6MjA5Mjk4MjgwMH0.VfBTWhvpuAviNNP2ZCF6kMj0qGyNvjGO2Z04z_u2e98";

// Simple promise queue so auth lock calls don't stack and steal each other
let lockQueue = Promise.resolve();
// Each fn runs once, after the previous one settles; its own result/error goes back to the caller.
const enqueueLock = (fn) => {
  const run = lockQueue.then(() => fn(), () => fn());
  lockQueue = run.catch(() => {});
  return run;
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "forknight-auth",
    lock: (name, acquireTimeout, fn) => enqueueLock(fn),
  },
});
