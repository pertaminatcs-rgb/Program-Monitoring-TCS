// Database adapter used by app.mjs and dashboard.mjs.
// Pass an initialized Supabase JS client (publishable key, never a secret key).
export function createDashboardStore(client) {
    const programFields = ['name', 'subfunction_id', 'legacy_subfunction', 'target_date', 'notes', 'sort_order'];
    const subprogramFields = [...programFields, 'weight', 'status'];
    const unwrap = ({ data, error }) => {
        if (error) {
            const messages = {
                'Nama subprogram wajib diisi.': 'Subprogram name is required.',
                'Program tidak ditemukan. Muat ulang data.': 'Program not found. Refresh the page to load the latest data.'
            };
            throw new Error(messages[error.message] || error.message);
        }
        return data;
    };
    const pick = (input, allowed) => Object.fromEntries(
        allowed.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]])
    );
    async function readAll(table, orderColumn = 'id') {
        const rows = [];
        // Supabase commonly limits a response to 1,000 rows. Read all pages.
        for (let offset = 0; ; offset += 1000) {
            const page = unwrap(await client.from(table).select('*').order(orderColumn).range(offset, offset + 999));
            rows.push(...page);
            if (page.length < 1000) return rows;
        }
    }
    const insert = async (table, row) => unwrap(await client.from(table).insert(row).select().single());
    const update = async (table, id, row) => {
        if (!Object.keys(row).length) throw new Error('There are no fields to update.');
        return unwrap(await client.from(table).update(row).eq('id', id).select().single());
    };
    const remove = async (table, id) => unwrap(await client.from(table).delete().eq('id', id).select('id').single());

    return {
        async load() {
            const [subfunctions, programs, subprograms, charts] = await Promise.all([
                readAll('tcs_subfunctions'), readAll('tcs_program_summary'),
                readAll('tcs_subprograms'), readAll('tcs_subfunction_summary', 'subfunction_id')
            ]);
            const order = (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id);
            const children = new Map();
            for (const row of subprograms) {
                if (!children.has(row.program_id)) children.set(row.program_id, []);
                children.get(row.program_id).push(row);
            }
            return {
                subfunctions, charts,
                unmappedSubprograms: subprograms.filter(row => row.subfunction_id == null).length,
                programs: programs.sort(order).map(row => ({ ...row, subprograms: (children.get(row.id) || []).sort(order) }))
            };
        },
        createProgram: input => insert('tcs_programs', pick(input, programFields)),
        updateProgram: (id, input) => update('tcs_programs', id, pick(input, programFields)),
        deleteProgram: id => remove('tcs_programs', id),
        createSubprogram: (programId, input) => insert('tcs_subprograms', { ...pick(input, subprogramFields), program_id: programId }),
        addSubprogramWithEqualWeights: async (programId, name) => unwrap(await client.rpc('tcs_add_subprogram_equal_weights', { p_program_id: programId, p_name: name })),
        updateSubprogram: (id, input) => update('tcs_subprograms', id, pick(input, subprogramFields)),
        deleteSubprogram: id => remove('tcs_subprograms', id)
    };
}
