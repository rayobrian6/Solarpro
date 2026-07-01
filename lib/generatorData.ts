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

export type Generator = {
  brand: "Generac" | "Briggs & Stratton";
  model: string;
  series: string;
  kw: number;
  fuel: "NG/LP" | "NG" | "LP";
  msrp: number;
  motorStartingAmps?: number;
  url?: string;
};

export const GENERATORS: Generator[] = [
  { brand: "Generac", model: "7291", series: "Guardian", kw: 26, fuel: "NG/LP", msrp: 7899, motorStartingAmps: 78, url: "https://www.generac.com/residential-products/standby-generators/" },
  { brand: "Generac", model: "7210", series: "Guardian", kw: 24, fuel: "NG/LP", msrp: 7199, motorStartingAmps: 72, url: "https://www.generac.com/residential-products/standby-generators/" },
  { brand: "Generac", model: "7043", series: "Guardian", kw: 22, fuel: "NG/LP", msrp: 14339, motorStartingAmps: 66, url: "https://www.generac.com/residential-products/standby-generators/" },
  { brand: "Generac", model: "7228", series: "Guardian", kw: 18, fuel: "NG/LP", msrp: 5899, motorStartingAmps: 54, url: "https://www.generac.com/residential-products/standby-generators/" },
  { brand: "Generac", model: "7225", series: "Guardian", kw: 14, fuel: "NG/LP", msrp: 5139, motorStartingAmps: 42, url: "https://www.generac.com/residential-products/standby-generators/" },
  { brand: "Generac", model: "7172", series: "Guardian", kw: 10, fuel: "NG/LP", msrp: 3769, motorStartingAmps: 30, url: "https://www.generac.com/residential-products/standby-generators/" },

  { brand: "Briggs & Stratton", model: "040746", series: "PowerProtect", kw: 26, fuel: "NG/LP", msrp: 6499, motorStartingAmps: 81, url: "https://energy.briggsandstratton.com/en-us/products/residential-standby-generators" },
  { brand: "Briggs & Stratton", model: "040744", series: "PowerProtect", kw: 22, fuel: "NG/LP", msrp: 5799, motorStartingAmps: 66, url: "https://energy.briggsandstratton.com/en-us/products/residential-standby-generators" },
  { brand: "Briggs & Stratton", model: "040743", series: "PowerProtect", kw: 18, fuel: "NG/LP", msrp: 4999, motorStartingAmps: 54, url: "https://energy.briggsandstratton.com/en-us/products/residential-standby-generators" },
  { brand: "Briggs & Stratton", model: "040742", series: "PowerProtect", kw: 13, fuel: "NG/LP", msrp: 4283, motorStartingAmps: 39, url: "https://energy.briggsandstratton.com/en-us/products/residential-standby-generators" },
];

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