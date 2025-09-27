import React, { useEffect, useMemo, useState } from "react";

/*****************
 * FLOUR TO DOUGH – OPS WEB APP (v3)
 * Adds: Consolidated paste parser for your end‑of‑day message.
 * Features:
 * - Daily Sales (manual + paste parser for Denny/Tebza formats)
 * - Accounts Receivable (auto from credit + payments)
 * - Consolidated Day (Produced, Damages, Delivered by Denny/Tebza, Walk-ins) + PASTE PARSER
 * - Production
 * - Raw Materials
 * - Expenses
 * - Cash Movements (non-expense inflow/outflow)
 * - Reports
 * Data stored in localStorage for instant testing.
 *****************/

// ===== Utilities =====
const currency = (n) => `R${(Math.round((Number(n)||0)*100)/100).toLocaleString()}`;
const num = (v) => Number(v||0);
const todayISO = () => new Date().toISOString().slice(0,10);
const uid = () => Math.random().toString(36).slice(2);

// Local storage helpers
const LS_KEY = "ftd_ops_state_v3"; // bumped schema
const loadState = () => {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const saveState = (state) => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch(e) { console.warn(e); } };

// ===== Data Shapes =====
// drivers: ["Denny","Tebza"] by default
// sales: {id, date, driver, customer, loaves, type: 'cash'|'credit'|'payment', amount, pricePerLoaf}
// receivables: computed ledger per customer from sales entries
// production: {id, date, product, produced, damages, closingStock}
// materials: {id, date, item, openingKg, receivedKg, usedKg, closingKg}
// expenses: {id, date, category, description, amount}
// cashMoves: {id, date, source:'Denny'|'Tebza'|'Walk-ins'|'Other', note, amount}
// consolidated: {id, date, rows:[{product, produced, damages, deliveredDenny, deliveredTebza, walkins}]}

const DEFAULT_STATE = {
  drivers: ["Denny","Tebza"],
  pricePerLoaf: 10,
  sales: [],
  production: [],
  materials: [],
  expenses: [],
  cashMoves: [],
  consolidated: []
};

// ===== Parser for Daily Sales Text (drivers) =====
function parseDailyReport(text, defaults = {driver: "", date: todayISO(), pricePerLoaf: 10}) {
  const lines = text.split(/\n|\r/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  for (let raw of lines) {
    let line = raw.replace(/[.,]$/,'');
    // payment-only line e.g. "Claudia payment R70" or "Pak2 paymentR10"
    if (/payment\s*R?\s*\d+/i.test(line)) {
      const name = line.split(/payment/i)[0].trim();
      const amtMatch = line.match(/payment\s*R?\s*([\d.,]+)/i);
      const amount = amtMatch ? Number(String(amtMatch[1]).replace(/[,]/g, "")) : 0;
      if (name) entries.push({ id: uid(), date: defaults.date, driver: defaults.driver, customer: name, loaves: 0, type: "payment", amount, pricePerLoaf: defaults.pricePerLoaf });
      continue;
    }
    // route style: "Ndlovu str 10(cash)" + optional inline payment "R60(payment)"
    const route = line.match(/^(.*?)\s+(\d+)\s*\((cash|cred\w*?)\)(?:.*?R\s*([\d.,]+)\s*\(payment\))?/i);
    if (route) {
      const customer = route[1].trim();
      const loaves = Number(route[2]);
      const type = route[3].toLowerCase().includes('cred')? 'credit':'cash';
      entries.push({ id: uid(), date: defaults.date, driver: defaults.driver, customer, loaves, type, amount: 0, pricePerLoaf: defaults.pricePerLoaf });
      if (route[4]) {
        const amount = Number(String(route[4]).replace(/[,]/g,''));
        entries.push({ id: uid(), date: defaults.date, driver: defaults.driver, customer, loaves: 0, type: 'payment', amount, pricePerLoaf: defaults.pricePerLoaf });
      }
      continue;
    }
    // classic style: "Customer (34) cash" or misspellings like credt
    const m = line.match(/^(.*?)\(([-\d]+)\)\s*(.*)$/);
    if (m) {
      const customer = m[1].trim();
      const loaves = Number(m[2]);
      const tail = (m[3]||"").toLowerCase();
      let type = tail.includes("cred") ? "credit" : tail.includes("cash") ? "cash" : "cash";
      entries.push({ id: uid(), date: defaults.date, driver: defaults.driver, customer, loaves, type, amount: 0, pricePerLoaf: defaults.pricePerLoaf });
      continue;
    }
  }
  return entries;
}

// ===== Receivables Computation =====
function buildReceivables(sales) {
  const map = new Map();
  for (const s of sales) {
    const name = s.customer?.trim();
    if (!name) continue;
    if (!map.has(name)) map.set(name, { customer: name, balance: 0, creditValue: 0, payments: 0, lastActivity: s.date, entries: [] });
    const rec = map.get(name);
    rec.lastActivity = s.date > rec.lastActivity ? s.date : rec.lastActivity;
    if (s.type === "credit") {
      const value = num(s.loaves) * num(s.pricePerLoaf||10);
      rec.balance += value;
      rec.creditValue += value;
      rec.entries.push({date: s.date, type: 'credit', value});
    }
    if (s.type === "payment") {
      rec.balance -= num(s.amount);
      rec.payments += num(s.amount);
      rec.entries.push({date: s.date, type: 'payment', value: num(s.amount)});
    }
  }
  const list = Array.from(map.values());
  list.sort((a,b)=> a.customer.localeCompare(b.customer));
  return list;
}

// ===== Consolidated Paste Parser (End-of-day) =====
function normalizeProduct(raw){
  const s = (raw||"").toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  if (s.includes('r10') || (s.includes('10') && s.includes('white'))) return 'R10 White Bread';
  if (s.includes('r12') && s.includes('white')) return 'R12 White Bread';
  if (s.includes('r12') && s.includes('brown')) return 'R12 Brown Bread';
  if (s.includes('white') && s.includes('10')) return 'R10 White Bread';
  if (s.includes('white') && s.includes('12')) return 'R12 White Bread';
  if (s.includes('brown') && s.includes('12')) return 'R12 Brown Bread';
  return raw?.trim()||'Unknown';
}
function parseNumber(str){ return str? Number(String(str).replace(/[^\d.-]/g,''))||0 : 0; }
function parseConsolidated(text){
  const rowsMap = new Map();
  const ensure = (p)=> { if(!rowsMap.has(p)) rowsMap.set(p,{product:p, produced:0, damages:0, deliveredDenny:0, deliveredTebza:0, walkins:0}); return rowsMap.get(p); };
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  let section = ''; let currentProduct = '';
  for (let raw of lines){
    const line = raw.replace(/[•*\-]\s*/,'');
    const lower = line.toLowerCase();
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(lower)) continue; // date line
    if (lower.includes('closing for yesterday')) { section = 'yclose'; continue; }
    if (lower.startsWith('closing')) { section = 'close'; continue; }
    if (lower.startsWith('produced')) { section = 'produced'; continue; }
    if (lower.startsWith('sold')) { section = 'sold'; currentProduct=''; continue; }
    if (lower.startsWith('damaged')) { section = 'damaged'; continue; }
    if (lower.startsWith('total cash on hand')) { section = 'cash'; continue; }

    if (section==='sold' && /white|brown/i.test(line) && /(r?10|r?12|10|12)/i.test(line)){
      currentProduct = normalizeProduct(line); ensure(currentProduct); continue;
    }
    if (section==='produced' && /(white|brown)/i.test(line)){
      const prod = normalizeProduct(line);
      const n = (line.match(/\(([-\d.,]+)\)/)||[])[1] || (line.match(/\b(\d{1,5})\b(?!.*\()/)||[])[1];
      ensure(prod).produced += parseNumber(n); continue;
    }
    if (section==='damaged' && /(white|brown)/i.test(line)){
      const prod = normalizeProduct(line);
      const n = (line.match(/\(([-\d.,]+)\)/)||[])[1] || (line.match(/\b(\d{1,5})\b(?!.*\()/)||[])[1];
      ensure(prod).damages += parseNumber(n); continue;
    }
    if (section==='sold'){
      const m = line.match(/(denny|danny|tebza|walkins)[^\d]*(\d{1,6})/i);
      if (m && currentProduct){
        const who = m[1].toLowerCase(); const v = parseNumber(m[2]); const rec = ensure(currentProduct);
        if (who.startsWith('den') || who.startsWith('dan')) rec.deliveredDenny += v;
        else if (who.startsWith('teb')) rec.deliveredTebza += v;
        else if (who.startsWith('walk')) rec.walkins += v;
        continue;
      }
      const m2 = line.match(/walkins.*?(\d{1,6})/i);
      if (m2 && currentProduct){ ensure(currentProduct).walkins += parseNumber(m2[1]); continue; }
    }
    if (section==='cash'){
      const m = line.match(/(denny|danny|tebza|walkins)\s*R?\s*([\d.,]+)/i);
      if (m){
        const who = m[1].toLowerCase(); const v = parseNumber(m[2]);
        if (!rowsMap.has('__cash__')) rowsMap.set('__cash__',{denny:0, tebza:0, walkins:0});
        const cash = rowsMap.get('__cash__');
        if (who.startsWith('den') || who.startsWith('dan')) cash.denny += v;
        else if (who.startsWith('teb')) cash.tebza += v;
        else if (who.startsWith('walk')) cash.walkins += v;
      }
    }
  }
  const cash = rowsMap.get('__cash__')||{denny:0,tebza:0,walkins:0};
  const rows = Array.from(rowsMap.entries()).filter(([k])=> k!=='__cash__').map(([,v])=> v);
  return {rows, cash};
}

// ===== Reusable UI =====
const Table = ({ columns = [], data = [], footer }) => (
  <div className="overflow-x-auto rounded-2xl shadow-sm border border-zinc-800">
    <table className="min-w-full text-sm">
      <thead className="bg-zinc-900">
        <tr>
          {columns.map((c,i)=> (
            <th key={i} className="px-3 py-2 text-left font-medium text-zinc-200">{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row,i)=> (
          <tr key={row.id || i} className={i%2?"bg-zinc-950":"bg-black"}>
            {columns.map((c,j)=> (
              <td key={j} className="px-3 py-2 text-zinc-100">{c.render ? c.render(row) : row[c.accessor]}</td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer && <tfoot className="bg-zinc-900"><tr><td className="px-3 py-2" colSpan={columns.length}>{footer}</td></tr></tfoot>}
    </table>
  </div>
);
const Input = (props) => <input {...props} className={`w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 ${props.className||''}`} />
const Select = (props) => <select {...props} className={`w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 ${props.className||''}`} />
const Button = ({children, ...props}) => <button {...props} className={`rounded-2xl px-4 py-2 text-sm font-medium bg-white text-black hover:opacity-90 active:opacity-80 ${props.className||''}`}>{children}</button>

// ===== Main App =====
export default function App(){
  const [state, setState] = useState(()=> loadState() || DEFAULT_STATE);
  useEffect(()=> { saveState(state); }, [state]);

  const [tab, setTab] = useState("sales");
  const setPrice = (v)=> setState(s=> ({...s, pricePerLoaf: num(v)}));

  const totals = useMemo(()=>{
    let cashSales=0, creditSales=0, payments=0, loavesSold=0;
    for (const s of state.sales) {
      if (s.type === 'cash') { cashSales += num(s.loaves)*num(s.pricePerLoaf||state.pricePerLoaf); loavesSold+=num(s.loaves); }
      if (s.type === 'credit') { creditSales += num(s.loaves)*num(s.pricePerLoaf||state.pricePerLoaf); loavesSold+=num(s.loaves); }
      if (s.type === 'payment') { payments += num(s.amount); }
    }
    return { cashSales, creditSales, payments, loavesSold, totalSalesValue: cashSales+creditSales };
  }, [state.sales, state.pricePerLoaf]);

  const receivables = useMemo(()=> buildReceivables(state.sales), [state.sales]);

  return (
    <div className="min-h-screen bg-black text-zinc-100 p-6">
      <header className="max-w-6xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Flour to Dough – Ops Console</h1>
          <p className="text-zinc-400 text-sm">Daily Sales • Receivables • Consolidated • Production • Materials • Expenses • Cash • Reports</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-400">Price/Loaf</label>
          <Input type="number" step="0.01" value={state.pricePerLoaf} onChange={(e)=> setPrice(e.target.value)} style={{width:100}} />
          <Button onClick={()=> { localStorage.removeItem(LS_KEY); location.reload(); }} className="bg-zinc-200">Reset</Button>
        </div>
      </header>

      <nav className="max-w-6xl mx-auto mt-6 flex flex-wrap gap-2">
        {[
          {k:"sales", t:"Daily Sales"},
          {k:"ar", t:"Accounts Receivable"},
          {k:"consolidated", t:"Consolidated Day"},
          {k:"production", t:"Production"},
          {k:"materials", t:"Raw Materials"},
          {k:"expenses", t:"Expenses"},
          {k:"cash", t:"Cash Movements"},
          {k:"reports", t:"Reports"},
        ].map(x=> (
          <Button key={x.k} onClick={()=> setTab(x.k)} className={tab===x.k?"":" bg-zinc-800 text-zinc-100 "}>{x.t}</Button>
        ))}
      </nav>

      <main className="max-w-6xl mx-auto mt-6 space-y-8">
        {tab==="sales" && <SalesTab state={state} setState={setState} />}
        {tab==="ar" && <ReceivablesTab receivables={receivables} />}
        {tab==="consolidated" && <ConsolidatedTab state={state} setState={setState} />}
        {tab==="production" && <ProductionTab state={state} setState={setState} />}
        {tab==="materials" && <MaterialsTab state={state} setState={setState} />}
        {tab==="expenses" && <ExpensesTab state={state} setState={setState} />}
        {tab==="cash" && <CashTab state={state} setState={setState} />}
        {tab==="reports" && <ReportsTab state={state} totals={totals} receivables={receivables} />}
      </main>
    </div>
  );
}

// ===== Sales Tab =====
function SalesTab({state, setState}){
  const [date, setDate] = useState(todayISO());
  const [driver, setDriver] = useState(state.drivers[0]||"");
  const [customer, setCustomer] = useState("");
  const [loaves, setLoaves] = useState(0);
  const [type, setType] = useState("cash");
  const [amount, setAmount] = useState(0);
  const [bulkText, setBulkText] = useState("");

  const addEntry = () => {
    const entry = { id: uid(), date, driver, customer, loaves: num(loaves), type, amount: num(amount), pricePerLoaf: state.pricePerLoaf };
    setState(s=> ({...s, sales: [entry, ...s.sales]}));
    setCustomer(""); setLoaves(0); setAmount(0);
  };

  const importBulk = () => {
    const entries = parseDailyReport(bulkText, {driver, date, pricePerLoaf: state.pricePerLoaf});
    if (!entries.length) return;
    setState(s=> ({...s, sales: [...entries.reverse(), ...s.sales]}));
    setBulkText("");
  };

  const columns = [
    {header:"Date", render: r=> r.date},
    {header:"Driver", render: r=> r.driver},
    {header:"Customer", render: r=> r.customer},
    {header:"Type", render: r=> r.type},
    {header:"Loaves", render: r=> r.loaves},
    {header:"Value", render: r=> r.type!=="payment"? currency(r.loaves * (r.pricePerLoaf||10)) : "-"},
    {header:"Payment", render: r=> r.type==="payment"? currency(r.amount): "-"},
  ];

  const filtered = state.sales.filter(s=> s.date===date && (!driver || s.driver===driver));
  let cash=0, credit=0, pay=0, loavesSold=0;
  for (const s of filtered) {
    if (s.type==='cash') { cash += num(s.loaves)*(s.pricePerLoaf||10); loavesSold+=num(s.loaves);} 
    if (s.type==='credit') { credit += num(s.loaves)*(s.pricePerLoaf||10); loavesSold+=num(s.loaves);} 
    if (s.type==='payment') { pay += num(s.amount);} 
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Add Entry</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400">Date</label>
            <Input type="date" value={date} onChange={e=> setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Driver</label>
            <Select value={driver} onChange={e=> setDriver(e.target.value)}>
              {state.drivers.map(d=> <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-zinc-400">Customer</label>
            <Input value={customer} onChange={e=> setCustomer(e.target.value)} placeholder="e.g., Zodwa" />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Loaves</label>
            <Input type="number" value={loaves} onChange={e=> setLoaves(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Type</label>
            <Select value={type} onChange={e=> setType(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="credit">Credit</option>
              <option value="payment">Payment (R)</option>
            </Select>
          </div>
          {type==="payment" && (
            <div className="col-span-2">
              <label className="text-xs text-zinc-400">Payment Amount</label>
              <Input type="number" value={amount} onChange={e=> setAmount(e.target.value)} placeholder="e.g., 110" />
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <Button onClick={addEntry}>Add</Button>
          <Button className="bg-zinc-800 text-zinc-100" onClick={()=> {setCustomer(""); setLoaves(0); setAmount(0);}}>Clear</Button>
        </div>

        <div className="mt-8 space-y-2">
          <h3 className="font-medium">Paste Daily Report (Auto-Parse)</h3>
          <textarea value={bulkText} onChange={e=> setBulkText(e.target.value)} rows={10} placeholder={`Zodwa (34) cash
Kota lend (12) credit
Kota lend payment R110
Claudia payment R70
Ndlovu str 10(cash)
1st container, thelle 10(credit)  R60(payment)`} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm"></textarea>
          <div className="flex gap-3">
            <Button onClick={importBulk}>Import</Button>
            <p className="text-xs text-zinc-400">Tip: Set the Date & Driver above before importing.</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Entries – {date} ({driver})</h2>
        <Table columns={columns} data={filtered} />
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Loaves Sold" value={loavesSold} />
          <StatCard label="Cash Sales" value={currency(cash)} />
          <StatCard label="Credit Given" value={currency(credit)} />
          <StatCard label="Payments In" value={currency(pay)} />
          <StatCard label="Cash on Hand" value={currency(cash + pay)} />
          <StatCard label="Total Sales Value" value={currency(cash + credit)} />
        </div>
      </div>
    </div>
  );
}

const StatCard = ({label, value}) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
    <div className="text-xs text-zinc-400">{label}</div>
    <div className="text-xl font-semibold">{value}</div>
  </div>
);

// ===== Receivables Tab =====
function ReceivablesTab({receivables}){
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [range, setRange] = useState({from: "", to: ""});

  const filtered = useMemo(()=>{
    const q = query.trim().toLowerCase();
    if (!q) return receivables;
    return receivables.filter(r=> r.customer.toLowerCase().includes(q));
  }, [receivables, query]);

  const columns = [
    {header:"Customer", render: r=> (
      <button className="underline underline-offset-2" onClick={()=> setSelected(r)}>{r.customer}</button>
    )},
    {header:"Credit Given", render: r=> currency(r.creditValue)},
    {header:"Payments", render: r=> currency(r.payments)},
    {header:"Balance", render: r=> <span className={r.balance>0?"text-red-300":"text-green-300"}>{currency(r.balance)}</span>},
    {header:"Last Activity", render: r=> r.lastActivity},
  ];

  const ledgerColumns = [
    {header:"Date", render: e=> e.date},
    {header:"Type", render: e=> e.type==='credit'? 'Credit (sale)': 'Payment'},
    {header:"Value", render: e=> currency(e.value)},
    {header:"Running Balance", render: e=> <span className={e.running>0?"text-red-300":"text-green-300"}>{currency(e.running)}</span>},
  ];

  const buildLedger = (rec)=>{
    if (!rec) return [];
    const rows = [...rec.entries].sort((a,b)=> a.date.localeCompare(b.date));
    let running = 0;
    return rows
      .filter(e=> (!range.from || e.date>=range.from) && (!range.to || e.date<=range.to))
      .map(e=>{
        running += (e.type==='credit'? +e.value : -e.value);
        return {...e, id: uid(), running};
      });
  };
  const ledger = useMemo(()=> buildLedger(selected), [selected, range]);

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-zinc-400">Search customers</label>
            <Input placeholder="Type a name, e.g., Zodwa" value={query} onChange={e=> setQuery(e.target.value)} />
          </div>
          {selected && <Button className="bg-zinc-800 text-zinc-100" onClick={()=> setSelected(null)}>Close Details</Button>}
        </div>
        <Table columns={columns} data={filtered} />
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Customer Account</h2>
        {!selected ? (
          <p className="text-sm text-zinc-400">Click a customer name on the left to view their statement and history.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid md:grid-cols-3 gap-3">
              <StatCard label="Customer" value={selected.customer} />
              <StatCard label="Balance" value={currency(selected.balance)} />
              <StatCard label="Last Activity" value={selected.lastActivity} />
            </div>

            <div className="flex items-end gap-3">
              <div>
                <label className="text-xs text-zinc-400">From</label>
                <Input type="date" value={range.from} onChange={(e)=> setRange(r=> ({...r, from: e.target.value}))} />
              </div>
              <div>
                <label className="text-xs text-zinc-400">To</label>
                <Input type="date" value={range.to} onChange={(e)=> setRange(r=> ({...r, to: e.target.value}))} />
              </div>
              <Button className="bg-zinc-800 text-zinc-100" onClick={()=> setRange({from:"", to:""})}>Clear</Button>
            </div>

            <Table columns={ledgerColumns} data={ledger} />
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Consolidated Day Tab (with PASTE) =====
function ConsolidatedTab({state, setState}){
  const [date, setDate] = useState(todayISO());
  const [products, setProducts] = useState([
    {product:'R10 White Bread', produced:0, damages:0, deliveredDenny:0, deliveredTebza:0, walkins:0},
    {product:'R12 White Bread', produced:0, damages:0, deliveredDenny:0, deliveredTebza:0, walkins:0},
    {product:'R12 Brown Bread', produced:0, damages:0, deliveredDenny:0, deliveredTebza:0, walkins:0},
  ]);
  const [paste, setPaste] = useState('');
  const [cashPreview, setCashPreview] = useState({denny:0,tebza:0,walkins:0});

  const autoCalc = ()=> setProducts(ps=> ps.map(p=> ({...p, walkins: Math.max(0, num(p.produced)-num(p.damages)-num(p.deliveredDenny)-num(p.deliveredTebza)) })));
  const add = ()=> { const entry = { id: uid(), date, rows: products.map(p=> ({...p})) }; setState(s=> ({...s, consolidated: [entry, ...s.consolidated]})); };
  const parsePaste = ()=>{ const {rows, cash} = parseConsolidated(paste); if (rows.length){ setProducts(prev=> prev.map(p=> { const m = rows.find(r=> normalizeProduct(r.product)===normalizeProduct(p.product)); return m? {...p, ...m}: p; })); setCashPreview(cash);} };

  const columns = [
    {header:'Product', render:r=> r.product},
    {header:'Produced', render:r=> <Input type="number" value={r.produced} onChange={e=> setProducts(prev=> prev.map(p=> p.product===r.product? {...p, produced:num(e.target.value)}:p))} />},
    {header:'Damages', render:r=> <Input type="number" value={r.damages} onChange={e=> setProducts(prev=> prev.map(p=> p.product===r.product? {...p, damages:num(e.target.value)}:p))} />},
    {header:'Delivered – Denny', render:r=> <Input type="number" value={r.deliveredDenny} onChange={e=> setProducts(prev=> prev.map(p=> p.product===r.product? {...p, deliveredDenny:num(e.target.value)}:p))} />},
    {header:'Delivered – Tebza', render:r=> <Input type="number" value={r.deliveredTebza} onChange={e=> setProducts(prev=> prev.map(p=> p.product===r.product? {...p, deliveredTebza:num(e.target.value)}:p))} />},
    {header:'Walk-ins', render:r=> <Input type="number" value={r.walkins} onChange={e=> setProducts(prev=> prev.map(p=> p.product===r.product? {...p, walkins:num(e.target.value)}:p))} />},
  ];

  const saved = state.consolidated.filter(c=> c.date===date);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Consolidated Day</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400">Date</label>
          <Input type="date" value={date} onChange={e=> setDate(e.target.value)} />
        </div>
        <div className="flex items-end gap-3">
          <Button onClick={autoCalc} className="bg-zinc-800 text-zinc-100">Auto-calc Walk-ins</Button>
          <Button onClick={add}>Save Day</Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <h3 className="font-medium">Paste Daily Consolidated Report</h3>
          <textarea value={paste} onChange={e=> setPaste(e.target.value)} rows={12} placeholder={`25/09/25.
CLOSING ...
PRODUCED 
•White bread R10 (466).
•White bread R12 (48).
•Brown bread R12 (16).

SOLD 
•White bread R10 
Denny(251).
Tebza(77).
Walkins (201)

DAMAGED 
•White bread R10 (4).
•White bread R12 (2).

Total cash on hand
Danny R2480
Tebza R940
Walkins 2025`} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm"></textarea>
          <div className="flex gap-3">
            <Button onClick={parsePaste}>Parse to Grid</Button>
            <p className="text-xs text-zinc-400">Understands Produced / Sold (Denny, Tebza, Walk-ins) / Damaged / Total cash.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-2">
            <StatCard label="Cash – Denny" value={currency(cashPreview.denny||0)} />
            <StatCard label="Cash – Tebza" value={currency(cashPreview.tebza||0)} />
            <StatCard label="Cash – Walk-ins" value={currency(cashPreview.walkins||0)} />
          </div>
        </div>
        <div>
          <Table columns={columns} data={products} />
        </div>
      </div>

      {saved.length>0 && (
        <div className="mt-6">
          <h3 className="font-medium">Saved Entries – {date}</h3>
          {saved.map((c, i)=> (
            <div key={i} className="mt-3">
              <Table columns={[{header:'Product', render:r=> r.product},{header:'Produced', render:r=> r.produced},{header:'Damages', render:r=> r.damages},{header:'Denny', render:r=> r.deliveredDenny},{header:'Tebza', render:r=> r.deliveredTebza},{header:'Walk-ins', render:r=> r.walkins}]} data={c.rows.map((r,idx)=> ({id: idx, ...r}))} />
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-400">Tip: Paste your full end-of-day message and hit “Parse to Grid”. Adjust anything manually, then “Save Day”.</p>
    </div>
  );
}

// ===== Production Tab =====
function ProductionTab({state, setState}){
  const [date, setDate] = useState(todayISO());
  const [product, setProduct] = useState("R10 White Bread");
  const [produced, setProduced] = useState(0);
  const [damages, setDamages] = useState(0);
  const [closingStock, setClosingStock] = useState(0);

  const add = ()=> {
    const entry = { id: uid(), date, product, produced: num(produced), damages: num(damages), closingStock: num(closingStock) };
    setState(s=> ({...s, production: [entry, ...s.production]}));
    setProduced(0); setDamages(0); setClosingStock(0);
  };

  const columns = [
    {header:"Date", render:r=>r.date},
    {header:"Product", render:r=>r.product},
    {header:"Produced", render:r=>r.produced},
    {header:"Damages", render:r=>r.damages},
    {header:"Closing Stock", render:r=>r.closingStock},
  ];

  const filtered = state.production.filter(p=> p.date===date);
  const totals = filtered.reduce((a,x)=> ({ produced: a.produced + x.produced, damages: a.damages + x.damages }), {produced:0, damages:0});

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Record Daily Production</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400">Date</label>
            <Input type="date" value={date} onChange={e=> setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Product</label>
            <Select value={product} onChange={e=> setProduct(e.target.value)}>
              {["R10 White Bread","R12 White Bread","R12 Brown Bread","Hamburger Buns","Hotdog Buns","Scones","Muffins"].map(p=> <option key={p}>{p}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-xs text-zinc-400">Produced</label>
            <Input type="number" value={produced} onChange={e=> setProduced(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Damages</label>
            <Input type="number" value={damages} onChange={e=> setDamages(e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-zinc-400">Closing Stock (End of Day)</label>
            <Input type="number" value={closingStock} onChange={e=> setClosingStock(e.target.value)} />
          </div>
        </div>
        <Button onClick={add}>Add</Button>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Entries – {date}</h2>
        <Table columns={columns} data={filtered} />
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total Produced" value={totals.produced} />
          <StatCard label="Total Damages" value={totals.damages} />
        </div>
      </div>
    </div>
  );
}

// ===== Materials Tab =====
function MaterialsTab({state, setState}){
  const [date, setDate] = useState(todayISO());
  const [item, setItem] = useState("White Flour (kg)");
  const [openingKg, setOpeningKg] = useState(0);
  const [receivedKg, setReceivedKg] = useState(0);
  const [usedKg, setUsedKg] = useState(0);

  const add = ()=> {
    const closingKg = num(openingKg)+num(receivedKg)-num(usedKg);
    const entry = { id: uid(), date, item, openingKg: num(openingKg), receivedKg: num(receivedKg), usedKg: num(usedKg), closingKg };
    setState(s=> ({...s, materials: [entry, ...s.materials]}));
    setOpeningKg(0); setReceivedKg(0); setUsedKg(0);
  };

  const columns = [
    {header:"Date", render:r=>r.date},
    {header:"Item", render:r=>r.item},
    {header:"Opening (kg)", render:r=>r.openingKg},
    {header:"Received (kg)", render:r=>r.receivedKg},
    {header:"Used (kg)", render:r=>r.usedKg},
    {header:"Closing (kg)", render:r=>r.closingKg},
  ];

  const filtered = state.materials.filter(p=> p.date===date);

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Record Raw Materials</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400">Date</label>
            <Input type="date" value={date} onChange={e=> setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Item</label>
            <Select value={item} onChange={e=> setItem(e.target.value)}>
              {["White Flour (kg)","Brown Flour (kg)","Premix (kg)","Yeast (kg)","Oil (kg)","Sugar (kg)"]
                .map(p=> <option key={p}>{p}</option>)}
            </Select>
          </div>
          <div>
            <label className="text-xs text-zinc-400">Opening (kg)</label>
            <Input type="number" step="0.01" value={openingKg} onChange={e=> setOpeningKg(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Received (kg)</label>
            <Input type="number" step="0.01" value={receivedKg} onChange={e=> setReceivedKg(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Used (kg)</label>
            <Input type="number" step="0.01" value={usedKg} onChange={e=> setUsedKg(e.target.value)} />
          </div>
        </div>
        <Button onClick={add}>Add</Button>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Entries – {date}</h2>
        <Table columns={columns} data={filtered} />
      </div>
    </div>
  );
}

// ===== Expenses Tab =====
function ExpensesTab({state, setState}){
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState("Petrol");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);

  const add = ()=> {
    const entry = { id: uid(), date, category, description, amount: num(amount) };
    setState(s=> ({...s, expenses: [entry, ...s.expenses]}));
    setDescription(""); setAmount(0);
  };

  const columns = [
    {header:"Date", render:r=>r.date},
    {header:"Category", render:r=>r.category},
    {header:"Description", render:r=>r.description},
    {header:"Amount", render:r=> currency(r.amount)},
  ];

  const filtered = state.expenses.filter(e=> e.date===date);
  const total = filtered.reduce((a,x)=> a+num(x.amount), 0);

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Log Expense</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400">Date</label>
            <Input type="date" value={date} onChange={e=> setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Category</label>
            <Select value={category} onChange={e=> setCategory(e.target.value)}>
              {["Petrol","Maintenance","Salaries","Ingredients","Packaging","Rent","Utilities","Other"].map(c=> <option key={c}>{c}</option>)}
            </Select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-zinc-400">Description</label>
            <Input value={description} onChange={e=> setDescription(e.target.value)} placeholder="e.g., Bike petrol" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-zinc-400">Amount (R)</label>
            <Input type="number" step="0.01" value={amount} onChange={e=> setAmount(e.target.value)} />
          </div>
        </div>
        <Button onClick={add}>Add</Button>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Entries – {date}</h2>
        <Table columns={columns} data={filtered} />
        <StatCard label="Total Expenses" value={currency(total)} />
      </div>
    </div>
  );
}

// ===== Cash Movements Tab =====
function CashTab({state, setState}){
  const [date, setDate] = useState(todayISO());
  const [source, setSource] = useState('Denny');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState(0);
  const add = ()=> {
    const entry = { id: uid(), date, source, note, amount: num(amount) };
    setState(s=> ({...s, cashMoves: [entry, ...s.cashMoves]}));
    setNote(''); setAmount(0);
  };
  const filtered = state.cashMoves.filter(x=> x.date===date);
  const columns = [
    {header:'Date', render:r=> r.date},
    {header:'Source', render:r=> r.source},
    {header:'Note', render:r=> r.note},
    {header:'Amount', render:r=> currency(r.amount)},
  ];
  const total = filtered.reduce((a,x)=> a+num(x.amount), 0);
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Cash Movements (non-expense)</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400">Date</label>
            <Input type="date" value={date} onChange={e=> setDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Source</label>
            <Select value={source} onChange={e=> setSource(e.target.value)}>
              {['Denny','Tebza','Walk-ins','Other'].map(s=> <option key={s}>{s}</option>)}
            </Select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-zinc-400">Note</label>
            <Input value={note} onChange={e=> setNote(e.target.value)} placeholder="e.g., Paid R100 deposit for gas bottle" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-zinc-400">Amount (R) – use negative for outflow</label>
            <Input type="number" step="0.01" value={amount} onChange={e=> setAmount(e.target.value)} />
          </div>
        </div>
        <Button onClick={add}>Add</Button>
      </div>
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Entries – {date}</h2>
        <Table columns={columns} data={filtered} />
        <StatCard label="Net Movement" value={currency(total)} />
      </div>
    </div>
  );
}

// ===== Reports Tab =====
function ReportsTab({state, totals, receivables}){
  const [from, setFrom] = useState(()=> new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10));
  const [to, setTo] = useState(todayISO());

  const inRange = (d) => (!from || d>=from) && (!to || d<=to);

  const rows = state.sales.filter(s=> inRange(s.date));
  const byDriver = {};
  for (const r of rows) {
    const key = r.driver||"";
    if (!byDriver[key]) byDriver[key] = { loaves:0, cash:0, credit:0, payments:0 };
    if (r.type==='cash') { byDriver[key].loaves += num(r.loaves); byDriver[key].cash += num(r.loaves)*(r.pricePerLoaf||10); }
    if (r.type==='credit') { byDriver[key].loaves += num(r.loaves); byDriver[key].credit += num(r.loaves)*(r.pricePerLoaf||10); }
    if (r.type==='payment') { byDriver[key].payments += num(r.amount); }
  }
  const driverRows = Object.entries(byDriver).map(([driver, v])=> ({ id: driver, driver, ...v, salesValue: v.cash+v.credit, cashOnHand: v.cash+v.payments }));

  const cashBySource = state.cashMoves.filter(m=> inRange(m.date)).reduce((acc, m)=> { acc[m.source] = (acc[m.source]||0) + num(m.amount); return acc; }, {});
  const consRows = state.consolidated.filter(c=> inRange(c.date)).flatMap(c=> c.rows.map(r=> ({...r, date: c.date, id: `${c.date}-${r.product}`})));

  const salesValue = driverRows.reduce((a,x)=> a+x.salesValue, 0);
  const expenses = state.expenses.filter(e=> inRange(e.date)).reduce((a,x)=> a+num(x.amount), 0);
  const profit = salesValue - expenses;

  const columns = [
    {header:"Driver", render:r=>r.driver},
    {header:"Loaves Sold", render:r=>r.loaves},
    {header:"Cash Sales", render:r=>currency(r.cash)},
    {header:"Credit Given", render:r=>currency(r.credit)},
    {header:"Payments In", render:r=>currency(r.payments)},
    {header:"Cash on Hand", render:r=>currency(r.cashOnHand)},
    {header:"Total Sales Value", render:r=>currency(r.salesValue)},
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Reports</h2>
      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-zinc-400">From</label>
          <Input type="date" value={from} onChange={e=> setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-zinc-400">To</label>
          <Input type="date" value={to} onChange={e=> setTo(e.target.value)} />
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <StatCard label="Loaves Sold" value={state.sales.filter(s=> inRange(s.date)).reduce((a,s)=> a + (s.type!=="payment"? num(s.loaves):0), 0)} />
        <StatCard label="Cash Sales" value={currency(driverRows.reduce((a,x)=> a+x.cash, 0))} />
        <StatCard label="Credit Sales" value={currency(driverRows.reduce((a,x)=> a+x.credit, 0))} />
        <StatCard label="Payments In" value={currency(driverRows.reduce((a,x)=> a+x.payments, 0))} />
        <StatCard label="Sales Value" value={currency(salesValue)} />
        <StatCard label="Expenses" value={currency(expenses)} />
        <StatCard label="Profit (simple)" value={currency(profit)} />
        <StatCard label="Customers Owing (AR)" value={currency(receivables.reduce((a,c)=> a + Math.max(0, c.balance), 0))} />
        <StatCard label="Customers in Credit" value={currency(receivables.reduce((a,c)=> a + Math.min(0, c.balance), 0))} />
        <StatCard label="Cash Movements – Denny" value={currency(cashBySource['Denny']||0)} />
        <StatCard label="Cash Movements – Tebza" value={currency(cashBySource['Tebza']||0)} />
        <StatCard label="Cash Movements – Walk-ins" value={currency(cashBySource['Walk-ins']||0)} />
      </div>

      <h3 className="font-medium">Driver Summary</h3>
      <Table columns={columns} data={driverRows} />

      <h3 className="font-medium mt-6">Top Debtors</h3>
      <Table 
        columns={[{header:"Customer"},{header:"Balance", render:r=> <span className={r.balance>0?"text-red-300":"text-green-300"}>{currency(r.balance)}</span>}]} 
        data={receivables
          .filter(r=> r.balance>0)
          .sort((a,b)=> b.balance-a.balance)
          .slice(0,10)}
      />

      <h3 className="font-medium mt-6">Consolidated Overview</h3>
      <Table
        columns={[
          {header:'Date', render:r=> r.date},
          {header:'Product', render:r=> r.product},
          {header:'Produced', render:r=> r.produced},
          {header:'Damages', render:r=> r.damages},
          {header:'Denny', render:r=> r.deliveredDenny},
          {header:'Tebza', render:r=> r.deliveredTebza},
          {header:'Walk-ins', render:r=> r.walkins},
        ]}
        data={consRows}
      />
    </div>
  );
}
