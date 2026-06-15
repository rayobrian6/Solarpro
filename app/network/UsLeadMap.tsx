"use client";

import { useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
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

// Approximate state centers [lng, lat] — fallback pin when a lead has no
// geocode. Used only to scatter pins regionally; never an exact location.
const STATE_CENTROID: Record<string, [number, number]> = {
  AL: [-86.8, 32.8], AK: [-152.0, 64.0], AZ: [-111.7, 34.3], AR: [-92.4, 34.8],
  CA: [-119.5, 37.2], CO: [-105.5, 39.0], CT: [-72.7, 41.6], DE: [-75.5, 39.0],
  DC: [-77.0, 38.9], FL: [-81.5, 28.6], GA: [-83.4, 32.6], HI: [-156.4, 20.3],
  ID: [-114.6, 44.4], IL: [-89.2, 40.0], IN: [-86.3, 39.9], IA: [-93.5, 42.0],
  KS: [-98.4, 38.5], KY: [-85.3, 37.5], LA: [-92.0, 31.0], ME: [-69.2, 45.4],
  MD: [-76.8, 39.0], MA: [-71.8, 42.3], MI: [-85.4, 44.3], MN: [-94.3, 46.3],
  MS: [-89.7, 32.7], MO: [-92.5, 38.4], MT: [-109.6, 47.0], NE: [-99.8, 41.5],
  NV: [-116.6, 39.3], NH: [-71.6, 43.7], NJ: [-74.7, 40.2], NM: [-106.1, 34.4],
  NY: [-75.5, 42.9], NC: [-79.4, 35.5], ND: [-100.5, 47.5], OH: [-82.8, 40.3],
  OK: [-97.5, 35.6], OR: [-120.5, 44.0], PA: [-77.8, 40.9], RI: [-71.5, 41.7],
  SC: [-80.9, 33.9], SD: [-100.2, 44.4], TN: [-86.4, 35.9], TX: [-99.3, 31.5],
  UT: [-111.7, 39.3], VT: [-72.7, 44.1], VA: [-78.9, 37.5], WA: [-120.4, 47.4],
  WV: [-80.6, 38.6], WI: [-89.9, 44.6], WY: [-107.5, 43.0],
};

// Deterministic ±0.2° jitter from a lead id — fuzzes the exact house while
// keeping the pin regionally honest, and stays stable across renders.
function jitter(id: string): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const dx = ((h % 1000) / 1000 - 0.5) * 0.4;
  const dy = ((Math.floor(h / 1000) % 1000) / 1000 - 0.5) * 0.4;
  return [dx, dy];
}

export interface MapLead {
  id: string;
  state: string;
  lat: number | null;
  lng: number | null;
  city: string;
  grade: string;
  kw: number | null;
}

export default function UsLeadMap({
  counts,
  leads,
  selected,
  onSelect,
  onSelectLead,
}: {
  counts: Record<string, number>;
  leads: MapLead[];
  selected: string;
  onSelect: (code: string) => void;
  onSelectLead: (id: string) => void;
}) {
  const [hover, setHover] = useState<{ name: string; n: number } | null>(null);
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

        {leads.map((lead) => {
          const base: [number, number] | undefined =
            lead.lat != null && lead.lng != null
              ? [lead.lng, lead.lat]
              : STATE_CENTROID[lead.state];
          if (!base) return null;
          const [jx, jy] = jitter(lead.id);
          const dimmed = !!selected && selected !== lead.state;
          const label = [
            lead.city,
            lead.grade ? `Grade ${lead.grade}` : "",
            lead.kw != null ? `${lead.kw} kW` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Marker key={lead.id} coordinates={[base[0] + jx, base[1] + jy]}>
              <circle
                r={5.5}
                fill={dimmed ? "#475569" : "#fbbf24"}
                stroke="#0b1220"
                strokeWidth={1.2}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectLead(lead.id);
                }}
              >
                <title>{label || "Solar lead"}</title>
              </circle>
            </Marker>
          );
        })}
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

      <div
        style={{
          marginTop: 6,
          textAlign: "center",
          fontSize: 11,
          color: "#64748b",
        }}
      >
        Pins are approximate — exact address unlocks after you claim the lead.
      </div>
    </div>
  );
}
