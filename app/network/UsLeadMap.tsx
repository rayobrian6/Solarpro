"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

// ZIP → county FIPS crosswalk (~41k ZIPs). Lazy-loaded the first time anyone
// drills in, so a lead's county comes straight from its ZIP — no coordinates
// or geocoding required.
let ZIP2FIPS: Record<string, string> | null = null;
let zipLoadPromise: Promise<Record<string, string>> | null = null;

function loadZip2Fips(): Promise<Record<string, string>> {
  if (ZIP2FIPS) return Promise.resolve(ZIP2FIPS);
  if (!zipLoadPromise) {
    zipLoadPromise = import("@/lib/geo/zip2fips.json").then((mod) => {
      ZIP2FIPS = ((mod as { default?: Record<string, string> }).default ??
        mod) as Record<string, string>;
      return ZIP2FIPS;
    });
  }
  return zipLoadPromise;
}

export interface MapLead {
  id: string;
  state: string;
  lat: number | null;
  lng: number | null;
  city: string;
  zip: string;
  grade: string;
  kw: number | null;
}

export default function UsLeadMap({
  counts,
  leads,
  selected,
  onSelect,
}: {
  counts: Record<string, number>;
  leads: MapLead[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const router = useRouter();
  const [hover, setHover] = useState<{ name: string; n: number } | null>(null);
  const [stateName, setStateName] = useState<string>("");
  const [countyFeatures, setCountyFeatures] = useState<CountyFeature[] | null>(
    COUNTY_FEATURES,
  );
  const [zip2fips, setZip2fips] = useState<Record<string, string> | null>(
    ZIP2FIPS,
  );

  const stateFips = selected ? USPS_TO_FIPS[selected] ?? "" : "";

  // Lazy-load county geometry + the ZIP→county crosswalk the first time the
  // user drills into any state.
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    loadCountyFeatures().then((f) => {
      if (alive) setCountyFeatures(f);
    });
    loadZip2Fips().then((z) => {
      if (alive) setZip2fips(z);
    });
    return () => {
      alive = false;
    };
  }, [selected]);

  // Counties belonging to the drilled-in state.
  const stateCounties = useMemo(() => {
    if (!stateFips || !countyFeatures) return [];
    return countyFeatures.filter((f) => fips5(f.id).slice(0, 2) === stateFips);
  }, [stateFips, countyFeatures]);

  const drilled = !!selected && stateCounties.length > 0;

  // Light each county by how many leads it holds. County comes from the lead's
  // ZIP (deterministic), falling back to point-in-polygon when coordinates
  // exist but ZIP doesn't resolve. Leads we can't place are tallied as
  // "unlocated" (they still appear in the state breakdown page).
  const { countyCounts, unlocated } = useMemo(() => {
    const countyCounts: Record<string, number> = {};
    let unlocated = 0;
    if (!drilled) return { countyCounts, unlocated };
    for (const lead of leads) {
      if (lead.state !== selected) continue;
      let code = "";
      const zip = (lead.zip || "").trim().slice(0, 5);
      if (zip && zip2fips?.[zip]) code = fips5(zip2fips[zip]);
      if (!code && lead.lat != null && lead.lng != null) {
        const county = stateCounties.find((f) =>
          geoContains(f as never, [lead.lng as number, lead.lat as number]),
        );
        if (county) code = fips5(county.id);
      }
      // Only count counties that actually belong to the drilled-in state.
      if (code && code.slice(0, 2) === stateFips) {
        countyCounts[code] = (countyCounts[code] ?? 0) + 1;
      } else {
        unlocated++;
      }
    }
    return { countyCounts, unlocated };
  }, [drilled, leads, selected, stateCounties, zip2fips, stateFips]);

  // Frame the drilled-in state with its own upright Mercator projection — the
  // national Albers projection leaves edge states visibly tilted when zoomed.
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

  const countyFill = (n: number) => {
    if (n <= 0) return "#162033";
    const t = (0.35 + 0.55 * (n / countyMax)).toFixed(2);
    return `rgba(16,185,129,${t})`;
  };

  // National view marks every real geocoded lead. The drilled view is purely
  // county-driven (no pins) — counties carry the density and link to the
  // breakdown page.
  const pinLeads = useMemo(
    () => (drilled ? [] : leads.filter((l) => l.lat != null && l.lng != null)),
    [drilled, leads],
  );

  const openBreakdown = (county?: string) =>
    router.push(
      `/network/territory/${selected}${county ? `?county=${county}` : ""}`,
    );

  const stateTotal = selected ? (counts[selected] ?? 0) : 0;

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

              {/* County zones — lit by lead count, click → breakdown page. */}
              <Geographies geography={stateCounties as never}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const code = fips5(geo.id);
                    const n = countyCounts[code] ?? 0;
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
                          if (n > 0) openBreakdown(code);
                        }}
                        style={{
                          default: {
                            fill: countyFill(n),
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
                        if (code) {
                          setStateName(name);
                          onSelect(isSel ? "" : code);
                        }
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
            if (lead.lat == null || lead.lng == null) return null;
            const [jx, jy] = jitter(lead.id);
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
                coordinates={[lead.lng + jx, lead.lat + jy]}
              >
                <circle
                  r={5.5}
                  fill="#fbbf24"
                  stroke="#0b1220"
                  strokeWidth={1.2}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selected) openBreakdown();
                  }}
                >
                  <title>{label || "Solar lead"}</title>
                </circle>
              </Marker>
            );
          })}
        </>
      </ComposableMap>

      {/* Breakdown entry bar — always available once drilled, so the deep
          state page is reachable even before any county is lit. */}
      {drilled ? (
        <button
          type="button"
          onClick={() => openBreakdown()}
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#0f1623",
            border: "1px solid #334155",
            borderRadius: 8,
            padding: "7px 12px",
            cursor: "pointer",
          }}
        >
          <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>
            {stateName || selected}
          </span>
          <span style={{ color: "#64748b", fontSize: 12 }}>
            {stateTotal} lead{stateTotal === 1 ? "" : "s"}
          </span>
          <span style={{ color: "#34d399", fontSize: 12, fontWeight: 600 }}>
            View full breakdown →
          </span>
        </button>
      ) : null}

      {hover ? (
        <div
          style={{
            position: "absolute",
            top: drilled ? 52 : 10,
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
            {drilled ? " County" : ""}
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
                ? `${hover.n} lead${hover.n === 1 ? "" : "s"} — click for breakdown`
                : `${hover.n} lead${hover.n === 1 ? "" : "s"} you qualify for`
              : drilled
                ? "No leads in this county"
                : "No leads here yet"}
          </div>
        </div>
      ) : null}

      {selected ? (
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
      ) : null}

      <div
        style={{
          marginTop: 6,
          textAlign: "center",
          fontSize: 11,
          color: "#64748b",
        }}
      >
        {drilled
          ? `Counties are shaded by lead density — click one to open its full breakdown.${
              unlocated > 0
                ? ` (${unlocated} lead${unlocated === 1 ? "" : "s"} not yet pinned to a county — still in the breakdown.)`
                : ""
            }`
          : "Click a state to drill into county-level lead density."}
      </div>
    </div>
  );
}
