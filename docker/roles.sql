-- The Supabase Postgres image creates these roles without passwords; the
-- auth service and PostgREST log in as them.
\set pgpass `echo "$POSTGRES_PASSWORD"`
alter user authenticator with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
