-- Overdue reminders (email-invoices plugin) are recorded with the invoice
-- emails, so each invoice gets one. They're sent by the plugin's job with
-- the service role, so sent_by is null for them.
alter table invoice_emails
  add column kind varchar(20) not null default 'invoice' check (kind in ('invoice', 'reminder'));

create index idx_invoice_emails_reminders on invoice_emails (invoice_id) where kind = 'reminder';
