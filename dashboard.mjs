export function mountDashboard({ document, getStore, confirm = globalThis.confirm, matchMedia = globalThis.matchMedia, notifyError = text => globalThis.alert(text) }) {
    const ST = { initiate: ["Initiate", "var(--hold)"], ongoing: ["On Going", "var(--warn)"], finish: ["Finish", "var(--ok)"] };
    const statusKey = s => ({ ok: "ongoing", warn: "ongoing", bad: "ongoing", notyet: "initiate", hold: "initiate", done: "finish" })[s] || (Object.hasOwn(ST, s) ? s : "initiate");
    const SUBFUNCTIONS = ["Terminal Standardization", "Channel Standardization", "Terminal Code & Standar", "Procedure & Compliance"];
    const subfunctionName = name => name === "Terminal Code & Standardization" ? SUBFUNCTIONS[2] : name;
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` };
    const percent = v => Math.round(Math.max(0, Math.min(100, Number(v) || 0)));
    let data = [], filter = "all", store = null, busy = false, loaded = false;
    let chartSnapshot = { groups: SUBFUNCTIONS.map(a => ({ a, total: 0, counts: { initiate: 0, ongoing: 0, finish: 0 } })), unassigned: 0 };
    const openState = new Map();
    const references = new Map();
    const $ = id => document.getElementById(id);
    function syncControls() {
        document.querySelectorAll('#rows input, #rows select, #rows button, .add input, .add select, #addBtn, #exp').forEach(control => control.disabled = busy || !loaded);
        $("rows").setAttribute('aria-busy', String(busy));
    }
    function acceptSnapshot(snapshot) {
        const names = new Map(snapshot.subfunctions.map(f => [f.id, subfunctionName(f.name)]));
        references.clear();
        snapshot.subfunctions.forEach(f => references.set(subfunctionName(f.name), f.id));
        data = snapshot.programs.map(row => ({
            id: row.id, n: row.name, a: subfunctionName(names.get(row.subfunction_id) || row.legacy_subfunction || ""),
            d: row.target_date || "", t: row.notes || "", order: row.sort_order,
            open: openState.get(row.id) || false,
            summary: { s: statusKey(row.status), p: row.progress == null ? null : Number(row.progress), weight: Number(row.weight_total), valid: row.weight_valid === true },
            subs: row.subprograms.map(u => ({ id: u.id, n: u.name, a: subfunctionName(names.get(u.subfunction_id) || u.legacy_subfunction || ""), w: Number(u.weight), s: statusKey(u.status), d: u.target_date || "", t: u.notes || "", order: u.sort_order }))
        }));
        const charts = new Map(snapshot.charts.map(c => [subfunctionName(c.subfunction_name), c]));
        chartSnapshot = { unassigned: snapshot.unmappedSubprograms, groups: SUBFUNCTIONS.map(a => {
            const row = charts.get(a);
            return { a, total: Number(row?.total_subprograms || 0), counts: { initiate: Number(row?.initiate_count || 0), ongoing: Number(row?.ongoing_count || 0), finish: Number(row?.finish_count || 0) } };
        }) };
        loaded = true;
        render();
    }
    async function loadInitialData() {
        if (busy) return false;
        busy = true;
        syncControls();
        try {
            if (!store) store = await getStore();
            acceptSnapshot(await store.load());
            return true;
        } catch (error) {
            loaded = false;
            notifyError("Unable to load data. Refresh the page to try again. Details: " + error.message);
            return false;
        } finally { busy = false; syncControls() }
    }
    async function mutate(action, afterSave) {
        if (busy || !loaded) return false;
        busy = true;
        syncControls();
        let committed = false;
        try {
            const record = await action();
            committed = true;
            if (afterSave) afterSave(record);
            acceptSnapshot(await store.load());
            return true;
        } catch (error) {
            if (committed) loaded = false;
            render();
            notifyError((committed ? "Changes saved, but the display could not be updated. Refresh the page to view the latest data. Details: " : "Changes have not been saved. Please try again. Details: ") + error.message);
            return false;
        } finally { busy = false; syncControls() }
    }
    function subfunctionFields(name) {
        const id = references.get(name);
        if (id == null) throw new Error("Select one of the four TCS subfunctions.");
        return { subfunction_id: id, legacy_subfunction: "" };
    }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const opts = (arr, sel) => arr.map(x => `<option value="${esc(x)}"${x == sel ? " selected" : ""}>${esc(x)}</option>`).join("");
    const stOpts = sel => Object.keys(ST).map(k => `<option value="${k}"${k == statusKey(sel) ? " selected" : ""}>${ST[k][0]}</option>`).join("");
    const areaOpts = sel => (SUBFUNCTIONS.includes(sel) ? "" : `<option value="${esc(sel || "")}" selected>${sel ? esc(sel) + " — select a subfunction" : "Select a subfunction"}</option>`) + opts(SUBFUNCTIONS, sel);
    $("date").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    $("area").innerHTML = "<option value=''>All subfunctions</option>" + opts(SUBFUNCTIONS);
    $("nArea").innerHTML = opts(SUBFUNCTIONS);
    function calc(x) {
        return x.summary;
    }
    function chartData() {
        return chartSnapshot;
    }
    function renderChart() {
        const { groups, unassigned } = chartData();
        const max = Math.max(1, ...groups.map(g => g.total));
        const charts = groups.map(g => {
            const height = g.total / max * 100;
            const breakdown = Object.keys(ST).map(k => `<span class="pill" style="--c:${ST[k][1]}">${ST[k][0]}: ${g.counts[k]}</span>`).join("");
            const segments = ["finish", "ongoing", "initiate"].filter(k => g.counts[k] > 0).map(k => `<div class="status-segment" style="height:${g.counts[k] / g.total * 100}%;background:${ST[k][1]};${k == "ongoing" ? "color:#14283a" : ""}" title="${ST[k][0]}: ${g.counts[k]}">${g.counts[k] / max * 170 >= 18 ? g.counts[k] : ""}</div>`).join("");
            const description = `${g.a}: ${g.total} subprogram${g.total == 1 ? "" : "s"} in total, Initiate ${g.counts.initiate}, On Going ${g.counts.ongoing}, Finish ${g.counts.finish}`;
            return `<section class="subfunction-chart"><h3>${esc(g.a)}</h3><div class="chart-bars" role="img" aria-label="${esc(description)}"><div class="chart-column total-bar" style="height:${height}%"><span class="chart-count">${g.total}</span></div><div class="chart-column status-bar" style="height:${height}%"><span class="chart-count">${g.total}</span>${segments}</div></div><div class="chart-labels"><span>Total</span><span>Status</span></div><div class="chart-breakdown">${breakdown}</div></section>`;
        }).join("");
        $("chart").innerHTML = `<h2>Subprogram Summary by Subfunction</h2><div class="sub">Subprogram totals and status distribution for each subfunction.</div><div class="subfunction-charts">${charts}</div>${unassigned ? `<div class="sub" style="margin-top:10px">${unassigned} subprogram${unassigned == 1 ? " has" : "s have"} not been assigned to a TCS subfunction.</div>` : ""}`;
    }
    const field = (x, j, k, type, value, label, overdue = false) => `<input type="${type}" ${type == "number" ? 'min="0" max="100" step="1"' : ""} value="${esc(value ?? "")}" data-i="${x.i}" data-j="${j}" data-k="${k}" data-key="${x.i}.${j}.${k}" aria-label="${esc(label)} for ${esc(x.subs[j].n)}"${overdue ? ' style="color:var(--bad)"' : ""}>${overdue ? '<small style="color:var(--bad)">Target date passed</small>' : ""}`;
    function subtable(x) {
        const c = x.c;
        const warning = x.subs.length && !c.valid;
        const difference = Math.round(Math.abs(100 - c.weight) * 100) / 100;
        let h = `<div class="weight-total${warning ? " invalid" : ""}" ${warning ? 'role="alert"' : 'role="status"'}>${x.subs.length ? `Total weight: ${c.weight}%${warning ? `. Total weight must be 100% (${difference}% ${c.weight < 100 ? "short" : "over"}). Adjust the weights to calculate program progress.` : "."}` : "Program status and progress are calculated from subprograms. Add a subprogram to get started."}</div>`;
        h += `<div class="qt"><table class="subtable"><thead><tr><th>Weight (%)</th><th>Subprogram</th><th>Subfunction</th><th>Status</th><th>Target Date</th><th>Remarks</th><th></th></tr></thead><tbody>`;
        h += x.subs.map((u, j) => `<tr>
            <td>${field(x, j, "w", "number", u.w, "Weight")}</td>
            <td>${field(x, j, "n", "text", u.n, "Subprogram name")}</td>
            <td><select data-i="${x.i}" data-j="${j}" data-k="a" data-key="${x.i}.${j}.a" aria-label="Subfunction for ${esc(u.n)}">${areaOpts(u.a)}</select></td>
            <td><div class="pill" style="--c:${ST[statusKey(u.s)][1]}"><select data-i="${x.i}" data-j="${j}" data-k="s" data-key="${x.i}.${j}.s" aria-label="Status for ${esc(u.n)}">${stOpts(u.s)}</select></div></td>
            <td>${field(x, j, "d", "date", u.d, "Target date", u.d && u.d < day(0))}</td>
            <td>${field(x, j, "t", "text", u.t, "Remarks")}</td>
            <td><button class="x" data-ds="${x.i}.${j}" aria-label="Delete ${esc(u.n)}">Delete</button></td>
        </tr>`).join("");
        h += `</tbody></table></div><div style="padding:8px 0 0 34px;display:flex;flex-wrap:wrap;gap:8px;align-items:center"><input type="text" class="nw" data-ni="${x.i}" placeholder="New subprogram name" aria-label="New subprogram name" style="margin-left:0"> <button data-as="${x.i}">Add Subprogram</button> <button data-close="${x.i}" aria-label="Close subprograms for ${esc(x.n)}">Close Subprograms</button></div>`;
        return h;
    }
    function render() {
        const D = data.map((x, i) => ({ ...x, i, c: calc(x) }));
        const c = Object.fromEntries(Object.keys(ST).map(k => [k, 0])); D.forEach(x => c[x.c.s]++);
        $("kpis").innerHTML = `<button class="kpi${filter == "all" ? " on" : ""}" data-f="all"><b>${data.length}</b><span>All Programs</span></button>` +
            Object.keys(ST).map(k => `<button class="kpi${filter == k ? " on" : ""}" data-f="${k}" style="--c:${ST[k][1]}"><b>${c[k]}</b><span>${ST[k][0]}</span></button>`).join("");
        $("bar").innerHTML = Object.keys(ST).map(k => `<i style="width:${data.length ? c[k] / data.length * 100 : 0}%;background:${ST[k][1]}"></i>`).join("");
        $("exp").textContent = data.length && data.every(x => x.open) ? "Collapse All" : "Expand All";
        const q = $("q").value.toLowerCase(), ar = $("area").value, today = day(0);
        const list = D.filter(x => (filter == "all" || x.c.s == filter) && (!ar || (ar == "__unassigned" ? !SUBFUNCTIONS.includes(x.a) : x.a == ar)) && x.n.toLowerCase().includes(q));
        renderChart();
        $("empty").textContent = data.length ? "No programs match your search or filter." : "No programs yet. Add a program to get started.";
        $("empty").hidden = !loaded || list.length > 0;
        $("rows").innerHTML = list.map(x => {
            const col = ST[x.c.s][1], od = x.d && x.d < today && x.c.s != "finish";
            const progressCol = od ? "var(--bad)" : col;
            let h = `<tr><td><div class="nm"><button class="tg" data-tg="${x.i}" aria-expanded="${!!x.open}" aria-label="${x.open ? "Close" : "Show"} subprograms for ${esc(x.n)}">${x.open ? "-" : "+"}</button><div><b>${esc(x.n)}</b><small>${x.subs.length} subprogram${x.subs.length == 1 ? "" : "s"}</small></div></div></td>
  <td><select data-i="${x.i}" data-k="a" data-key="${x.i}.a" aria-label="Subfunction for ${esc(x.n)}" style="max-width:260px;width:100%">${areaOpts(x.a)}</select></td>
  <td><div class="pill" style="--c:${col}">${ST[x.c.s][0]}</div></td>
  <td><div class="prog" style="--c:${progressCol};${od ? "color:var(--bad)" : ""}"><div><i style="width:${x.c.p || 0}%"></i></div><span class="pct">${x.c.p == null ? "–" : x.c.p + "%"}</span></div>${x.subs.length && !x.c.valid ? `<small style="color:var(--bad)">Total weight: ${x.c.weight}%; must be 100%.</small>` : ""}</td>
  <td><input type="date" value="${esc(x.d || "")}" data-i="${x.i}" data-k="d" data-key="${x.i}.d" aria-label="Target date for ${esc(x.n)}" style="background:transparent;border:1px solid var(--line);border-radius:4px;padding:3px 6px;${od ? "color:var(--bad)" : ""}">${od ? "<small>Target date passed</small>" : ""}</td>
  <td><input type="text" value="${esc(x.t || "")}" data-i="${x.i}" data-k="t" data-key="${x.i}.t" placeholder="Add remarks" aria-label="Remarks for ${esc(x.n)}" style="background:transparent;border:1px solid var(--line);border-radius:4px;padding:3px 6px;width:100%"></td>
  <td><button class="x" data-del="${x.i}" aria-label="Delete ${esc(x.n)}">Delete</button></td></tr>`;
            if (x.open) h += `<tr class="sub"><td colspan="7">${subtable(x)}</td></tr>`;
            return h
        }).join("");
        syncControls();
    }
    $("kpis").onclick = e => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; render() } };
    $("rows").onchange = async e => {
        const t = e.target, i = t.dataset.i, j = t.dataset.j, k = t.dataset.k;
        if (i == null || busy || !loaded) return;
        const program = data[+i];
        const target = j == null ? program : program?.subs[+j];
        if (!target || k == "p" || (j == null && (k == "s" || k == "w"))) return;
        let fields;
        try {
            if (k == "a") fields = subfunctionFields(t.value);
            else if (k == "w") fields = { weight: percent(t.value) };
            else if (k == "s") fields = { status: statusKey(t.value) };
            else if (k == "d") fields = { target_date: t.value || null };
            else if (k == "t") fields = { notes: t.value };
            else if (k == "n") { const name = t.value.trim(); if (!name) throw new Error("Subprogram name is required."); fields = { name } }
            else return;
        } catch (error) { render(); notifyError(error.message); return }
        await mutate(() => j == null ? store.updateProgram(target.id, fields) : store.updateSubprogram(target.id, fields));
    };
    $("rows").onclick = async e => {
        if (busy || !loaded) return;
        const close = e.target.closest("[data-close]");
        if (close) { const x = data[+close.dataset.close]; x.open = false; openState.set(x.id, false); render(); document.querySelector('[data-tg="' + close.dataset.close + '"]')?.focus(); return }
        const toggle = e.target.closest("[data-tg]");
        if (toggle) { const x = data[+toggle.dataset.tg]; x.open = !x.open; openState.set(x.id, x.open); render(); return }
        const add = e.target.closest("[data-as]");
        if (add) {
            const x = data[+add.dataset.as];
            const input = document.querySelector('[data-ni="' + add.dataset.as + '"]');
            const name = input.value.trim();
            if (!name) { input.focus(); return }
            await mutate(() => store.addSubprogramWithEqualWeights(x.id, name));
            return;
        }
        const subDelete = e.target.closest("[data-ds]");
        if (subDelete) { const [i, j] = subDelete.dataset.ds.split("."); const sub = data[+i].subs[+j]; await mutate(() => store.deleteSubprogram(sub.id)); return }
        const programDelete = e.target.closest("[data-del]");
        if (programDelete && confirm("This program and all its subprograms will be deleted. Continue?")) {
            const id = data[+programDelete.dataset.del].id;
            await mutate(() => store.deleteProgram(id), () => openState.delete(id));
        }
    };
    $("q").oninput = render;
    $("area").onchange = render;
    $("exp").onclick = () => {
        if (busy || !loaded) return;
        const open = !data.every(x => x.open);
        data.forEach(x => { x.open = open; openState.set(x.id, open) });
        render();
    };
    $("addBtn").onclick = async () => {
        if (busy || !loaded) return;
        const name = $("nName").value.trim();
        if (!name) { $("nName").focus(); return }
        let fields;
        try { fields = subfunctionFields($("nArea").value) } catch (error) { notifyError(error.message); return }
        await mutate(() => store.createProgram({ name, ...fields, target_date: $("nDate").value || null, notes: "", sort_order: data.length ? Math.max(...data.map(x => x.order)) + 1 : 0 }), row => {
            openState.set(row.id, true);
            filter = "all";
            $("q").value = "";
            $("area").value = "";
            $("nName").value = "";
            $("nDate").value = "";
        });
    };
    $("theme").onclick = () => {
        const root = document.documentElement;
        const dark = root.dataset.theme ? root.dataset.theme == "dark" : matchMedia("(prefers-color-scheme:dark)").matches;
        root.dataset.theme = dark ? "light" : "dark";
    };
    render();
    return { start: loadInitialData };
}
