-- ============================================================================
-- Organization logo: stored directly as a base64 data URI rather than via
-- Supabase Storage — one small image per org, updated rarely, no need for
-- a bucket, storage policies, or signed URLs. The size cap keeps this from
-- bloating every dashboard page load (the column gets fetched alongside
-- the org's name wherever the logo is shown). Revisit with real object
-- storage if attachments become a broader feature later.
-- ============================================================================

alter table organizations
  add column logo_data_url text
    check (logo_data_url is null or char_length(logo_data_url) <= 500000);
