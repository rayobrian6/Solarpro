"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
import { geoCentroid, geoContains, geoMercator } from "d3-geo";
import { feature } from "topojson-client";
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

// Inverse lookup: USPS code → 2-digit state FIPS, used to filter counties
// (county FIPS = state FIPS + 3-digit county) when drilling into a state.
const USPS_TO_FIPS: Record<string, string> = Object.fromEntries(
  Object.entries(FIPS_TO_USPS).map(([fips, code]) => [code, fips]),
);

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

// One GeoJSON county polygon. Loaded lazily — see loadCountyFeatures.
interface CountyFeature {
  id?: string | number;
  rsmKey?: string;
  properties?: Record<string, unknown>;
  geometry: unknown;
}

// counties-10m.json is ~1MB, so it's only pulled the first time anyone drills
// into a state, then cached at module scope across mounts.
let COUNTY_FEATURES: CountyFeature[] | null = null;
let countyLoadPromise: Promise<CountyFeature[]> | null = null;

function loadCountyFeatures(): Promise<CountyFeature[]> {
  if (COUNTY_FEATURES) return Promise.resolve(COUNTY_FEATURES);
  if (!countyLoadPromise) {
    countyLoadPromise = import("us-atlas/counties-10m.json").then((mod) => {
      const topo = (mod as { default?: unknown }).default ?? mod;
      const fc = feature(
        topo as never,
        (topo as { objects: { counties: never } }).objects.counties,
      ) as unknown as { features: CountyFeature[] };
      COUNTY_FEATURES = fc.features;
      return COUNTY_FEATURES;
    });
  }
  return countyLoadPromise;
}

const fips5 = (id: string | number | undefined) =>
  String(id ?? "").padStart(5, "0");

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
  const [countyFeatures, setCountyFeatures] = useState<CountyFeature[] | null>(
    COUNTY_FEATURES,
  );
  const [selectedCounty, setSelectedCounty] = useState<string>("");

  const stateFips = selected ? USPS_TO_FIPS[selected] ?? "" : "";

  // Lazy-load county geometry the first time the user drills into any state.
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    loadCountyFeatures().then((f) => {
      if (alive) setCountyFeatures(f);
    });
    return () => {
      alive = false;
    };
  }, [selected]);

  // Reset the county pick whenever the active state changes (or clears).
  useEffect(() => {
    setSelectedCounty("");
  }, [selected]);

  // Counties belonging to the drilled-in state.
  const stateCounties = useMemo(() => {
    if (!stateFips || !countyFeatures) return [];
    return countyFeatures.filter((f) => fips5(f.id).slice(0, 2) === stateFips);
  }, [stateFips, countyFeatures]);

  const drilled = !!selected && stateCounties.length > 0;

  // Bucket each geocoded lead in this state into its county (point-in-polygon).
  // Leads without coordinates (or that fall outside every polygon) are tallied
  // as "unlocated" so the operator knows the zone counts aren't the whole story.
  const { countyCounts, countyLeadIds, unlocated } = useMemo(() => {
    const countyCounts: Record<string, number> = {};
    const countyLeadIds: Record<string, string[]> = {};
    let unlocated = 0;
    if (!drilled) return { countyCounts, countyLeadIds, unlocated };
    for (const lead of leads) {
      if (lead.state !== selected) continue;
      if (lead.lat == null || lead.lng == null) {
        unlocated++;
        continue;
      }
      const pt: [number, number] = [lead.lng, lead.lat];
      const county = stateCounties.find((f) => geoContains(f as never, pt));
      if (!county) {
        unlocated++;
        continue;
      }
      const code = fips5(county.id);
      countyCounts[code] = (countyCounts[code] ?? 0) + 1;
      (countyLeadIds[code] ??= []).push(lead.id);
    }
    return { countyCounts, countyLeadIds, unlocated };
  }, [drilled, leads, selected, stateCounties]);

  // Frame the drilled-in state with its own upright Mercator projection — the
  // national Albers projection leaves edge states visibly tilted when zoomed.
  // Fit the state's counties to the viewport, then read back the scale and the
  // geographic point that lands at screen-center.
  const drilledProj = useMemo(() => {
    if (!drilled) return null;
    const fc = {
      type: "FeatureCollection",
      features: stateCounties,
    } as never;
    const proj = geoMercator().fitExtent(
      [
        [40, 30],
        [860, 470],
      ],
      fc,
    );
    const center =
      (proj.invert?.([450, 250]) as [number, number] | undefined) ??
      (geoCentroid(fc) as [number, number]);
    return { scale: proj.scale(), center };
  }, [drilled, stateCounties]);

  const max = Math.max(1, ...Object.values(counts));
  const countyMax = Math.max(1, ...Object.values(countyCounts));

  const stateFill = (n: number, isSel: boolean) => {
    if (isSel) return "#f59e0b";
    if (n <= 0) return "#1b2433";
    const t = (0.4 + 0.55 * (n / max)).toFixed(2);
    return `rgba(16,185,129,${t})`;
  };

  const countyFill = (n: number, isSel: boolean) => {
    if (isSel) return "#f59e0b";
    if (n <= 0) return "#162033";
    const t = (0.35 + 0.55 * (n / countyMax)).toFixed(2);
    return `rgba(16,185,129,${t})`;
  };

  // Which leads get a pin. National view: every lead (Phase B). Drilled view:
  // located leads appear only for the county the operator clicked — but leads
  // with no precise geocode are ALWAYS shown as an approximate state-level pin
  // so a lead can never become invisible behind the zones.
  const pinLeads = useMemo(() => {
    if (!drilled) return leads;
    const located = selectedCounty
      ? leads.filter((l) =>
          (countyLeadIds[selectedCounty] ?? []).includes(l.id),
        )
      : [];
    const unlocatedPins = leads.filter(
      (l) => l.state === selected && (l.lat == null || l.lng == null),
    );
    return [...located, ...unlocatedPins];
  }, [drilled, selectedCounty, selected, leads, countyLeadIds]);

  return (
    <div style={{ position: "relative" }}>
      <ComposableMap
        projection={drilled ? "geoMercator" : "geoAlbersUsa"}
        width={900}
        height={500}
        projectionConfig={
          drilled && drilledProj
            ? { scale: drilledProj.scale, center: drilledProj.center }
            : { scale: 1000 }
        }
        style={{ width: "100%", height: "auto" }}
      >
        <>
          {drilled ? (
            <>
              {/* Faint neighboring states underneath, for orientation. */}
              <Geographies
                geography={statesTopo as unknown as Record<string, unknown>}
              >
                {({ geographies }) =>
                  geographies.map((geo) => (
                    <Geography
                      key={`bg-${geo.rsmKey}`}
                      geography={geo}
                      style={{
                        default: {
                          fill: "#101826",
                          stroke: "#1f2a3d",
                          strokeWidth: 0.5,
                          outline: "none",
                          pointerEvents: "none",
                        },
                        hover: { fill: "#101826", outline: "none" },
                        pressed: { fill: "#101826", outline: "none" },
                      }}
                    />
                  ))
                }
              </Geographies>

              {/* County zones for the drilled-in state. */}
              <Geographies geography={stateCounties as never}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const code = fips5(geo.id);
                    const n = countyCounts[code] ?? 0;
                    const isSel = code === selectedCounty;
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
                          if (n > 0) setSelectedCounty(isSel ? "" : code);
                        }}
                        style={{
                          default: {
                            fill: countyFill(n, isSel),
                            stroke: "#0b1220",
                            strokeWidth: 0.4,
                            outline: "none",
                            cursor: n > 0 ? "pointer" : "default",
                          },
                          hover: {
                            fill: n > 0 ? "#34d399" : "#1e2a3d",
                            stroke: "#0b1220",
                            strokeWidth: 0.6,
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
            </>
          ) : (
            <Geographies
              geography={statesTopo as unknown as Record<string, unknown>}
            >
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
                          fill: stateFill(n, isSel),
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
          )}

          {pinLeads.map((lead) => {
            const base: [number, number] | undefined =
              lead.lat != null && lead.lng != null
                ? [lead.lng, lead.lat]
                : STATE_CENTROID[lead.state];
            if (!base) return null;
            const [jx, jy] = jitter(lead.id);
            const dimmed = !drilled && !!selected && selected !== lead.state;
            const label = [
              lead.city,
              lead.grade ? `Grade ${lead.grade}` : "",
              lead.kw != null ? `${lead.kw} kW` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Marker
                key={lead.id}
                coordinates={[base[0] + jx, base[1] + jy]}
              >
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
        </>
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
              ? drilled
                ? `${hover.n} lead${hover.n === 1 ? "" : "s"} — click to view`
                : `${hover.n} lead${hover.n === 1 ? "" : "s"} you qualify for`
              : drilled
                ? "No leads in this county"
                : "No leads here yet"}
          </div>
        </div>
      )}

      {(selected || selectedCounty) && (
        <button
          type="button"
          onClick={() =>
            selectedCounty ? setSelectedCounty("") : onSelect("")
          }
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
          {selectedCounty ? `← Back to ${selected}` : `Clear ${selected}`}
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
        {drilled
          ? selectedCounty
            ? "Pins are approximate — exact address unlocks after you claim the lead."
            : `County shading shows lead density — click a county to view its leads.${
                unlocated > 0
                  ? ` (${unlocated} lead${unlocated === 1 ? "" : "s"} shown at state level — no precise location yet.)`
                  : ""
              }`
          : "Pins are approximate — exact address unlocks after you claim the lead."}
      </div>
    </div>
  );
}
