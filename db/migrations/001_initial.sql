create table if not exists events (
 id uuid primary key default gen_random_uuid(), slug text not null unique,
 title text not null, event_date timestamptz not null, location_name text not null,
 registration_closes_at timestamptz, is_active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists rsvps (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references events(id),
 full_name text not null check (length(btrim(full_name)) between 2 and 100),
 normalized_name text not null, attendance text not null check (attendance in ('yes','no','maybe')),
 guest_count integer not null, source text not null default 'guest' check (source in ('guest','admin')),
 request_key uuid, version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 archived_at timestamptz,
 unique(event_id,request_key),
 check ((attendance='yes' and guest_count between 1 and 20) or (attendance in ('no','maybe') and guest_count=0))
);
create table if not exists browser_sessions (
 id uuid primary key default gen_random_uuid(), session_hash text not null unique,
 created_at timestamptz not null default now(), expires_at timestamptz not null,
 last_used_at timestamptz, revoked_at timestamptz
);
create table if not exists session_rsvps (
 session_id uuid not null references browser_sessions(id) on delete cascade,
 rsvp_id uuid not null references rsvps(id) on delete cascade,
 granted_at timestamptz not null default now(), primary key(session_id,rsvp_id)
);
create table if not exists rsvp_recovery_tokens (
 id uuid primary key default gen_random_uuid(), rsvp_id uuid not null references rsvps(id) on delete cascade,
 token_hash text not null unique, created_at timestamptz not null default now(),
 expires_at timestamptz not null, revoked_at timestamptz
);
create table if not exists admin_sessions (
 id uuid primary key default gen_random_uuid(), session_hash text not null unique,
 credential_version text not null, created_at timestamptz not null default now(),
 expires_at timestamptz not null, revoked_at timestamptz
);
create table if not exists admin_audit (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references events(id),
 action text not null, rsvp_id uuid, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create table if not exists duplicate_decisions (
 event_id uuid not null references events(id), first_id uuid not null references rsvps(id),
 second_id uuid not null references rsvps(id), decision text not null check(decision in ('not_duplicate','merged')),
 first_version integer not null, second_version integer not null,
 created_at timestamptz not null default now(), primary key(event_id,first_id,second_id),
 check(first_id < second_id)
);
create table if not exists rate_limits (
 key_hash text not null, window_start timestamptz not null, hits integer not null default 1,
 primary key(key_hash,window_start)
);
create index if not exists idx_rsvps_event_status on rsvps(event_id,attendance) where archived_at is null;
create index if not exists idx_rsvps_event_name on rsvps(event_id,normalized_name) where archived_at is null;
create index if not exists idx_session_rsvps_rsvp on session_rsvps(rsvp_id);
create index if not exists idx_admin_audit_event on admin_audit(event_id,created_at desc);
create or replace function update_rsvp_version() returns trigger language plpgsql as $$
begin new.updated_at=now(); new.version=old.version+1; return new; end; $$;
drop trigger if exists rsvp_version on rsvps;
create trigger rsvp_version before update on rsvps for each row execute function update_rsvp_version();
alter table events enable row level security;
alter table rsvps enable row level security;
alter table browser_sessions enable row level security;
alter table session_rsvps enable row level security;
alter table rsvp_recovery_tokens enable row level security;
alter table admin_sessions enable row level security;
alter table admin_audit enable row level security;
alter table duplicate_decisions enable row level security;
alter table rate_limits enable row level security;
revoke all on events,rsvps,browser_sessions,session_rsvps,rsvp_recovery_tokens,admin_sessions,admin_audit,duplicate_decisions,rate_limits from public;
