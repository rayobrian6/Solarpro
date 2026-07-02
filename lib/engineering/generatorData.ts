// Adapter shim — delegates to canonical @/lib/equipment-db (single source of
// truth) and presents the legacy `Generator` shape used by the estimator and
// proposal pages. Do NOT add new fields here; extend the canonical type.

import {
  GENERATORS as equipmentGenerators,
  getGeneratorById as equipmentGetGeneratorById,
  type GeneratorSystem,
} from "@/lib/equipment-db";

export type Appliance = {
  id: string;
  label: string;
  category: "HVAC" | "Kitchen" | "Laundry" | "Water" | "Lighting" | "Electronics" | "Well Pump" | "EV" | "Other";
  runningWatts: number;
  startingWatts: number;
  quantity?: number;
};

export const APPLIANCES: Appliance[] = [
  { id: "central-ac-3ton", label: "Central AC (3 ton)", category: "HVAC", runningWatts: 3500, startingWatts: 10500 },
  { id: "central-ac-4ton", label: "Central AC (4 ton)", category: "HVAC", runningWatts: 4500, startingWatts: 13500 },
  { id: "central-ac-5ton", label: "Central AC (5 ton)", category: "HVAC", runningWatts: 6000, startingWatts: 18000 },
  { id: "furnace-blower", label: "Gas furnace blower", category: "HVAC", runningWatts: 800, startingWatts: 2400 },
  { id: "heat-pump", label: "Heat pump", category: "HVAC", runningWatts: 4700, startingWatts: 14000 },
  { id: "electric-strip-heat", label: "Electric strip heat (per 5 kW)", category: "HVAC", runningWatts: 5000, startingWatts: 5000 },

  { id: "refrigerator", label: "Refrigerator", category: "Kitchen", runningWatts: 800, startingWatts: 2400 },
  { id: "freezer", label: "Freezer (chest)", category: "Kitchen", runningWatts: 600, startingWatts: 1800 },
  { id: "electric-range", label: "Electric range", category: "Kitchen", runningWatts: 8000, startingWatts: 8000 },
  { id: "gas-range", label: "Gas range", category: "Kitchen", runningWatts: 200, startingWatts: 200 },
  { id: "dishwasher", label: "Dishwasher", category: "Kitchen", runningWatts: 1500, startingWatts: 1500 },
  { id: "microwave", label: "Microwave", category: "Kitchen", runningWatts: 1200, startingWatts: 1200 },
  { id: "coffee-maker", label: "Coffee maker", category: "Kitchen", runningWatts: 1000, startingWatts: 1000 },
  { id: "toaster", label: "Toaster", category: "Kitchen", runningWatts: 1200, startingWatts: 1200 },

  { id: "electric-dryer", label: "Electric dryer", category: "Laundry", runningWatts: 5000, startingWatts: 5000 },
  { id: "gas-dryer", label: "Gas dryer", category: "Laundry", runningWatts: 700, startingWatts: 1800 },
  { id: "washer", label: "Washing machine", category: "Laundry", runningWatts: 1200, startingWatts: 3600 },

  { id: "electric-water-heater", label: "Electric water heater", category: "Water", runningWatts: 4500, startingWatts: 4500 },
  { id: "gas-water-heater", label: "Gas water heater", category: "Water", runningWatts: 400, startingWatts: 400 },
  { id: "tankless-water-heater", label: "Tankless water heater (electric)", category: "Water", runningWatts: 8000, startingWatts: 8000 },
  { id: "sump-pump", label: "Sump pump (1/2 HP)", category: "Water", runningWatts: 1050, startingWatts: 3150 },

  { id: "well-pump-1hp", label: "Well pump (1 HP)", category: "Well Pump", runningWatts: 1800, startingWatts: 5400 },
  { id: "well-pump-2hp", label: "Well pump (2 HP)", category: "Well Pump", runningWatts: 3500, startingWatts: 10500 },

  { id: "lights-led", label: "LED lights (10 bulbs)", category: "Lighting", runningWatts: 100, startingWatts: 100 },
  { id: "lights-incandescent", label: "Incandescent lights (10 bulbs)", category: "Lighting", runningWatts: 600, startingWatts: 600 },

  { id: "tv-55", label: "55\" TV", category: "Electronics", runningWatts: 200, startingWatts: 200 },
  { id: "computer", label: "Desktop computer + monitor", category: "Electronics", runningWatts: 400, startingWatts: 400 },
  { id: "wifi-router", label: "WiFi router + modem", category: "Electronics", runningWatts: 30, startingWatts: 30 },
  { id: "security-system", label: "Security system", category: "Electronics", runningWatts: 50, startingWatts: 50 },
  { id: "garage-door", label: "Garage door opener", category: "Electronics", runningWatts: 800, startingWatts: 2400 },

  { id: "ev-charger-l1", label: "EV charger (Level 1, 1.4 kW)", category: "EV", runningWatts: 1400, startingWatts: 1400 },
  { id: "ev-charger-l2", label: "EV charger (Level 2, 11 kW)", category: "EV", runningWatts: 11000, startingWatts: 11000 },

  { id: "hot-tub", label: "Hot tub", category: "Other", runningWatts: 5000, startingWatts: 5000 },
  { id: "pool-pump", label: "Pool pump (1 HP)", category: "Other", runningWatts: 1800, startingWatts: 5400 },
];

// Legacy `Generator` shape used by the estimator and proposal pages — derived
// from the canonical `GeneratorSystem` in equipment-db. Keep this in sync
// rather than renaming call-sites; the engineering UI is not the canonical
// catalog.
export type Generator = {
  brand: string;
  model: string;
  series?: string;
  kw: number;
  fuel: string;
  msrp?: number;
  motorStartingAmps?: number;
  url?: string;
};

function adaptGenerator(g: GeneratorSystem): Generator {
  return {
    brand: g.manufacturer,
    model: g.model,
    kw: g.ratedOutputKw,
    fuel: g.fuelType,
    msrp: g.msrpUsd,
    url: g.datasheetUrl,
  };
}

export const GENERATORS: Generator[] = equipmentGenerators.map(adaptGenerator);

export function getGeneratorById(id: string): Generator | undefined {
  const g = equipmentGetGeneratorById(id);
  return g ? adaptGenerator(g) : undefined;
}

export const CATEGORIES: Array<Appliance["category"]> = [
  "HVAC",
  "Kitchen",
  "Laundry",
  "Water",
  "Well Pump",
  "Lighting",
  "Electronics",
  "EV",
  "Other",
];
