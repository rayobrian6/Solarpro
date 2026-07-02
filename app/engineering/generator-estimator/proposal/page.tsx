"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  buildProposal,
  DEFAULT_MARGINS,
  DEFAULT_INPUTS,
  defaultLaborHours,
  defaultTransferSwitchMsrp,
  fmt,
  fmtCents,
  type ProposalInputs,
} from "@/lib/engineering/generatorProposal";
import { GENERATORS } from "@/lib/engineering/generatorData";

function parseNum(v: string | null, fallback: number): number {
  if (v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function ProposalInner() {
  const sp = useSearchParams();
  const urlBrand = sp.get("brand");
  const urlModel = sp.get("model");
  const urlKw = parseNum(sp.get("kw"), NaN);
  const urlMsrp = parseNum(sp.get("msrp"), NaN);
  const urlHours = parseNum(sp.get("hours"), NaN);
  const urlService = sp.get("service");
  const urlName = sp.get("name");
  const urlAddress = sp.get("address");

  // Find a matching catalog entry by brand+model if provided
  const catalogMatch = useMemo(() => {
    if (urlBrand && urlModel) {
      const m = GENERATORS.find(
        (g) =>
          g.brand.toLowerCase() === urlBrand.toLowerCase() &&
          g.model === urlModel
      );
      if (m) return m;
    }
    if (Number.isFinite(urlKw)) {
      const m = GENERATORS.find((g) => g.kw === urlKw);
      if (m) return m;
    }
    return null;
  }, [urlBrand, urlModel, urlKw]);

  const initialGenerator = catalogMatch
    ? { brand: catalogMatch.brand, model: catalogMatch.model, kw: catalogMatch.kw, msrp: catalogMatch.msrp }
    : DEFAULT_INPUTS.generator;

  const initialService = (urlService === "100A" || urlService === "200A" || urlService === "400A")
    ? urlService
    : DEFAULT_INPUTS.site.serviceSize;

  const initialHours = Number.isFinite(urlHours)
    ? urlHours
    : defaultLaborHours(initialGenerator.kw);

  const initialTsMsrp = urlMsrp && !catalogMatch
    ? parseNum(sp.get("tsmsrp"), defaultTransferSwitchMsrp(initialService))
    : defaultTransferSwitchMsrp(initialService);

  const urlView = sp.get("view");
  const [view, setView] = useState<"client" | "interior">(
    urlView === "interior" ? "interior" : "client"
  );
  const isInterior = view === "interior";

  const [customer, setCustomer] = useState({
    name: urlName ?? "",
    address: urlAddress ?? "",
    email: sp.get("email") ?? "",
    phone: sp.get("phone") ?? "",
  });
  const [serviceSize, setServiceSize] = useState<"100A" | "200A" | "400A">(initialService);
  const [genBrand, setGenBrand] = useState(initialGenerator.brand);
  const [genModel, setGenModel] = useState(initialGenerator.model);
  const [genKw, setGenKw] = useState(initialGenerator.kw);
  const [genMsrp, setGenMsrp] = useState(initialGenerator.msrp);
  const [tsIncluded, setTsIncluded] = useState(DEFAULT_INPUTS.transferSwitch.included);
  const [tsAmps, setTsAmps] = useState<100 | 200 | 400>(DEFAULT_INPUTS.transferSwitch.amps);
  const [tsMsrp, setTsMsrp] = useState(initialTsMsrp);
  const [laborHours, setLaborHours] = useState(initialHours);
  const [gasNeeded, setGasNeeded] = useState(DEFAULT_INPUTS.subcategories.gasLineNeeded);
  const [gasCost, setGasCost] = useState(DEFAULT_INPUTS.subcategories.gasLineCost);
  const [elecNeeded, setElecNeeded] = useState(DEFAULT_INPUTS.subcategories.electricalUpgradeNeeded);
  const [elecCost, setElecCost] = useState(DEFAULT_INPUTS.subcategories.electricalUpgradeCost);
  const [permitCost, setPermitCost] = useState(DEFAULT_INPUTS.permits.cost);
  const [materialMarkup, setMaterialMarkup] = useState(DEFAULT_MARGINS.materialMarkupPct);
  const [laborBaseRate, setLaborBaseRate] = useState(DEFAULT_MARGINS.laborBaseRate);
  const [laborSellRate, setLaborSellRate] = useState(DEFAULT_MARGINS.laborSellRate);
  const [subMarkup, setSubMarkup] = useState(DEFAULT_MARGINS.subMarkupPct);
  const [overheadPct, setOverheadPct] = useState(DEFAULT_MARGINS.overheadPctOfLabor);
  const [taxRate, setTaxRate] = useState(DEFAULT_MARGINS.taxRatePct);
  const [notes, setNotes] = useState("");

  const inputs: ProposalInputs = useMemo(
    () => ({
      customer,
      site: { serviceSize },
      generator: { brand: genBrand, model: genModel, kw: genKw, msrp: genMsrp },
      transferSwitch: { amps: tsAmps, msrp: tsMsrp, included: tsIncluded },
      installation: { laborHours },
      subcategories: {
        gasLineNeeded: gasNeeded,
        gasLineCost: gasCost,
        electricalUpgradeNeeded: elecNeeded,
        electricalUpgradeCost: elecCost,
      },
      permits: { cost: permitCost },
      margins: {
        materialMarkupPct: materialMarkup,
        laborBaseRate,
        laborSellRate,
        subMarkupPct: subMarkup,
        overheadPctOfLabor: overheadPct,
        taxRatePct: taxRate,
      },
      notes,
    }),
    [
      customer, serviceSize, genBrand, genModel, genKw, genMsrp,
      tsIncluded, tsAmps, tsMsrp, laborHours,
      gasNeeded, gasCost, elecNeeded, elecCost,
      permitCost, materialMarkup, laborBaseRate, laborSellRate,
      subMarkup, overheadPct, taxRate, notes,
    ]
  );

  const proposal = useMemo(() => buildProposal(inputs), [inputs]);

  function pickGenerator(brand: string, model: string) {
    const g = GENERATORS.find(
      (g) => g.brand.toLowerCase() === brand.toLowerCase() && g.model === model
    );
    if (g) {
      setGenBrand(g.brand);
      setGenModel(g.model);
      setGenKw(g.kw);
      setGenMsrp(g.msrp);
      setLaborHours(defaultLaborHours(g.kw));
    }
  }

  function handlePrint() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <header className="mb-10 no-print">
          <p className="mb-4 text-xs font-black uppercase tracking-[0.28em] text-amber-300/70">
            SolarPro Proposal Builder
          </p>
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <h1 className="mb-3 text-4xl font-black leading-tight sm:text-5xl">
                Build a customer proposal.
              </h1>
              <p className="max-w-xl text-base leading-7 text-slate-400">
                From a sizing recommendation to a signed contract. Adjust the
                left, the right updates live, and Print-to-PDF gives you a
                client-ready deliverable.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.035] p-1 shrink-0">
              <button
                onClick={() => setView("client")}
                className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wider transition ${
                  view === "client"
                    ? "bg-amber-300 text-slate-950"
                    : "text-slate-400 hover:text-amber-300"
                }`}
              >
                Client
              </button>
              <button
                onClick={() => setView("interior")}
                className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-wider transition ${
                  view === "interior"
                    ? "bg-amber-300 text-slate-950"
                    : "text-slate-400 hover:text-amber-300"
                }`}
              >
                Interior
              </button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8">
          {/* FORM COLUMN (hidden on print) */}
          <section className="space-y-6 no-print">
            <Card title="Customer">
              <Field label="Name">
                <input
                  type="text"
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                  className={inputCls}
                  placeholder="Jane Doe"
                />
              </Field>
              <Field label="Address">
                <input
                  type="text"
                  value={customer.address}
                  onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
                  className={inputCls}
                  placeholder="123 Main St, Springfield IL"
                />
              </Field>
              <Field label="Email (optional)">
                <input
                  type="email"
                  value={customer.email}
                  onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Phone (optional)">
                <input
                  type="tel"
                  value={customer.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </Card>

            <Card title="Equipment">
              <Field label="Quick pick (catalog)">
                <select
                  className={inputCls}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) pickGenerator(...e.target.value.split("|") as [string, string]);
                  }}
                >
                  <option value="">— choose from catalog —</option>
                  {GENERATORS.map((g) => (
                    <option key={`${g.brand}-${g.model}`} value={`${g.brand}|${g.model}`}>
                      {g.brand} {g.model} — {g.kw} kW ({fmt(g.msrp)})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Brand">
                  <input
                    type="text"
                    value={genBrand}
                    onChange={(e) => setGenBrand(e.target.value)}
                    className={inputCls}
                  />
                </Field>
                <Field label="Model">
                  <input
                    type="text"
                    value={genModel}
                    onChange={(e) => setGenModel(e.target.value)}
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="kW">
                  <input
                    type="number"
                    value={genKw}
                    onChange={(e) => {
                      const n = parseNum(e.target.value, 0);
                      setGenKw(n);
                      setLaborHours(defaultLaborHours(n));
                    }}
                    className={inputCls}
                  />
                </Field>
                <Field label="MSRP">
                  <input
                    type="number"
                    value={genMsrp}
                    onChange={(e) => setGenMsrp(parseNum(e.target.value, 0))}
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="pt-2 border-t border-white/[0.07] mt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={tsIncluded}
                    onChange={(e) => setTsIncluded(e.target.checked)}
                  />
                  <span>Include transfer switch</span>
                </label>
              </div>
              {tsIncluded && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amps">
                    <select
                      className={inputCls}
                      value={tsAmps}
                      onChange={(e) => {
                        const a = Number(e.target.value) as 100 | 200 | 400;
                        setTsAmps(a);
                        setTsMsrp(defaultTransferSwitchMsrp(serviceSize));
                      }}
                    >
                      <option value={100}>100A</option>
                      <option value={200}>200A</option>
                      <option value={400}>400A</option>
                    </select>
                  </Field>
                  <Field label="TS MSRP">
                    <input
                      type="number"
                      value={tsMsrp}
                      onChange={(e) => setTsMsrp(parseNum(e.target.value, 0))}
                      className={inputCls}
                    />
                  </Field>
                </div>
              )}
              <Field label="Site service size">
                <select
                  className={inputCls}
                  value={serviceSize}
                  onChange={(e) => {
                    const s = e.target.value as "100A" | "200A" | "400A";
                    setServiceSize(s);
                    setTsMsrp(defaultTransferSwitchMsrp(s));
                  }}
                >
                  <option value="100A">100A</option>
                  <option value="200A">200A</option>
                  <option value="400A">400A</option>
                </select>
              </Field>
            </Card>

            <Card title="Installation">
              <Field label="Labor hours">
                <input
                  type="number"
                  value={laborHours}
                  onChange={(e) => setLaborHours(parseNum(e.target.value, 0))}
                  className={inputCls}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Rule of thumb: 8 / 10 / 12 / 14 / 16 hrs for ≤10 / 14 / 18 / 22 / 26 kW.
                </p>
              </Field>
              <Field label="Permits ($)">
                <input
                  type="number"
                  value={permitCost}
                  onChange={(e) => setPermitCost(parseNum(e.target.value, 0))}
                  className={inputCls}
                />
              </Field>

              <div className="pt-2 border-t border-white/[0.07] mt-2 space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={gasNeeded}
                    onChange={(e) => setGasNeeded(e.target.checked)}
                  />
                  <span>Gas line needed</span>
                </label>
                {gasNeeded && (
                  <Field label="Gas line cost ($)">
                    <input
                      type="number"
                      value={gasCost}
                      onChange={(e) => setGasCost(parseNum(e.target.value, 0))}
                      className={inputCls}
                    />
                  </Field>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={elecNeeded}
                    onChange={(e) => setElecNeeded(e.target.checked)}
                  />
                  <span>Electrical upgrade needed</span>
                </label>
                {elecNeeded && (
                  <Field label="Electrical upgrade cost ($)">
                    <input
                      type="number"
                      value={elecCost}
                      onChange={(e) => setElecCost(parseNum(e.target.value, 0))}
                      className={inputCls}
                    />
                  </Field>
                )}
              </div>
            </Card>

            <Card title="Margins & overhead">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Material markup %">
                  <input
                    type="number"
                    value={materialMarkup}
                    onChange={(e) => setMaterialMarkup(parseNum(e.target.value, 0))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Subcontractor markup %">
                  <input
                    type="number"
                    value={subMarkup}
                    onChange={(e) => setSubMarkup(parseNum(e.target.value, 0))}
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Labor base rate ($/hr)">
                  <input
                    type="number"
                    value={laborBaseRate}
                    onChange={(e) => setLaborBaseRate(parseNum(e.target.value, 0))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Labor sell rate ($/hr)">
                  <input
                    type="number"
                    value={laborSellRate}
                    onChange={(e) => setLaborSellRate(parseNum(e.target.value, 0))}
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Overhead % of labor">
                  <input
                    type="number"
                    value={overheadPct}
                    onChange={(e) => setOverheadPct(parseNum(e.target.value, 0))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Tax rate %">
                  <input
                    type="number"
                    value={taxRate}
                    onChange={(e) => setTaxRate(parseNum(e.target.value, 0))}
                    className={inputCls}
                  />
                </Field>
              </div>
            </Card>

            <Card title="Notes (optional)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className={inputCls}
                placeholder="Scope notes, exclusions, warranty terms, payment schedule…"
              />
            </Card>

            <button
              onClick={handlePrint}
              className="w-full rounded-full bg-amber-300 py-3 text-sm font-black uppercase tracking-wider text-slate-950 transition hover:bg-amber-200"
            >
              Print / Save as PDF
            </button>
          </section>

          {/* PROPOSAL COLUMN (printable) */}
          <section className="proposal-doc">
            <div className="print-header mb-8">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/15">
                    <span aria-hidden className="block h-5 w-5 rounded-full bg-amber-300" />
                  </span>
                  <div>
                    <div className="text-xl font-black tracking-tight">
                      SolarPro · Generator Proposal
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      Prepared {new Date(proposal.generatedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  Proposal ID:{" "}
                  <span className="font-mono">
                    {proposal.generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}
                  </span>
                </div>
              </div>

              {(customer.name || customer.address) && (
                <div className="mt-5 text-sm">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300/80">
                    Prepared for
                  </div>
                  {customer.name && <div className="mt-1 text-base font-bold">{customer.name}</div>}
                  {customer.address && <div className="text-slate-400">{customer.address}</div>}
                  {customer.email && <div className="text-slate-500">{customer.email}</div>}
                  {customer.phone && <div className="text-slate-500">{customer.phone}</div>}
                </div>
              )}
            </div>

            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/70">
              Scope of work
            </p>
            <h2 className="mb-3 text-2xl font-black leading-tight">
              Furnish and install standby backup power.
            </h2>
            <p className="text-sm leading-7 text-slate-400">
              A {genKw} kW {genBrand} {genModel} standby generator with
              automatic transfer switch, installed at the property above.
              Includes generator pad, gas line connection where indicated,
              electrical interconnection, full system commissioning, and
              permit handling.
            </p>

            <p className="mb-2 mt-8 text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/70">
              Itemized pricing
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.1] text-left text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                  <th className="py-3">Item</th>
                  {isInterior && (
                    <th className="py-3 text-right">Cost</th>
                  )}
                  <th className="py-3 text-right">
                    {isInterior ? "Sell" : "Amount"}
                  </th>
                  {isInterior && (
                    <th className="py-3 text-right">Margin</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {proposal.lineItems.map((li, i) => {
                  const marginPct = li.sell > 0
                    ? Math.round(((li.sell - li.cost) / li.sell) * 1000) / 10
                    : 0;
                  return (
                    <tr key={i} className="border-b border-white/[0.05]">
                      <td className="py-3 pr-4">{li.description}</td>
                      {isInterior && (
                        <td className="py-3 text-right text-slate-500">{fmtCents(li.cost)}</td>
                      )}
                      <td className="py-3 text-right font-bold text-white">{fmtCents(li.sell)}</td>
                      {isInterior && (
                        <td className="py-3 text-right text-slate-500">{marginPct}%</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/[0.1]">
                  <td className="py-3 text-slate-400">Subtotal</td>
                  {isInterior && (
                    <td className="py-3 text-right text-slate-500">{fmtCents(proposal.totalCost)}</td>
                  )}
                  <td className="py-3 text-right text-white">{fmtCents(proposal.subtotalSell)}</td>
                  {isInterior && <td className="py-3"></td>}
                </tr>
                {proposal.tax > 0 && (
                  <tr>
                    <td className="py-3 text-slate-400">Tax ({taxRate}%)</td>
                    {isInterior && (
                      <td className="py-3 text-right text-slate-500">—</td>
                    )}
                    <td className="py-3 text-right text-white">{fmtCents(proposal.tax)}</td>
                    {isInterior && <td className="py-3"></td>}
                  </tr>
                )}
                <tr className="border-t border-white/[0.1]">
                  <td className="py-4 text-xl font-black text-white">Total</td>
                  {isInterior && <td className="py-4"></td>}
                  <td className="py-4 text-right text-3xl font-black text-amber-300">
                    {fmtCents(proposal.total)}
                  </td>
                  {isInterior && <td className="py-4"></td>}
                </tr>
              </tfoot>
            </table>

            {isInterior ? (
              <>
                <p className="mb-3 mt-10 text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/70">
                  Profitability summary
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Stat label="Effective margin" value={`${proposal.effectiveMarginPct}%`} accent="amber" />
                  <Stat label="Total cost" value={fmtCents(proposal.totalCost)} />
                  <Stat label="Total sell" value={fmtCents(proposal.subtotalSell)} />
                  <Stat label="Gross profit" value={fmtCents(proposal.subtotalSell - proposal.totalCost)} accent="green" />
                </div>
                <p className="mb-3 mt-8 text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/70">
                  By category (sell)
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Stat label="Materials" value={fmtCents(proposal.categorySubtotals.Materials.sell)} />
                  <Stat label="Labor" value={fmtCents(proposal.categorySubtotals.Labor.sell)} />
                  <Stat label="Permits" value={fmtCents(proposal.categorySubtotals.Permits.sell)} />
                  <Stat label="Overhead" value={fmtCents(proposal.categorySubtotals.Overhead.sell)} />
                </div>
                <p className="mb-3 mt-8 text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/70">
                  Margin assumptions
                </p>
                <div className="space-y-1 text-xs text-slate-400">
                  <div>Materials markup: {materialMarkup}%</div>
                  <div>Labor: ${laborBaseRate}/hr cost → ${laborSellRate}/hr sell ({Math.round((1 - laborBaseRate/laborSellRate) * 100)}% effective)</div>
                  <div>Subcontractor markup: {subMarkup}%</div>
                  <div>Overhead: {overheadPct}% of labor cost</div>
                  <div>Permits: pass-through</div>
                  {proposal.tax > 0 && <div>Tax rate: {taxRate}%</div>}
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 mt-10 text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/70">
                  Investment summary
                </p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <Stat label="Equipment" value={fmtCents(proposal.categorySubtotals.Materials.sell)} />
                  <Stat label="Installation" value={fmtCents(proposal.categorySubtotals.Labor.sell + proposal.categorySubtotals.Overhead.sell)} />
                  <Stat label="Permits" value={fmtCents(proposal.categorySubtotals.Permits.sell)} />
                </div>
              </>
            )}

            {notes && (
              <>
                <p className="mb-2 mt-10 text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/70">
                  Notes
                </p>
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{notes}</p>
              </>
            )}

            <p className="mb-3 mt-10 text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/70">
              Terms
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
              <li>Quote valid for 30 days from the date above.</li>
              <li>50% deposit due upon acceptance; balance due upon completion.</li>
              <li>Includes one full system commissioning. Annual maintenance quoted separately.</li>
              <li>Generator carries manufacturer warranty (typically 5 years).</li>
              <li>Excludes any unforeseen code upgrades, utility fees, or site preparation not visible at quote time.</li>
            </ul>

            <div className="print-signature mt-12 grid grid-cols-2 gap-8 text-sm">
              <div>
                <div className="h-10 border-b border-slate-400"></div>
                <div className="mt-1 text-xs text-slate-500">Customer signature / date</div>
              </div>
              <div>
                <div className="h-10 border-b border-slate-400"></div>
                <div className="mt-1 text-xs text-slate-500">Contractor signature / date</div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          /* Hide the nav + decorative blur orbs when printing */
          nav,
          .pointer-events-none.fixed {
            display: none !important;
          }
          .no-print {
            display: none !important;
          }
          .proposal-doc {
            color: black !important;
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .proposal-doc table,
          .proposal-doc th,
          .proposal-doc td {
            color: black !important;
          }
          /* SolarPro amber becomes a darker print brown */
          .proposal-doc .text-amber-300,
          .proposal-doc .text-amber-400 {
            color: #92400e !important;
          }
          /* Slate muted text becomes print gray */
          .proposal-doc .text-slate-300,
          .proposal-doc .text-slate-400,
          .proposal-doc .text-slate-500,
          .proposal-doc .text-amber-300\/70,
          .proposal-doc .text-amber-300\/80 {
            color: #4b5563 !important;
          }
          .proposal-doc .text-white {
            color: #000 !important;
          }
          /* Translucent white borders become solid gray */
          .proposal-doc [class*="border-white/"] {
            border-color: #d4d4d8 !important;
          }
          /* Translucent white backgrounds become solid white */
          .proposal-doc [class*="bg-white/"] {
            background: transparent !important;
          }
          /* Brand sun emblem keeps the brand color but flat */
          .proposal-doc span[class*="border-amber"] {
            border-color: #92400e !important;
            background: transparent !important;
          }
          .proposal-doc span[class*="bg-amber-400/15"] {
            background: transparent !important;
          }
          @page {
            size: Letter;
            margin: 0.75in;
          }
        }
      `}</style>
    </main>
  );
}

const inputCls =
  "w-full rounded-md border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-300/60 focus:outline-none focus:ring-2 focus:ring-amber-300/20";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <h3 className="mb-4 text-[11px] font-black uppercase tracking-[0.2em] text-amber-300/80">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-medium text-slate-400">{label}</div>
      {children}
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "amber" | "green" }) {
  const valueColor = accent === "amber" ? "text-amber-300" : accent === "green" ? "text-emerald-300" : "text-white";
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-black ${valueColor}`}>{value}</div>
    </div>
  );
}

export default function ProposalPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#07070e]" />}>
      <ProposalInner />
    </Suspense>
  );
}
