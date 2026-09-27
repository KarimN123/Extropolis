-- Isolation multi-tenant au niveau de la base.
--
-- L'application se connecte avec le rôle `extropolis_app`, qui n'est pas
-- propriétaire des tables et n'a pas l'attribut BYPASSRLS : même une requête
-- forgée ou un oubli de filtre applicatif ne peut pas lire une autre boutique.
-- Le tenant courant vient de `app.tenant_id`, positionné par transaction.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'extropolis_app') then
    create role extropolis_app login password 'extropolis_app';
  end if;
end
$$;

grant usage on schema public to extropolis_app;
grant select, insert, update, delete on all tables in schema public to extropolis_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to extropolis_app;

create or replace function current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'tenants', 'domains', 'memberships', 'products', 'variants', 'customers',
    'orders', 'order_items', 'tenant_payment_configs', 'payment_intents',
    'payment_events', 'refunds', 'ledger_entries', 'payouts', 'audit_log'
  ]
  loop
    execute format('alter table %I enable row level security', target);
    execute format('alter table %I force row level security', target);
    execute format('drop policy if exists tenant_isolation on %I', target);
  end loop;
end
$$;

-- `tenants` se filtre sur sa clé primaire, les autres tables sur `tenantId`.
create policy tenant_isolation on tenants
  using (id = current_tenant_id())
  with check (id = current_tenant_id());

do $$
declare
  target text;
begin
  foreach target in array array[
    'domains', 'memberships', 'products', 'variants', 'customers', 'orders',
    'order_items', 'tenant_payment_configs', 'payment_intents', 'refunds',
    'ledger_entries', 'payouts'
  ]
  loop
    execute format(
      'create policy tenant_isolation on %I using ("tenantId" = current_tenant_id()) with check ("tenantId" = current_tenant_id())',
      target
    );
  end loop;
end
$$;

-- `payment_events` et `audit_log` acceptent un tenant nul (événement reçu avant
-- rattachement à une boutique), mais jamais le tenant d'un autre marchand.
create policy tenant_isolation on payment_events
  using ("tenantId" is null or "tenantId" = current_tenant_id())
  with check ("tenantId" is null or "tenantId" = current_tenant_id());

create policy tenant_isolation on audit_log
  using ("tenantId" is null or "tenantId" = current_tenant_id())
  with check ("tenantId" is null or "tenantId" = current_tenant_id());

-- Le grand livre est append-only : aucune correction ne se fait par UPDATE,
-- seulement par écriture d'ajustement.
revoke update, delete on ledger_entries from extropolis_app;
