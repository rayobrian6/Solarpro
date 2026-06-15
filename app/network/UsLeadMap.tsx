"use client";

import { useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import statesTopo from "us-atlas/states-10m.json";

// US Census FIPS id → USPS 2-letter code, to match opportunity.state_code.
const FIPS_TO_USPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};

export default function UsLeadMap({
  counts,
  selected,
  onSelect,
}: {
  counts: Record<string, number>;
  selected: string;
  onSelect: (code: string) => void;
}) {
  const [hover, setHover] = useState<{
    name: string;
    n: number;
  } | null>(null);

  const max = Math.max(1, ...Object.values(counts));

  const fillFor = (n: number, isSel: boolean) => {
    if (isSel) return "#f59e0b";
    if (n <= 0) return "#1b2433";
    const t = (0.4 + 0.55 * (n / max)).toFixed(2);
    return `rgba(16,185,129,${t})`;
  };

  return (
    <div style={{ position: "relative" }}>
      <ComposableMap
        projection="geoAlbersUsa"
        width={900}
        height={500}
        projectionConfig={{ scale: 1000 }}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={statesTopo as unknown as Record<string, unknown>}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const fips = String(geo.id ?? "").padStart(2, "0");
              const code = FIPS_TO_USPS[fips] ?? "";
              const n = code ? (counts[code] ?? 0) : 0;
              const isSel = !!code && code === selected;
              const name = String(
                (geo.properties as Record<string, unknown>)?.name ?? "",
              );
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onMouseEnter={() => setHover({ name, n })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    if (code) onSelect(isSel ? "" : code);
                  }}
                  style={{
                    default: {
                      fill: fillFor(n, isSel),
                      stroke: "#0b1220",
                      strokeWidth: 0.6,
                      outline: "none",
                      cursor: n > 0 ? "pointer" : "default",
                    },
                    hover: {
                      fill: n > 0 ? "#34d399" : "#2a3346",
                      stroke: "#0b1220",
                      strokeWidth: 0.9,
                      outline: "none",
                      cursor: n > 0 ? "pointer" : "default",
                    },
                    pressed: {
                      fill: "#f59e0b",
                      stroke: "#0b1220",
                      outline: "none",
                    },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>

      {hover && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            background: "#0f1623",
            border: "1px solid #334155",
            borderRadius: 8,
            padding: "7px 11px",
            pointerEvents: "none",
          }}
        >
          <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>
            {hover.name}
          </div>
          <div
            style={{
              color: hover.n > 0 ? "#34d399" : "#64748b",
              fontSize: 12,
              marginTop: 1,
            }}
          >
            {hover.n > 0
              ? `${hover.n} lead${hover.n === 1 ? "" : "s"} you qualify for`
              : "No leads here yet"}
          </div>
        </div>
      )}

      {selected && (
        <button
          type="button"
          onClick={() => onSelect("")}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "#1e2636",
            border: "1px solid #475569",
            color: "#cbd5e1",
            fontSize: 12,
            borderRadius: 8,
            padding: "5px 10px",
            cursor: "pointer",
          }}
        >
          Clear {selected}
        </button>
      )}
    </div>
  );
}
