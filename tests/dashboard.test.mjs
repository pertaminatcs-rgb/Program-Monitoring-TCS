import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createDashboardStore, createDashboardAuth } from '../supabase/store.mjs';
import { mountDashboard, mountLogin } from '../dashboard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencyRoot = process.env.TCS_TEST_MODULE_ROOT;
const requireDependency = createRequire(dependencyRoot ? path.join(dependencyRoot, 'package.json') : import.meta.url);
const { PGlite } = requireDependency('@electric-sql/pglite');
const { JSDOM } = requireDependency('jsdom');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
const autoWeights = fs.readFileSync(path.join(root, 'supabase/auto-weights.sql'), 'utf8');
const requireLogin = fs.readFileSync(path.join(root, 'supabase/require-login.sql'), 'utf8');
const editorId = '11111111-1111-4111-8111-111111111111';
const viewerId = '22222222-2222-4222-8222-222222222222';

// Emulate the Supabase query interface with real PostgreSQL queries.
// Requests use actual PostgreSQL roles, grants, RLS, views and constraints.
function databaseClient(db) {
    const tables = new Set(['tcs_subfunctions', 'tcs_programs', 'tcs_subprograms', 'tcs_program_summary', 'tcs_subfunction_summary']);
    const identifier = name => { assert.match(name, /^[a-z_]+$/); return `"${name}"`; };
    return {
        async rpc(name, args) {
            try {
                if (name === 'tcs_can_edit') return { data: (await db.query('select public.tcs_can_edit() as allowed')).rows[0].allowed, error: null };
                assert.equal(name, 'tcs_add_subprogram_equal_weights');
                const { rows } = await db.query('select public.tcs_add_subprogram_equal_weights($1, $2) as result', [args.p_program_id, args.p_name]);
                return { data: rows[0].result, error: null };
            } catch (error) { return { data: null, error: { message: error.message } }; }
        },
        from(table) {
        assert.ok(tables.has(table));
        const query = {
            kind: 'select', columns: '*', record: null, id: null, sorting: 'id', start: 0, limit: null, singleRow: false,
            select(columns = '*') { this.columns = columns; return this; },
            order(column) { this.sorting = column; return this; },
            range(start, end) { this.start = start; this.limit = end - start + 1; return this; },
            insert(record) { this.kind = 'insert'; this.record = record; return this; },
            update(record) { this.kind = 'update'; this.record = record; return this; },
            delete() { this.kind = 'delete'; return this; },
            eq(column, id) { assert.equal(column, 'id'); this.id = id; return this; },
            single() { this.singleRow = true; return this; },
            async execute() {
                const name = `public.${identifier(table)}`;
                const columns = this.columns === '*' ? '*' : identifier(this.columns);
                let sql, values = [];
                if (this.kind === 'select') sql = `select ${columns} from ${name} order by ${identifier(this.sorting)}${this.limit == null ? '' : ` limit ${this.limit} offset ${this.start}`}`;
                if (this.kind === 'insert') {
                    const keys = Object.keys(this.record);
                    values = Object.values(this.record);
                    sql = `insert into ${name} (${keys.map(identifier).join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning ${columns}`;
                }
                if (this.kind === 'update') {
                    const keys = Object.keys(this.record);
                    values = [...Object.values(this.record), this.id];
                    sql = `update ${name} set ${keys.map((k, i) => `${identifier(k)}=$${i + 1}`).join(',')} where id=$${values.length} returning ${columns}`;
                }
                if (this.kind === 'delete') { values = [this.id]; sql = `delete from ${name} where id=$1 returning ${columns}`; }
                try {
                    const { rows } = await db.query(sql, values);
                    for (const row of rows) if (row.target_date instanceof Date) row.target_date = row.target_date.toISOString().slice(0, 10);
                    if (this.singleRow && rows.length !== 1) return { data: null, error: { message: 'Record tidak ditemukan.' } };
                    return { data: this.singleRow ? rows[0] : rows, error: null };
                } catch (error) { return { data: null, error: { message: error.message } }; }
            },
            then(resolve, reject) { return this.execute().then(resolve, reject); }
        };
        return query;
    } };
}

async function fixture(t, wrapStore = store => store) {
    const db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin;
        create schema auth;
        create table auth.users (id uuid primary key, email text);
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$;
        grant usage on schema auth to anon, authenticated;
        insert into auth.users values ('${editorId}', 'editor@example.test'), ('${viewerId}', 'viewer@example.test');`);
    await db.exec(schema);
    await db.exec(autoWeights);
    await db.exec(requireLogin);
    await db.query('insert into public.tcs_editors (user_id) values ($1)', [editorId]);
    const dom = new JSDOM(html, { url: 'http://127.0.0.1:5500/' });
    const document = dom.window.document;
    // Previous local data must not leak into the shared dashboard, or be cleared.
    dom.window.localStorage.setItem('pm-dash-v3', '[{"n":"Data browser lama","subs":[]}]');
    const switchRole = async (role, id = '') => {
        assert.ok(['anon', 'authenticated'].includes(role));
        await db.exec(`reset role; set role ${role};`);
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    };
    await switchRole('authenticated', editorId);
    const store = createDashboardStore(databaseClient(db));
    const errors = [];
    const app = mountDashboard({ document, getStore: async () => wrapStore(store), canEdit: true, confirm: () => true, matchMedia: () => ({ matches: false }), notifyError: text => errors.push(text) });
    t.after(async () => { dom.window.close(); await db.close(); });
    await app.start();
    const click = async selector => { const target = document.querySelector(selector); assert.ok(target, selector); await document.getElementById('rows').onclick({ target }); };
    const edit = async (j, field, value) => {
        const selector = j == null ? `[data-i="0"][data-k="${field}"]:not([data-j])` : `[data-i="0"][data-j="${j}"][data-k="${field}"]`;
        const target = document.querySelector(selector);
        assert.ok(target, selector);
        target.value = value;
        await document.getElementById('rows').onchange({ target });
    };
    const addProgram = async (name = 'Program uji') => {
        document.getElementById('nName').value = name;
        document.getElementById('nArea').value = 'Terminal Standardization';
        document.getElementById('nDate').value = '2026-12-31';
        await document.getElementById('addBtn').onclick();
    };
    const addSub = async name => { document.querySelector('[data-ni="0"]').value = name; await click('[data-as="0"]'); };
    return { db, dom, document, store, app, click, edit, addProgram, addSub, errors, switchRole };
}

test('startup reads shared database, leaves old browser data untouched, and exposes four empty charts', async t => {
    const f = await fixture(t);
    assert.equal(f.document.getElementById('connection'), null);
    assert.equal(f.errors.length, 0);
    assert.equal(f.document.querySelectorAll('.subfunction-chart').length, 4);
    assert.equal((await f.store.load()).programs.length, 0);
    assert.equal(f.document.getElementById('empty').hidden, false);
    assert.match(f.dom.window.localStorage.getItem('pm-dash-v3'), /Data browser lama/);
    assert.equal(f.document.getElementById('reset'), null);
    assert.equal(f.document.getElementById('refresh'), null);
    assert.equal(f.app.reload, undefined);
});

test('UI creates program/subprograms and derives progress, validation and charts from PostgreSQL', async t => {
    const f = await fixture(t);
    await f.addProgram();
    await f.addSub('Evaluasi');
    await f.addSub('Rilis');
    await f.edit(0, 'w', '40');
    assert.match(f.document.getElementById('rows').textContent, /Total weight must be 100%/);
    await f.edit(0, 'w', '50');
    await f.edit(1, 'w', '50');
    await f.edit(0, 's', 'finish');
    const snapshot = await f.store.load();
    assert.equal(snapshot.programs[0].status, 'ongoing');
    assert.equal(Number(snapshot.programs[0].progress), 50);
    assert.match(f.document.getElementById('rows').textContent, /50%/);
    assert.match(f.document.getElementById('chart').textContent, /Finish: 1/);
    await f.edit(1, 's', 'finish');
    assert.equal(Number((await f.store.load()).programs[0].progress), 100);
    assert.equal(f.document.querySelectorAll('[data-k="p"]').length, 0);
});

test('edits use database UUIDs and persist subfunctions, dates, names and notes', async t => {
    const f = await fixture(t);
    await f.addProgram(); await f.addSub('Tahap');
    await f.edit(0, 'a', 'Channel Standardization');
    await f.edit(0, 'd', '2026-10-31');
    await f.edit(0, 'n', 'Tahap baru');
    await f.edit(0, 't', 'Catatan <script>alert(1)</script>');
    await f.edit(null, 't', 'Catatan program');
    await f.app.start();
    const rows = await f.store.load();
    assert.equal(rows.programs[0].subprograms[0].subfunction_id, 2);
    assert.equal(rows.programs[0].subprograms[0].name, 'Tahap baru');
    assert.equal(rows.programs[0].notes, 'Catatan program');
    assert.equal(rows.charts.find(c => c.subfunction_id === 2).total_subprograms, 1);
    assert.equal(f.document.querySelector('#rows script'), null);
});

test('renamed subfunction keeps legacy database references, records, filters and chart counts working', async t => {
    const f = await fixture(t);
    const label = 'Terminal Code & Standar';
    await f.db.exec("reset role; update public.tcs_subfunctions set name = 'Terminal Code & Standardization' where id = 3; set role authenticated;");
    await f.app.start();
    await f.addProgram();
    await f.edit(null, 'a', label);
    await f.addSub('Tahap evaluasi');
    await f.edit(0, 't', 'Keterangan tetap tersimpan');
    await f.edit(0, 's', 'finish');
    const before = (await f.store.load()).programs[0];
    assert.equal(before.subfunction_id, 3);
    assert.equal(before.subprograms[0].subfunction_id, 3);

    const checkDisplay = () => {
        assert.equal(f.document.querySelector('[data-i="0"][data-k="a"]:not([data-j])').value, label);
        assert.equal(f.document.querySelector('[data-j="0"][data-k="a"]').value, label);
        const chart = [...f.document.querySelectorAll('.subfunction-chart')].find(c => c.querySelector('h3').textContent === label);
        assert.equal(chart.querySelector('.chart-count').textContent, '1');
        assert.match(chart.textContent, /Finish: 1/);
        assert.doesNotMatch(f.document.body.textContent, /Terminal Code & Standardization/);
        f.document.getElementById('area').value = label;
        f.document.getElementById('area').onchange();
        assert.equal(f.document.getElementById('empty').hidden, true);
    };
    checkDisplay();

    await f.db.exec("reset role; update public.tcs_subfunctions set name = 'Terminal Code & Standar' where id = 3; set role authenticated;");
    await f.app.start();
    checkDisplay();
    const after = (await f.store.load()).programs[0];
    assert.equal(after.id, before.id);
    assert.equal(after.subprograms[0].id, before.subprograms[0].id);
    assert.equal(after.subprograms[0].notes, 'Keterangan tetap tersimpan');
    assert.equal(Number(after.progress), 100);
    assert.deepEqual(f.errors, []);
});

test('closing/opening details does not write business data and survives a reload in the same tab', async t => {
    const f = await fixture(t); await f.addProgram(); await f.addSub('Tahap');
    const before = (await f.store.load()).programs[0].updated_at;
    await f.click('[data-close="0"]');
    assert.equal(f.document.querySelector('[data-close="0"]'), null);
    await f.app.start();
    assert.equal(f.document.querySelector('[data-close="0"]'), null);
    assert.equal(String((await f.store.load()).programs[0].updated_at), String(before));
    await f.click('[data-tg="0"]');
    assert.ok(f.document.querySelector('[data-close="0"]'));
});

test('deleting subprograms/programs removes them from the database and diagram', async t => {
    const f = await fixture(t); await f.addProgram(); await f.addSub('Satu'); await f.addSub('Dua');
    await f.click('[data-ds="0.0"]');
    assert.equal((await f.store.load()).programs[0].subprograms.length, 1);
    await f.click('[data-del="0"]');
    const remaining = await f.store.load();
    assert.equal(remaining.programs.length, 0);
    assert.ok(remaining.charts.every(c => c.total_subprograms === 0));
    assert.doesNotMatch(f.document.getElementById('chart').innerHTML, /NaN|Infinity/);
});

test('failed writes display an error, retain the draft, and never claim data is saved', async t => {
    const f = await fixture(t, store => ({ ...store, createProgram: async () => { throw new Error('Network unavailable'); } }));
    await f.addProgram('Belum tersimpan');
    assert.equal((await f.store.load()).programs.length, 0);
    assert.equal(f.document.getElementById('nName').value, 'Belum tersimpan');
    assert.match(f.errors.at(-1), /Changes have not been saved/);
});

test('a committed write followed by a failed refresh is recoverable without creating duplicates', async t => {
    let calls = 0;
    const f = await fixture(t, store => ({ ...store, load: async () => { if (++calls === 2) throw new Error('Load failed'); return store.load(); } }));
    await f.addProgram('Sudah tersimpan');
    assert.equal((await f.store.load()).programs.length, 1);
    assert.match(f.errors.at(-1), /Changes saved/);
    assert.equal(f.document.getElementById('addBtn').disabled, true);
    await f.app.start();
    assert.equal((await f.store.load()).programs.length, 1);
    assert.equal(f.document.getElementById('addBtn').disabled, false);
});

test('failed startup blocks writes and allows a retry', async t => {
    let first = true;
    const f = await fixture(t, store => ({ ...store, load: async () => { if (first) { first = false; throw new Error('Offline'); } return store.load(); } }));
    assert.equal(f.document.getElementById('addBtn').disabled, true);
    assert.match(f.errors.at(-1), /Unable to load data/);
    await f.app.start();
    assert.equal(f.document.getElementById('addBtn').disabled, false);
});

test('rerunning legacy SQL and login migration preserves records and keeps anonymous writes blocked', async t => {
    const f = await fixture(t); await f.addProgram('Tetap ada');
    await f.db.exec('reset role;');
    await f.db.exec(schema);
    await f.db.exec(autoWeights);
    await f.switchRole('anon');
    await assert.rejects(f.store.createProgram({ name: 'Must be blocked' }), /row-level security/);
    await f.db.exec('reset role;');
    await f.db.exec(requireLogin);
    await f.db.exec(requireLogin);
    await f.switchRole('authenticated', editorId);
    assert.equal((await f.store.load()).programs[0].name, 'Tetap ada');
});

test('adapter reads all pages rather than truncating more than 1,000 records', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: String(i).padStart(5, '0'), sort_order: i, subprograms: [] }));
    const requests = [];
    const store = createDashboardStore({ from(table) { return {
        select() { return this; }, order() { return this; },
        async range(start, end) { requests.push([table, start]); return { data: table === 'tcs_program_summary' ? rows.slice(start, end + 1) : [], error: null }; }
    }; } });
    assert.equal((await store.load()).programs.length, 1001);
    assert.ok(requests.some(([table, start]) => table === 'tcs_program_summary' && start === 1000));
});

test('adding subprograms divides all weights equally with exact 100 percent totals', async t => {
    const f = await fixture(t); await f.addProgram();
    const expected = [[100], [50, 50], [33, 33, 34], [25, 25, 25, 25], [20, 20, 20, 20, 20], [16, 16, 17, 17, 17, 17]];
    for (let i = 0; i < expected.length; i++) {
        await f.addSub(`Tahap ${i + 1}`);
        const program = (await f.store.load()).programs[0];
        assert.deepEqual(program.subprograms.map(u => Number(u.weight)), expected[i]);
        assert.equal(Number(program.weight_total), 100);
        assert.equal(program.weight_valid, true);
        assert.ok(program.subprograms.every(u => Number.isInteger(Number(u.weight))));
    }
});

test('rebalance replaces manual weights but preserves existing status, date, note and ID', async t => {
    const f = await fixture(t); await f.addProgram(); await f.addSub('Satu');
    await f.edit(0, 's', 'finish');
    await f.edit(0, 'd', '2026-12-01');
    await f.edit(0, 't', 'Tetap disimpan');
    await f.edit(0, 'w', '80');
    const original = (await f.store.load()).programs[0].subprograms[0];
    await f.addSub('Dua');
    const program = (await f.store.load()).programs[0];
    assert.equal(program.subprograms[0].id, original.id);
    assert.equal(program.subprograms[0].status, 'finish');
    assert.equal(program.subprograms[0].notes, 'Tetap disimpan');
    assert.equal(program.subprograms[0].target_date, original.target_date);
    assert.deepEqual(program.subprograms.map(u => Number(u.weight)), [50, 50]);
    assert.equal(Number(program.progress), 50);
    assert.equal(program.status, 'ongoing');
});

test('a failure while redistributing weights rolls back the newly inserted child too', async t => {
    const f = await fixture(t); await f.addProgram(); await f.addSub('Satu');
    await f.db.exec(`reset role;
        create function public.tcs_test_fail_weight() returns trigger language plpgsql as $$ begin raise exception 'Simulated rebalance failure'; end; $$;
        create trigger tcs_test_fail_weight before update of weight on public.tcs_subprograms for each row execute function public.tcs_test_fail_weight();
        set role authenticated;`);
    await f.addSub('Tidak boleh tersimpan');
    const program = (await f.store.load()).programs[0];
    assert.equal(program.subprograms.length, 1);
    assert.equal(Number(program.subprograms[0].weight), 100);
    assert.match(f.errors.at(-1), /Changes have not been saved/);
});

test('upgrade converts decimal weights to whole numbers while keeping a valid total and existing data', async t => {
    const f = await fixture(t); await f.addProgram();
    await f.addSub('Satu'); await f.addSub('Dua'); await f.addSub('Tiga');
    await f.edit(0, 't', 'Jangan dihapus');
    await f.db.exec(`reset role;
        alter table public.tcs_subprograms drop constraint tcs_subprograms_integer_weight;
        update public.tcs_subprograms set weight = case sort_order when 2 then 33.34 else 33.33 end;`);
    await f.db.exec(autoWeights);
    await f.db.exec(autoWeights);
    await f.db.exec('set role authenticated;');
    const program = (await f.store.load()).programs[0];
    assert.deepEqual(program.subprograms.map(u => Number(u.weight)), [33, 33, 34]);
    assert.equal(Number(program.weight_total), 100);
    assert.equal(program.subprograms[0].notes, 'Jangan dihapus');
    await assert.rejects(f.store.updateSubprogram(program.subprograms[0].id, { weight: 33.5 }), /integer_weight/);
});

test('overdue unfinished programs show a red progress bar and percentage while status and edits remain unchanged', async t => {
    const f = await fixture(t); await f.addProgram(); await f.addSub('Satu'); await f.addSub('Dua');
    await f.edit(0, 's', 'finish');
    await f.edit(null, 'd', '2000-01-01');
    let progress = f.document.querySelector('.prog');
    assert.equal(progress.style.getPropertyValue('--c'), 'var(--bad)');
    assert.equal(progress.style.color, 'var(--bad)');
    assert.equal(progress.querySelector('.pct').textContent, '50%');
    assert.equal(f.document.querySelector('#rows .pill').textContent, 'On Going');
    assert.equal(f.document.querySelector('[data-i="0"][data-k="t"]:not([data-j])').disabled, false);

    await f.edit(null, 'd', '2099-01-01');
    assert.equal(f.document.querySelector('.prog').style.getPropertyValue('--c'), 'var(--warn)');
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await f.edit(null, 'd', today);
    assert.equal(f.document.querySelector('.prog').style.getPropertyValue('--c'), 'var(--warn)');

    await f.edit(null, 'd', '2000-01-01');
    await f.edit(1, 's', 'finish');
    progress = f.document.querySelector('.prog');
    assert.equal(progress.style.getPropertyValue('--c'), 'var(--ok)');
    assert.equal(progress.querySelector('.pct').textContent, '100%');
});

test('program names can be edited, persist after reload and reject blank names without changing children', async t => {
    const f = await fixture(t); await f.addProgram(); await f.addSub('Tahap tetap');
    const before = (await f.store.load()).programs[0];
    const name = 'Pengelolaan Audit Internal & Eksternal <script>alert(1)</script>';
    await f.edit(null, 'n', `  ${name}  `);
    await f.app.start();
    const after = (await f.store.load()).programs[0];
    assert.equal(after.id, before.id);
    assert.equal(after.name, name);
    assert.deepEqual(after.subprograms, before.subprograms);
    assert.equal(f.document.querySelector('.program-name').value, name);
    assert.equal(f.document.querySelector('#rows script'), null);
    await f.edit(null, 'n', '   ');
    assert.equal((await f.store.load()).programs[0].name, name);
    assert.equal(f.document.querySelector('.program-name').value, name);
    assert.equal(f.errors.at(-1), 'Program name is required.');
    f.document.getElementById('q').value = 'Audit Internal';
    f.document.getElementById('q').oninput();
    assert.equal(f.document.getElementById('empty').hidden, true);
    assert.equal(f.document.querySelector('.program-name').value, name);
});

test('overdue subprogram targets turn green when finished and red when unfinished', async t => {
    const f = await fixture(t); await f.addProgram(); await f.addSub('Satu'); await f.addSub('Dua');
    await f.edit(null, 'd', '2099-01-01');
    const target = () => f.document.querySelector('[data-j="0"][data-k="d"]');
    const checkTarget = (overdue, finished = false) => {
        assert.equal(target().style.color, finished ? 'var(--ok)' : overdue ? 'var(--bad)' : '');
        assert.equal(target().closest('td').querySelector('small')?.textContent ?? '', overdue ? 'Target date passed' : '');
        assert.equal(target().disabled, false);
    };
    await f.edit(0, 'd', '2000-01-01');
    checkTarget(true);
    assert.equal(f.document.querySelector('[data-j="1"][data-k="d"]').style.color, '');
    assert.equal(f.document.querySelector('.prog').style.getPropertyValue('--c'), 'var(--hold)');
    await f.edit(0, 's', 'ongoing'); checkTarget(true);
    await f.edit(0, 's', 'finish'); checkTarget(false, true);
    await f.app.start(); checkTarget(false, true);
    await f.edit(0, 's', 'initiate'); checkTarget(true);

    await f.edit(0, 'd', '2099-01-01'); checkTarget(false);
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await f.edit(0, 'd', today); checkTarget(false);
    await f.edit(0, 'd', ''); checkTarget(false);
    await f.edit(null, 'd', '2000-01-01'); checkTarget(false);
    assert.deepEqual(f.errors, []);
});

test('anonymous and unapproved signed-in users can read but cannot write via tables or RPC', async t => {
    const f = await fixture(t); await f.addProgram('Shared program'); await f.addSub('Shared stage');
    const before = (await f.store.load()).programs[0];
    for (const [role, id] of [['anon', ''], ['authenticated', viewerId]]) {
        await f.switchRole(role, id);
        const client = databaseClient(f.db);
        assert.equal((await client.rpc('tcs_can_edit')).data, false);
        assert.equal((await f.store.load()).programs[0].name, 'Shared program');
        for (const write of [
            () => f.store.createProgram({ name: 'Blocked program' }),
            () => f.store.updateProgram(before.id, { name: 'Blocked rename' }),
            () => f.store.deleteProgram(before.id),
            () => f.store.createSubprogram(before.id, { name: 'Blocked child' }),
            () => f.store.updateSubprogram(before.subprograms[0].id, { notes: 'Blocked edit' }),
            () => f.store.deleteSubprogram(before.subprograms[0].id),
            () => f.store.addSubprogramWithEqualWeights(before.id, 'Blocked RPC child')
        ]) await assert.rejects(write());
        await assert.rejects(f.db.query('insert into public.tcs_editors (user_id) values ($1)', [viewerId]), /permission denied/);
        assert.deepEqual((await f.store.load()).programs[0], before);
    }
    await f.switchRole('anon');
    const grants = await f.db.query(`select
        has_column_privilege('anon', 'public.tcs_programs', 'name', 'INSERT') as can_insert,
        has_column_privilege('anon', 'public.tcs_subprograms', 'notes', 'UPDATE') as can_update`);
    assert.deepEqual(grants.rows[0], { can_insert: false, can_update: false });
});

test('approved editors keep CRUD and RPC access, and removing approval takes effect immediately', async t => {
    const f = await fixture(t);
    assert.equal((await databaseClient(f.db).rpc('tcs_can_edit')).data, true);
    await f.addProgram(); await f.addSub('Editable');
    await f.edit(0, 's', 'finish'); await f.edit(null, 'n', 'Renamed by editor');
    const before = (await f.store.load()).programs[0];
    await f.db.exec('reset role;');
    await f.db.query('delete from public.tcs_editors where user_id = $1', [editorId]);
    await f.switchRole('authenticated', editorId);
    assert.equal((await databaseClient(f.db).rpc('tcs_can_edit')).data, false);
    await assert.rejects(f.store.updateProgram(before.id, { name: 'Not allowed anymore' }));
    await assert.rejects(f.store.addSubprogramWithEqualWeights(before.id, 'Not allowed anymore'));
    assert.deepEqual((await f.store.load()).programs[0], before);
    await f.db.exec('reset role;');
    const grant = fs.readFileSync(path.join(root, 'supabase/grant-editor.sql'), 'utf8').replace(/editor_email text := '[^']+'/, "editor_email text := 'editor@example.test'");
    await f.db.exec(grant); await f.db.exec(grant);
    await f.switchRole('authenticated', editorId);
    await f.store.deleteProgram(before.id);
    assert.equal((await f.store.load()).programs.length, 0);
});

test('view-only UI keeps search, filters and expansion while blocking forged edit and delete events', async t => {
    const f = await fixture(t); await f.addProgram('Public program'); await f.addSub('Public stage');
    const before = (await f.store.load()).programs[0];
    f.app.setCanEdit(false);
    assert.equal(f.document.querySelector('.add').hidden, true);
    assert.equal(f.document.querySelectorAll('#rows input, #rows textarea, #rows select, [data-del], [data-ds], [data-as]').length, 0);
    assert.match(f.document.getElementById('rows').textContent, /Public stage/);
    await f.click('[data-close="0"]'); await f.click('[data-tg="0"]');
    f.document.getElementById('q').value = 'Public'; f.document.getElementById('q').oninput();
    assert.equal(f.document.getElementById('empty').hidden, true);
    const forgedInput = f.document.createElement('input');
    Object.assign(forgedInput.dataset, { i: '0', k: 'n' }); forgedInput.value = 'Forged rename';
    await f.document.getElementById('rows').onchange({ target: forgedInput });
    const forgedDelete = f.document.createElement('button'); forgedDelete.dataset.del = '0';
    await f.document.getElementById('rows').onclick({ target: forgedDelete });
    await f.document.getElementById('addBtn').onclick();
    assert.deepEqual((await f.store.load()).programs[0], before);
    f.app.setCanEdit(true);
    assert.equal(f.document.querySelector('.add').hidden, false);
    assert.equal(f.document.querySelector('.program-name').value, 'Public program');
});

test('login UI handles invalid login, approved login, logout and expired sessions without retaining passwords', async t => {
    const f = await fixture(t); await f.addProgram();
    const dialog = f.document.getElementById('loginDialog');
    dialog.showModal = () => { dialog.open = true };
    dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new f.dom.window.Event('close')) };
    let current = { user: null, canEdit: false }, listener;
    const auth = {
        onChange(fn) { listener = fn; return () => { listener = null } },
        async getAccess() { return current },
        async signIn(email, password) {
            if (password !== 'test-password') throw new Error('Invalid login');
            current = { user: { id: editorId, email }, canEdit: email === 'editor@example.test' };
            listener('SIGNED_IN');
        },
        async signOut() { current = { user: null, canEdit: false }; listener('SIGNED_OUT') }
    };
    const login = mountLogin({ document: f.document, dashboard: f.app, getAuth: async () => auth });
    t.after(() => login.destroy());
    await login.start();
    assert.equal(f.document.querySelector('.program-name'), null);
    await f.document.getElementById('login').onclick();
    assert.equal(dialog.open, true);
    f.document.getElementById('loginEmail').value = 'editor@example.test';
    const submit = async password => {
        f.document.getElementById('loginPassword').value = password;
        await f.document.getElementById('loginForm').onsubmit({ preventDefault() {} });
        assert.equal(f.document.getElementById('loginPassword').value, '');
    };
    await submit('wrong-password');
    assert.equal(dialog.open, true);
    assert.match(f.document.getElementById('loginError').textContent, /Invalid login/);
    assert.equal(f.document.querySelector('.program-name'), null);
    f.document.getElementById('loginEmail').value = 'viewer@example.test';
    await submit('test-password');
    assert.equal(dialog.open, true);
    assert.match(f.document.getElementById('loginError').textContent, /view-only access/);
    assert.equal(f.document.querySelector('.program-name'), null);
    f.document.getElementById('loginEmail').value = 'editor@example.test';
    await submit('test-password');
    assert.equal(dialog.open, false);
    assert.ok(f.document.querySelector('.program-name'));
    assert.equal(f.document.getElementById('login').textContent, 'Logout');
    await f.document.getElementById('login').onclick();
    assert.equal(f.document.querySelector('.program-name'), null);
    assert.equal(f.document.getElementById('login').textContent, 'Login');
    await f.document.getElementById('login').onclick(); await submit('test-password');
    current = { user: null, canEdit: false }; listener('SIGNED_OUT');
    assert.equal(f.document.querySelector('.program-name'), null);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.document.getElementById('accessMode').textContent, 'View only');
});

test('auth adapter verifies user identity and database approval instead of trusting local session or user metadata', async () => {
    let session = null, user = null, approval = false, userError = null, rpcError = null, rpcCalls = 0;
    const service = createDashboardAuth({
        auth: {
            async getSession() { return { data: { session }, error: null } },
            async getUser() { return { data: { user }, error: userError } }
        },
        async rpc(name) { assert.equal(name, 'tcs_can_edit'); rpcCalls++; return { data: approval, error: rpcError } }
    });
    assert.deepEqual(await service.getAccess(), { user: null, canEdit: false });
    assert.equal(rpcCalls, 0);
    session = { user: { id: editorId, user_metadata: { admin: true } } };
    user = session.user;
    assert.equal((await service.getAccess()).canEdit, false);
    approval = true;
    assert.equal((await service.getAccess()).canEdit, true);
    rpcError = new Error('Missing function');
    await assert.rejects(service.getAccess(), /could not be verified/);
    userError = new Error('Invalid token');
    await assert.rejects(service.getAccess(), /session has expired/);
});

test('a stale access check cannot restore editor controls after a signed-out event', async t => {
    const dom = new JSDOM(html);
    let listener, resolveAccess, signalStarted, canEdit = false;
    const started = new Promise(resolve => { signalStarted = resolve });
    const pending = new Promise(resolve => { resolveAccess = resolve });
    let calls = 0;
    const login = mountLogin({
        document: dom.window.document,
        dashboard: { setCanEdit(value) { canEdit = value } },
        getAuth: async () => ({
            onChange(fn) { listener = fn; return () => {} },
            getAccess() { if (++calls === 1) { signalStarted(); return pending } return Promise.resolve({ user: null, canEdit: false }) }
        })
    });
    t.after(() => { login.destroy(); dom.window.close() });
    const first = login.start();
    await started;
    listener('SIGNED_OUT');
    await new Promise(resolve => setTimeout(resolve, 20));
    resolveAccess({ user: { id: editorId }, canEdit: true });
    await first;
    assert.equal(canEdit, false);
    assert.equal(dom.window.document.getElementById('login').textContent, 'Login');
});
