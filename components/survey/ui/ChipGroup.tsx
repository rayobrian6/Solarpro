// ============================================================================
// v47.437 - Survey V2: ChipGroup
//
// Chip-style single-select and multi-select inputs.
// Used throughout the survey for structured enum fields (roof material, pitch,
// panel brand, etc.) instead of dropdowns.
//
// ChipGroup       - single select (value: string)
// MultiChipGroup  - multi select (value: string[])
//
// Pure ASCII, no Unicode.
// ============================================================================

import React from 'react';

// ---------------------------------------------------------------------------
// ChipOption type
// ---------------------------------------------------------------------------
export interface ChipOption {
  value: string;
  label: string;
  icon?: string;   // emoji or short symbol - keep ASCII when possible
  color?: 'default' | 'green' | 'yellow' | 'red' | 'blue' | 'cyan';
}

// ---------------------------------------------------------------------------
// chipColorClass - maps color key to Tailwind active classes
// ---------------------------------------------------------------------------
function chipColorClass(
  color: ChipOption['color'],
  selected: boolean,
): string {
  if (!selected) {
    return 'bg-white border-gray-300 text-gray-600 hover:border-cyan-400 hover:text-cyan-700';
  }
  switch (color) {
    case 'green':  return 'bg-green-500 border-green-500 text-white';
    case 'yellow': return 'bg-yellow-400 border-yellow-400 text-gray-900';
    case 'red':    return 'bg-red-500 border-red-500 text-white';
    case 'blue':   return 'bg-blue-500 border-blue-500 text-white';
    case 'cyan':   return 'bg-cyan-500 border-cyan-500 text-white';
    default:       return 'bg-gray-800 border-gray-800 text-white';
  }
}

// ---------------------------------------------------------------------------
// ChipGroup - single select
// ---------------------------------------------------------------------------
interface ChipGroupProps {
  options: ChipOption[];
  value: string;
  onChange: (value: string) => void;
  columns?: 2 | 3 | 4;
  disabled?: boolean;
}

export function ChipGroup({
  options,
  value,
  onChange,
  columns = 3,
  disabled,
}: ChipGroupProps) {
  const gridClass = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  }[columns];

  return (
    <div className={`grid ${gridClass} gap-2`}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(selected ? '' : opt.value)}
            className={`
              flex flex-col items-center justify-center gap-0.5
              rounded-lg border px-2 py-2.5 text-xs font-medium
              transition-all duration-150 select-none
              ${chipColorClass(opt.color, selected)}
              disabled:opacity-40 disabled:cursor-not-allowed
            `}
            aria-pressed={selected}
          >
            {opt.icon ? (
              <span className="text-base leading-none">{opt.icon}</span>
            ) : null}
            <span className="text-center leading-tight">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MultiChipGroup - multi select
// ---------------------------------------------------------------------------
interface MultiChipGroupProps {
  options: ChipOption[];
  value: string[];
  onChange: (value: string[]) => void;
  columns?: 2 | 3 | 4;
  disabled?: boolean;
}

export function MultiChipGroup({
  options,
  value,
  onChange,
  columns = 3,
  disabled,
}: MultiChipGroupProps) {
  const gridClass = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  }[columns];

  function toggle(optValue: string) {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  }

  return (
    <div className={`grid ${gridClass} gap-2`}>
      {options.map((opt) => {
        const selected = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => toggle(opt.value)}
            className={`
              flex flex-col items-center justify-center gap-0.5
              rounded-lg border px-2 py-2.5 text-xs font-medium
              transition-all duration-150 select-none
              ${chipColorClass(opt.color, selected)}
              disabled:opacity-40 disabled:cursor-not-allowed
            `}
            aria-pressed={selected}
          >
            {opt.icon ? (
              <span className="text-base leading-none">{opt.icon}</span>
            ) : null}
            <span className="text-center leading-tight">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip option sets for the survey fields
// ---------------------------------------------------------------------------

export const ROOF_MATERIAL_OPTIONS: ChipOption[] = [
  { value: 'comp_shingle',       label: 'Comp Shingle',      icon: '#' },
  { value: 'tile_concrete',      label: 'Tile Concrete',     icon: '#' },
  { value: 'tile_clay',          label: 'Tile Clay',         icon: '#' },
  { value: 'metal_standing_seam',label: 'Metal Standing',    icon: '#' },
  { value: 'metal_r_panel',      label: 'Metal R-Panel',     icon: '#' },
  { value: 'flat_tpo',           label: 'Flat TPO',          icon: '#' },
  { value: 'flat_epdm',          label: 'Flat EPDM',         icon: '#' },
  { value: 'flat_torch',         label: 'Flat Torch',        icon: '#' },
  { value: 'wood_shake',         label: 'Wood Shake',        icon: '#' },
  { value: 'other',              label: 'Other',             icon: '?' },
];

export const ROOF_PITCH_OPTIONS: ChipOption[] = [
  { value: 'flat',       label: 'Flat',           icon: '<2/12' },
  { value: 'low',        label: 'Low slope',      icon: '2-4/12' },
  { value: 'standard',   label: 'Medium slope',   icon: '5-9/12', color: 'green' },
  { value: 'steep',      label: 'Steep',          icon: '10-14/12', color: 'yellow' },
  { value: 'very_steep', label: 'Very steep',     icon: '15+/12', color: 'red' },
];

export const RAFTER_SPACING_OPTIONS: ChipOption[] = [
  { value: '16',    label: 'Close (16" apart)',  color: 'green' },
  { value: '24',    label: 'Standard (24" apart)', color: 'cyan' },
  { value: 'other', label: 'Other',              },
];

export const ROOF_CONDITION_OPTIONS: ChipOption[] = [
  { value: 'good', label: 'Good',  color: 'green' },
  { value: 'fair', label: 'Fair',  color: 'yellow' },
  { value: 'poor', label: 'Poor',  color: 'red' },
];

export const PANEL_RATING_OPTIONS: ChipOption[] = [
  { value: '100',   label: '100A' },
  { value: '150',   label: '150A' },
  { value: '200',   label: '200A', color: 'green' },
  { value: '225',   label: '225A' },
  { value: '320',   label: '320A' },
  { value: '400',   label: '400A' },
  { value: 'other', label: 'Other' },
];

export const PANEL_BRAND_OPTIONS: ChipOption[] = [
  { value: 'siemens',         label: 'Siemens' },
  { value: 'square_d',        label: 'Square D' },
  { value: 'eaton',           label: 'Eaton' },
  { value: 'cutler_hammer',   label: 'Cutler-Hammer' },
  { value: 'ge',              label: 'GE' },
  { value: 'federal_pacific', label: 'Fed Pacific', color: 'red' },
  { value: 'zinsco',          label: 'Zinsco',      color: 'red' },
  { value: 'leviton',         label: 'Leviton' },
  { value: 'other',           label: 'Other' },
];

export const BREAKER_SLOT_OPTIONS: ChipOption[] = [
  { value: '0',   label: '0 slots',  color: 'red' },
  { value: '1-2', label: '1-2 slots', color: 'yellow' },
  { value: '3-4', label: '3-4 slots', color: 'green' },
  { value: '5+',  label: '5+ slots',  color: 'green' },
];

export const METER_SOCKET_OPTIONS: ChipOption[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'combo',    label: 'Combo' },
  { value: '320a',     label: '320A' },
  { value: 'other',    label: 'Other' },
];

export const INTERCONNECTION_OPTIONS: ChipOption[] = [
  { value: 'main_panel',  label: 'Main Panel' },
  { value: 'sub_panel',   label: 'Sub Panel' },
  { value: 'load_side',   label: 'Load Side Tap' },
  { value: 'supply_side', label: 'Supply Side Tap' },
];

export const SERVICE_ENTRANCE_OPTIONS: ChipOption[] = [
  { value: 'overhead',    label: 'Overhead',    color: 'blue' },
  { value: 'underground', label: 'Underground', color: 'cyan' },
];

export const STRUCTURE_TYPE_OPTIONS: ChipOption[] = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial',  label: 'Commercial' },
  { value: 'industrial',  label: 'Industrial' },
];

export const STORIES_OPTIONS: ChipOption[] = [
  { value: '1',  label: '1 Story' },
  { value: '2',  label: '2 Stories' },
  { value: '3+', label: '3+ Stories' },
];

export const OBSTRUCTION_TYPE_OPTIONS: ChipOption[] = [
  { value: 'chimney',       label: 'Chimney' },
  { value: 'hvac_unit',     label: 'HVAC Unit' },
  { value: 'vent_pipe',     label: 'Vent Pipe' },
  { value: 'skylight',      label: 'Skylight' },
  { value: 'dormer',        label: 'Dormer' },
  { value: 'tree_shade',    label: 'Tree Shade' },
  { value: 'antenna',       label: 'Antenna' },
  { value: 'satellite_dish',label: 'Satellite' },
  { value: 'exhaust_fan',   label: 'Exhaust Fan' },
  { value: 'solar_tube',    label: 'Solar Tube' },
  { value: 'other',         label: 'Other' },
];

export const OBSTRUCTION_LOCATION_OPTIONS: ChipOption[] = [
  { value: 'north',  label: 'North' },
  { value: 'south',  label: 'South' },
  { value: 'east',   label: 'East' },
  { value: 'west',   label: 'West' },
  { value: 'ridge',  label: 'Ridge' },
  { value: 'valley', label: 'Valley' },
  { value: 'center', label: 'Center' },
];