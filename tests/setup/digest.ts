import { sql } from './db.js';

/**
 * THE IDEMPOTENCY DIGEST, AND moved() (R-2026-09-29-165, EO-1 a).
 *
 * Moved verbatim from tests/db/migration_idempotency.test.ts, which imports them, so that
 * tests/db/runbook_sql_live.test.ts renders relations and column ACLs the same way. One
 * rendering, two call sites: a second copy could be edited apart and drift while both stay
 * green (test-conventions section 7).
 *
 * A helper module and not a test file, because importing a test file makes vitest run that
 * file's tests again inside the importer.
 *
 * THE DIGEST IS A MAP OF NAMED COMPONENTS (R-2026-09-28-162, EL-3), so a plant can
 * say WHICH component moved and assert that nothing else did. One concatenated
 * string could only say that something changed.
 */

export type Digest = Record<string, string>;

/**
 * A digest of everything a migration could legitimately change, by component.
 *
 * Structure AND row contents. A structural digest alone would miss the case the
 * mutate plant in tests/db/migration_idempotency.test.ts exercises: a statement that
 * succeeds and mutates data.
 */
export async function digest(): Promise<Digest> {
  const [row] = await sql()<Digest[]>`
    with cols as (
      select coalesce(string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type, ',' order by table_schema, table_name, ordinal_position), 'none') s
        from information_schema.columns where table_schema in ('app','public')
    ), enums as (
      select coalesce(string_agg(t.typname||':'||e.enumlabel, ',' order by t.typname, e.enumsortorder), 'none') s
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'app'
    ), funcs as (
      select coalesce(string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', ',' order by p.proname), 'none') s
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app','public')
    ), trigs as (
      select coalesce(string_agg(tgname||':'||tgenabled::text, ',' order by tgname), 'none') s
        from pg_trigger where not tgisinternal
    ), cons as (
      select coalesce(string_agg(conname, ',' order by conname), 'none') s
        from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in ('app','public')
    ), pols as (
      -- POLICIES, added 2026-09-15 (R-2026-09-15-07, C1). 016 now creates a
      -- policy, and until this component a re-apply that added, rewrote or
      -- duplicated a policy under another name changed nothing this digest could
      -- see. Grants, owners and RLS flags were still outside the digest until
      -- R-2026-09-28-162 (EL-3), which added the five components after contents.
      -- Column and type ACLs followed in R-2026-09-28-163 (EM-4): EL-3 named
      -- table, function, schema and default ACLs, and a column GRANT moved nothing.
      select coalesce(string_agg(schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual,'')||':'||coalesce(with_check,''),
                                 ',' order by schemaname, tablename, policyname), 'none') s
        from pg_policies where schemaname in ('app','public')
    ), contents as (
      -- CONTENT HASH per table, not merely a row count.
      --
      -- A row count catches an unconditional INSERT. It does NOT catch an
      -- in-place mutation -- UPDATE ... SET x = x + 1, or an
      -- ON CONFLICT DO UPDATE SET touched_at = now(). That case changes no
      -- structure and no cardinality, and a count-based digest reports the run
      -- idempotent. Found by planting exactly that against a tracked migration
      -- during the behavioural pass, where the count-based digest missed it.
      select coalesce(string_agg(
               t.tablename||'='||
               (xpath('/row/c/text()', query_to_xml(
                  format('select coalesce(md5(string_agg(x::text, '''' order by x::text)), ''empty'') as c from app.%I x', t.tablename),
                  false, true, '')))[1]::text,
               ',' order by t.tablename), 'none') s
        from pg_tables t where t.schemaname = 'app'
    ), relations as (
      -- PRIVILEGES AND OWNERS, R-2026-09-28-162 (EL-3). Until this component a
      -- re-apply that granted SELECT to anon, or handed a table to another owner,
      -- changed nothing the digest could see. A NULL ACL means the owner's
      -- defaults, so it is expanded by acldefault() rather than read as "none":
      -- otherwise a GRANT that materialises the defaults would move nothing.
      -- Each entry is rendered by NAME (grantee 0 is PUBLIC), never by oid.
      select coalesce(string_agg(r.line, ',' order by r.line), 'none') s from (
        select n.nspname||'.'||c.relname||':'||c.relkind::text||':owner='||pg_get_userbyid(c.relowner)||':acl='||
               coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(a.grantor)||'/'||case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                        ||'/'||a.privilege_type||'/'||a.is_grantable::text as e
                   from aclexplode(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
               ) q), 'none') as line
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('app','public') and c.relkind in ('r','p','v','m','S','f')
      ) r
    ), rls as (
      select coalesce(string_agg(n.nspname||'.'||c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text,
                                 ',' order by n.nspname, c.relname), 'none') s
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('app','public') and c.relkind in ('r','p')
    ), functions as (
      -- A SECURITY DEFINER function runs as its OWNER, so the owner, the definer
      -- flag and the pinned search_path are privileges as much as the ACL is.
      select coalesce(string_agg(f.line, ',' order by f.line), 'none') s from (
        select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):owner='||pg_get_userbyid(p.proowner)
               ||':secdef='||p.prosecdef::text
               ||':config='||coalesce((select string_agg(cfg, ';' order by cfg) from unnest(p.proconfig) cfg), 'none')
               ||':acl='||coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(a.grantor)||'/'||case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                        ||'/'||a.privilege_type||'/'||a.is_grantable::text as e
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               ) q), 'none') as line
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('app','public')
      ) f
    ), schemas as (
      select coalesce(string_agg(x.line, ',' order by x.line), 'none') s from (
        select n.nspname||':owner='||pg_get_userbyid(n.nspowner)||':acl='||
               coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(a.grantor)||'/'||case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                        ||'/'||a.privilege_type||'/'||a.is_grantable::text as e
                   from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
               ) q), 'none') as line
          from pg_namespace n where n.nspname in ('app','public')
      ) x
    ), default_acl as (
      select coalesce(string_agg(x.line, ',' order by x.line), 'none') s from (
        select n.nspname||':'||pg_get_userbyid(d.defaclrole)||':'||d.defaclobjtype::text||':'||
               coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(a.grantor)||'/'||case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                        ||'/'||a.privilege_type||'/'||a.is_grantable::text as e
                   from aclexplode(d.defaclacl) a
               ) q), 'none') as line
          from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
         where n.nspname in ('app','public')
      ) x
    ), column_acl as (
      -- COLUMN ACLs, R-2026-09-28-163 (EM-4). Only columns whose attacl is non-null
      -- and non-empty: a column GRANT then REVOKE leaves attacl NULL, so the
      -- restore returns the same text, and today the component is exactly 'none'.
      select coalesce(string_agg(x.line, ',' order by x.line), 'none') s from (
        select n.nspname||'.'||c.relname||'.'||a.attname||':acl='||
               coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(g.grantor)||'/'||case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end
                        ||'/'||g.privilege_type||'/'||g.is_grantable::text as e
                   from aclexplode(a.attacl) g
               ) q), 'none') as line
          from pg_attribute a
          join pg_class c on c.oid = a.attrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('app','public') and a.attnum > 0 and not a.attisdropped
           and a.attacl is not null and cardinality(a.attacl) > 0
      ) x
    ), type_acl as (
      -- TYPE ACLs, R-2026-09-28-163 (EM-4). Array types (typcategory 'A') and
      -- relation row types (typrelid <> 0) are left out: they follow their element
      -- type and their relation. NOT ASSERTED, as a consequence: a standalone
      -- composite type, and a domain over an array. Neither exists today; 002
      -- creates only enums. A NULL typacl means the owner's defaults, so it is
      -- expanded by acldefault('T', ...) like every other ACL here.
      select coalesce(string_agg(x.line, ',' order by x.line), 'none') s from (
        select n.nspname||'.'||t.typname||':owner='||pg_get_userbyid(t.typowner)||':acl='||
               coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(g.grantor)||'/'||case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end
                        ||'/'||g.privilege_type||'/'||g.is_grantable::text as e
                   from aclexplode(coalesce(t.typacl, acldefault('T', t.typowner))) g
               ) q), 'none') as line
          from pg_type t join pg_namespace n on n.oid = t.typnamespace
         where n.nspname in ('app','public') and t.typcategory <> 'A' and t.typrelid = 0
      ) x
    )
    select cols.s as cols, enums.s as enums, funcs.s as funcs, trigs.s as trigs, cons.s as cons,
           pols.s as policies, contents.s as contents,
           relations.s as relations, rls.s as rls, functions.s as functions, schemas.s as schemas, default_acl.s as default_acl,
           column_acl.s as column_acl, type_acl.s as type_acl
      from cols, enums, funcs, trigs, cons, pols, contents, relations, rls, functions, schemas, default_acl, column_acl, type_acl
  `;
  return { ...(row ?? {}) };
}

/** The components that differ, by name. */
export function moved(before: Digest, after: Digest): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]).sort();
}
