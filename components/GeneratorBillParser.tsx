"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { parseBill, type BillParseResult } from "@/lib/engineering/generatorParseBill";
import {
  calculateEstimateFromBill,
  formatUSD,
  type EstimateResult,
} from "@/lib/engineering/generatorEstimate";

const EXAMPLE_BILL = `Statement period: 09/15/2024 - 10/14/2024
Account number: 1234-5678-90

Energy used this billing cycle: 1,247 kWh

Average daily use: 41.6 kWh
Number of days in billing period: 30

Energy charge: 1,247 kWh @ $0.1248/kWh = $155.63
Distribution charge: $28.40
Transmission charge: $14.18
Taxes and fees: $11.20

Peak demand: 8.2 kW
Demand charge: 8.2 kW @ $14.50/kW = $118.90

Total amount due: $328.31

Service from 09/15/2024 to 10/14/2024
Issued: 10/15/2024
Due: 11/05/2024
`;

export default function BillParser() {
  const [text, setText] = useState("");
  const [parse, setParse] = useState<BillParseResult | null>(null);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pdfStatus, setPdfStatus] = useState<
    "idle" | "parsing" | "done" | "error"
  >("idle");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSize = parse?.peakKw !== null && parse?.peakKw !== undefined;
  // Show "Add to estimator" whenever ANY bill data was extracted — kWh alone
  // is informational even without a demand reading.
  const hasAnyBillData =
    parse !== null &&
    (parse.kWh !== null ||
      parse.peakKw !== null ||
      parse.totalCostUsd !== null ||
      parse.ratePerKWh !== null);

  // Href to the appliance estimator with bill data as query params.
  // Computed as a string for Next 16 Link's strict Url type.
  const billHref = useMemo(() => {
    if (!parse) return "/";
    const params = new URLSearchParams();
    if (parse.peakKw !== null) params.set("peak", parse.peakKw.toString());
    if (parse.kWh !== null) params.set("kwh", parse.kWh.toString());
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }, [parse]);

  const handleParse = () => {
    if (!text.trim()) {
      setParse(null);
      setEstimate(null);
      return;
    }
    const result = parseBill(text);
    setParse(result);
    setEstimate(null);
    setEstimateError(null);
  };

  const handleClear = () => {
    setText("");
    setParse(null);
    setEstimate(null);
    setEstimateError(null);
  };

  const handleSize = () => {
    if (!parse || parse.peakKw === null) return;
    try {
      setEstimate(
        calculateEstimateFromBill({ peakKw: parse.peakKw, kWh: parse.kWh })
      );
      setEstimateError(null);
    } catch (e) {
      setEstimateError(e instanceof Error ? e.message : "Failed to size");
      setEstimate(null);
    }
  };

  const handleLoadExample = () => {
    setText(EXAMPLE_BILL);
    setParse(null);
    setEstimate(null);
    setEstimateError(null);
    setPdfName(null);
    setPdfStatus("idle");
    setPdfError(null);
  };

  const handleFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    const isPdf =
      file.type === "application/pdf" || lowerName.endsWith(".pdf");
    const isText =
      file.type === "text/plain" ||
      file.type === "text/csv" ||
      file.type === "application/json" ||
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".csv") ||
      lowerName.endsWith(".json");
    if (!isPdf && !isText) {
      setPdfStatus("error");
      setPdfError("Unsupported file type. Use PDF, TXT, CSV, or JSON.");
      setPdfName(null);
      return;
    }
    setPdfName(file.name);
    setPdfStatus("parsing");
    setPdfError(null);
    setParse(null);
    setEstimate(null);
    setEstimateError(null);
    try {
      if (isText) {
        // Treat CSV / TXT / JSON as raw text — parseBill will extract fields.
        const text = await file.text();
        if (!text.trim()) {
          setPdfStatus("error");
          setPdfError("File is empty.");
          return;
        }
        setText(text);
        setPdfStatus("done");
        return;
      }
      // PDF — extract text via pdfjs-dist.
      const buf = await file.arrayBuffer();
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        const strings = tc.items
          .map((it) => ("str" in it ? (it as { str: string }).str : ""))
          .filter(Boolean);
        pages.push(strings.join(" "));
      }
      const extracted = pages.join("\n\n").trim();
      if (!extracted) {
        setPdfStatus("error");
        setPdfError(
          "No text found in the PDF. It may be image-only (a scan). Try pasting the text manually."
        );
        return;
      }
      setText(extracted);
      setPdfStatus("done");
    } catch (e) {
      setPdfStatus("error");
      setPdfError(e instanceof Error ? e.message : "Failed to read file");
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Electric Bill Parser</h1>
        <p className="text-slate-400 mt-2">
          Paste your electric bill text below. We&apos;ll extract your monthly
          usage, peak demand, and cost — then size a standby generator that
          handles your real-world load.
        </p>
      </header>

      <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="bill-text" className="text-sm font-medium text-slate-300">
            Bill text
          </label>
          <button
            type="button"
            onClick={handleLoadExample}
            className="text-xs rounded-md border border-white/[0.08] px-2 py-1 text-slate-400 hover:bg-white/[0.05] hover:text-white"
          >
            Load example
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-white/[0.08] bg-[#07070e]/40 px-3 py-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf,text/plain,.txt,text/csv,.csv,application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pdfStatus === "parsing"}
            className="rounded-md border border-white/[0.08] px-3 py-1.5 text-sm text-white hover:bg-white/[0.05] disabled:opacity-40"
          >
            {pdfStatus === "parsing" ? "Reading…" : "Upload file"}
          </button>
          {!pdfName && (
            <span className="text-[10px] text-slate-600">PDF, TXT, CSV, or JSON</span>
          )}
          {pdfName && (
            <span className="text-xs text-slate-400 truncate max-w-[280px]" title={pdfName}>
              {pdfName}
            </span>
          )}
          {pdfStatus === "done" && (
            <span className="text-xs text-amber-300">
              extracted — review below and click Parse bill
            </span>
          )}
          {pdfStatus === "error" && (
            <span className="text-xs text-red-400">{pdfError}</span>
          )}
        </div>

        <textarea
          id="bill-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          placeholder="Paste your electric bill text here, or upload a PDF above."
          className="w-full rounded-lg border border-white/[0.08] bg-[#07070e] px-3 py-2 font-mono text-xs text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleParse}
            disabled={!text.trim()}
            className="rounded-md bg-amber-300 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Parse bill
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={!text}
            className="rounded-md border border-white/[0.08] px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.05] disabled:opacity-40"
          >
            Clear
          </button>
          <span className="ml-auto self-center text-xs text-slate-500">
            Your bill text never leaves the browser.
          </span>
        </div>
      </section>

      {parse && (
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5 space-y-4">
          <h2 className="text-lg font-bold">Extracted</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Field label="Monthly usage" value={formatKWh(parse.kWh)} found={parse.found.kWh} />
            <Field
              label="Peak demand"
              value={formatKw(parse.peakKw)}
              found={parse.found.peakKw}
              hint={!parse.found.peakKw ? "Not found — residential bills often don't meter demand" : undefined}
            />
            <Field
              label="Rate per kWh"
              value={parse.ratePerKWh !== null ? `$${parse.ratePerKWh.toFixed(4)}` : "—"}
              found={parse.found.ratePerKWh}
            />
            <Field
              label="Total cost"
              value={parse.totalCostUsd !== null ? formatUSD(parse.totalCostUsd) : "—"}
              found={parse.found.totalCost}
            />
            <Field
              label="Billing period"
              value={
                parse.found.billingPeriod
                  ? `${parse.billingPeriodStart} → ${parse.billingPeriodEnd}`
                  : "—"
              }
              found={parse.found.billingPeriod}
            />
          </dl>

          {hasAnyBillData && (
            <div className="pt-2 border-t border-white/[0.07] flex flex-wrap items-center gap-2">
              {canSize && (
                <button
                  type="button"
                  onClick={handleSize}
                  className="rounded-md bg-amber-300 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-400"
                >
                  Size a generator from this bill
                </button>
              )}
              <Link
                href={billHref}
                className="rounded-md border border-white/[0.08] px-3 py-2 text-sm text-white hover:bg-white/[0.05]"
              >
                {canSize ? "Add to appliance estimator →" : "Send bill to estimator →"}
              </Link>
              {!canSize && parse?.peakKw === null && (
                <span className="text-xs text-slate-500">
                  No peak demand in this bill — sending what we have.
                </span>
              )}
              {estimateError && (
                <p className="mt-2 text-sm text-red-400">{estimateError}</p>
              )}
            </div>
          )}
        </section>
      )}

      {estimate && parse && (
        <section className="rounded-2xl border border-white/[0.07] bg-gradient-to-b border-white/[0.07] bg-white/[0.025] p-6 shadow-xl space-y-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">Recommended size</div>
            <div className="mt-1 text-5xl font-bold text-amber-300">
              {estimate.recommendedKw} kW
            </div>
            <div className="mt-1 text-sm text-slate-400">
              Based on {parse.peakKw!.toFixed(1)} kW peak demand × 1.25 safety margin
              {parse.kWh !== null && ` · ${formatKWh(parse.kWh)} monthly usage`}
            </div>
            {estimate.exceedsCatalog && (
              <p className="mt-3 rounded-md border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
                Exceeds our largest catalog unit ({estimate.picks.bestValue.kw} kW).
                Generac&apos;s solution: a Smart Management Module (SMM) that cycles
                heavy loads like central AC to keep the generator within its 80%
                capacity rating — no need to upsize. Alternatively, upgrade to a
                liquid-cooled commercial unit.
              </p>
            )}
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-3">Top picks</div>
            <div className="space-y-3">
              <PickCard
                label="Best value"
                brand={estimate.picks.bestValue.brand}
                model={`${estimate.picks.bestValue.series} ${estimate.picks.bestValue.kw} kW`}
                sub={`Model ${estimate.picks.bestValue.model} · ${estimate.picks.bestValue.fuel}`}
                price={estimate.picks.bestValue.msrp}
              />
              <PickCard
                label="Highest motor starting"
                brand={estimate.picks.highestSurge.brand}
                model={`${estimate.picks.highestSurge.series} ${estimate.picks.highestSurge.kw} kW`}
                sub={`Model ${estimate.picks.highestSurge.model} · ${estimate.picks.highestSurge.motorStartingAmps ?? "—"} Amps surge`}
                price={estimate.picks.highestSurge.msrp}
              />
              {estimate.picks.alternative.kw !== estimate.picks.bestValue.kw && (
                <PickCard
                  label="Alternative"
                  brand={estimate.picks.alternative.brand}
                  model={`${estimate.picks.alternative.series} ${estimate.picks.alternative.kw} kW`}
                  sub={`Model ${estimate.picks.alternative.model}`}
                  price={estimate.picks.alternative.msrp}
                />
              )}
            </div>
          </div>

          <div className="border-t border-white/[0.07] pt-5">
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
              Estimated installed cost
            </div>
            <div className="text-2xl font-bold text-white">
              {formatUSD(estimate.installedCostLow)} – {formatUSD(estimate.installedCostHigh)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Includes generator, automatic transfer switch, and typical install labor.
              Permits, gas line, and electrical upgrades not included.
            </p>
          </div>

          <p className="text-[10px] text-slate-600 leading-relaxed">
            Estimates only. Sizing follows the industry formula: peak demand × 1.25 safety
            margin, rounded up. Final selection should be reviewed by a licensed electrician with
            an actual load calculation.
          </p>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  found,
  hint,
}: {
  label: string;
  value: string;
  found: boolean;
  hint?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        found
          ? "border-amber-300/40 bg-amber-300/5"
          : "border-white/[0.07] bg-[#07070e]/40"
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-mono ${found ? "text-white" : "text-slate-600"}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[10px] text-slate-600">{hint}</div>}
    </div>
  );
}

function PickCard({
  label,
  brand,
  model,
  sub,
  price,
}: {
  label: string;
  brand: string;
  model: string;
  sub: string;
  price: number;
}) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wider text-amber-300">{label}</div>
        <div className="font-mono text-sm text-white">{formatUSD(price)}</div>
      </div>
      <div className="mt-1 text-sm font-bold text-white">{brand}</div>
      <div className="text-xs text-slate-400">{model}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function formatKWh(v: number | null): string {
  if (v === null) return "—";
  return `${v.toLocaleString("en-US")} kWh`;
}

function formatKw(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(1)} kW`;
}
