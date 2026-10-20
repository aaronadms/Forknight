-- One-time WebAuthn challenges, issued and consumed by webauthn-worker.js.
-- Run once in the Supabase SQL editor before deploying the updated worker.
--
-- Only the worker (service role) touches this table. RLS is enabled with no
-- policies, so the anon/authenticated keys used by the app can't read or write it.

create table if not exists public.webauthn_challenges (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('register', 'authenticate')),
  challenge   text not null,
  user_id     uuid,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.webauthn_challenges enable row level security;

create index if not exists webauthn_challenges_expires_at_idx
  on public.webauthn_challenges (expires_at);
