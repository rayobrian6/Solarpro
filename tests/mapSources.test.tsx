/**
 * @vitest-environment jsdom
 *
 * tests/mapSources.test.tsx
 *
 * Unit tests for the map-source picker (Aurora parity).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import {
  MapSourcePicker, DetailsDropdown, SourceTabs, SourcePicker,
  SOURCES, LAYERS, TABS, DEFAULT_PICKER_STATE,
  toggleLayer, setSource, setTab, activeLayerCount,
  isMapSource, isMapTab, isMapLayer,
} from '@/components/3d/mapSource';
import type { MapPickerState } from '@/components/3d/mapSource';

afterEach(() => cleanup());

// ─── 1. Pure-state tests ────────────────────────────────────────────────────

describe('mapSources — registries', () => {
  it('SOURCES contains the four Aurora providers in fixed order', () => {
    expect(SOURCES.map(s => s.id)).toEqual(['google', 'bing', 'mapbox', 'nearmap']);
  });

  it('every SOURCE has a unique id, label, iconKey, and non-empty description', () => {
    const ids = SOURCES.map(s => s.id);
    expect(new Set(ids).size).toBe(SOURCES.length);
    for (const s of SOURCES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(['google', 'bing', 'mapbox', 'nearmap']).toContain(s.iconKey);
    }
  });

  it('LAYERS contains all six overlays and only `imagery` is defaultOn', () => {
    expect(LAYERS.map(l => l.id)).toEqual([
      'imagery', 'treeCoverage', 'parcels', 'sunPath', 'shadeMap', 'irradiance',
    ]);
    const defaults = LAYERS.filter(l => l.defaultOn);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe('imagery');
  });

  it('TABS contains exactly `LiDAR` and `Street View`', () => {
    expect(TABS.map(t => t.id)).toEqual(['streetView', 'lidar']);
    expect(TABS.map(t => t.label)).toContain('LiDAR');
    expect(TABS.map(t => t.label)).toContain('Street View');
  });

  it('DEFAULT_PICKER_STATE is google + streetView + imagery-only', () => {
    expect(DEFAULT_PICKER_STATE.source).toBe('google');
    expect(DEFAULT_PICKER_STATE.tab).toBe('streetView');
    expect(Array.from(DEFAULT_PICKER_STATE.layers)).toEqual(['imagery']);
  });
});

describe('mapSources — state helpers (immutability)', () => {
  it('toggleLayer adds a new layer and returns a fresh state', () => {
    const next = toggleLayer(DEFAULT_PICKER_STATE, 'parcels');
    expect(next.layers.has('parcels')).toBe(true);
    expect(next.layers.has('imagery')).toBe(true);
    expect(DEFAULT_PICKER_STATE.layers.has('parcels')).toBe(false);
  });

  it('toggleLayer twice = back to the original set', () => {
    const once = toggleLayer(DEFAULT_PICKER_STATE, 'parcels');
    const twice = toggleLayer(once, 'parcels');
    expect(twice.layers.has('parcels')).toBe(false);
    expect(twice.layers.size).toBe(DEFAULT_PICKER_STATE.layers.size);
  });

  it('toggleLayer is a no-op for the locked `imagery` layer', () => {
    const next = toggleLayer(DEFAULT_PICKER_STATE, 'imagery');
    expect(next).toBe(DEFAULT_PICKER_STATE);
    expect(next.layers.has('imagery')).toBe(true);
  });

  it('setSource replaces the source and preserves layers + tab', () => {
    const next = setSource(DEFAULT_PICKER_STATE, 'bing');
    expect(next.source).toBe('bing');
    expect(next.tab).toBe(DEFAULT_PICKER_STATE.tab);
    expect(next.layers.size).toBe(DEFAULT_PICKER_STATE.layers.size);
  });

  it('setSource is a no-op when the source is unchanged', () => {
    const next = setSource(DEFAULT_PICKER_STATE, 'google');
    expect(next).toBe(DEFAULT_PICKER_STATE);
  });

  it('setTab replaces the tab and preserves source + layers', () => {
    const next = setTab(DEFAULT_PICKER_STATE, 'lidar');
    expect(next.tab).toBe('lidar');
    expect(next.source).toBe(DEFAULT_PICKER_STATE.source);
  });

  it('activeLayerCount reflects the number of on layers', () => {
    expect(activeLayerCount(DEFAULT_PICKER_STATE)).toBe(1);
    const s1 = toggleLayer(DEFAULT_PICKER_STATE, 'parcels');
    expect(activeLayerCount(s1)).toBe(2);
    const s2 = toggleLayer(s1, 'shadeMap');
    expect(activeLayerCount(s2)).toBe(3);
    const s3 = toggleLayer(s2, 'parcels');
    expect(activeLayerCount(s3)).toBe(2);
  });
});

describe('mapSources — type guards', () => {
  it('isMapSource recognises the four valid sources', () => {
    for (const v of ['google', 'bing', 'mapbox', 'nearmap']) {
      expect(isMapSource(v)).toBe(true);
    }
    for (const v of ['osm', 'apple', '', null, undefined, 42, {}]) {
      expect(isMapSource(v as unknown)).toBe(false);
    }
  });

  it('isMapTab recognises the two valid tabs', () => {
    expect(isMapTab('streetView')).toBe(true);
    expect(isMapTab('lidar')).toBe(true);
    expect(isMapTab('foo' as unknown)).toBe(false);
    expect(isMapTab(null)).toBe(false);
  });

  it('isMapLayer recognises the six valid layers', () => {
    for (const v of ['imagery', 'treeCoverage', 'parcels', 'sunPath', 'shadeMap', 'irradiance']) {
      expect(isMapLayer(v)).toBe(true);
    }
    expect(isMapLayer('trees' as unknown)).toBe(false);
    expect(isMapLayer(undefined)).toBe(false);
  });
});

// ─── 2. Component tests ─────────────────────────────────────────────────────

function ControlledPicker(props: { initial?: MapPickerState; disabled?: boolean }) {
  const [state, setState] = React.useState<MapPickerState>(
    props.initial ?? DEFAULT_PICKER_STATE
  );
  return <MapSourcePicker state={state} onChange={setState} disabled={props.disabled} />;
}

describe('MapSourcePicker — rendering', () => {
  it('renders the three control triggers with Aurora-style labels', () => {
    render(<ControlledPicker />);
    expect(screen.getByTestId('map-source-details')).toBeInTheDocument();
    expect(screen.getByTestId('map-source-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('map-source-picker')).toBeInTheDocument();
    expect(screen.getByTestId('map-source-tab-streetView')).toHaveTextContent('Street View');
    expect(screen.getByTestId('map-source-tab-lidar')).toHaveTextContent('LiDAR');
  });

  it('initial tab is `streetView` (active) and `lidar` is inactive', () => {
    render(<ControlledPicker />);
    expect(screen.getByTestId('map-source-tab-streetView')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('map-source-tab-lidar')).toHaveAttribute('aria-selected', 'false');
  });

  it('shows the current source label inside the picker button', () => {
    render(<ControlledPicker />);
    expect(screen.getByTestId('map-source-picker-label').textContent).toBe('Google');
  });

  it('shows the active layer count in the Details button', () => {
    render(<ControlledPicker initial={{
      source: 'google', tab: 'streetView',
      layers: new Set(['imagery', 'parcels', 'shadeMap']),
    }} />);
    expect(screen.getByTestId('map-source-details-count').textContent).toBe('3');
  });
});

describe('MapSourcePicker — tab interactions', () => {
  it('clicking LiDAR switches the active tab to lidar', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-tab-lidar'));
    expect(screen.getByTestId('map-source-tab-lidar')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('map-source-tab-streetView')).toHaveAttribute('aria-selected', 'false');
  });

  it('clicking the active tab is a no-op (state does not change)', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-tab-streetView'));
    expect(screen.getByTestId('map-source-tab-streetView')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('MapSourcePicker — Details dropdown', () => {
  it('opens the layers menu on click and shows all six layers', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-details').querySelector('button')!);
    const menu = screen.getByTestId('map-source-details-menu');
    expect(menu).toBeInTheDocument();
    for (const l of LAYERS) {
      expect(within(menu).getByTestId(`map-source-layer-${l.id}`)).toBeInTheDocument();
    }
  });

  it('toggling Tree coverage adds it to the active layer set', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-details').querySelector('button')!);
    fireEvent.click(screen.getByTestId('map-source-layer-treeCoverage'));
    // Reopen to check state.
    fireEvent.click(screen.getByTestId('map-source-details').querySelector('button')!);
    fireEvent.click(screen.getByTestId('map-source-details').querySelector('button')!);
    expect(screen.getByTestId('map-source-details-count').textContent).toBe('2');
    expect(screen.getByTestId('map-source-layer-treeCoverage')).toHaveAttribute('aria-checked', 'true');
  });

  it('the locked `imagery` row is disabled and always checked', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-details').querySelector('button')!);
    const imageryRow = screen.getByTestId('map-source-layer-imagery');
    expect(imageryRow).toHaveAttribute('aria-checked', 'true');
    expect(imageryRow).toBeDisabled();
  });

  it('Imagery row has aria-disabled (state unchanged on click)', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-details').querySelector('button')!);
    const imageryRow = screen.getByTestId('map-source-layer-imagery');
    expect(imageryRow).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('MapSourcePicker — Source picker', () => {
  it('opens the source menu and shows all four providers', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-picker').querySelector('button')!);
    const menu = screen.getByTestId('map-source-picker-menu');
    expect(menu).toBeInTheDocument();
    for (const s of SOURCES) {
      expect(within(menu).getByTestId(`map-source-option-${s.id}`)).toBeInTheDocument();
    }
  });

  it('the active source (Google) is marked aria-checked', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-picker').querySelector('button')!);
    expect(screen.getByTestId('map-source-option-google')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('map-source-option-bing')).toHaveAttribute('aria-checked', 'false');
  });

  it('selecting Bing updates the picker label and closes the menu', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-picker').querySelector('button')!);
    fireEvent.click(screen.getByTestId('map-source-option-bing'));
    expect(screen.getByTestId('map-source-picker-label').textContent).toBe('Bing');
    expect(screen.queryByTestId('map-source-picker-menu')).toBeNull();
  });

  it('selecting the already-active source still closes the menu', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-picker').querySelector('button')!);
    fireEvent.click(screen.getByTestId('map-source-option-google'));
    expect(screen.queryByTestId('map-source-picker-menu')).toBeNull();
  });
});

describe('MapSourcePicker — popover behavior', () => {
  it('Escape closes any open popover', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-details').querySelector('button')!);
    expect(screen.getByTestId('map-source-details-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('map-source-details-menu')).toBeNull();
  });

  it('clicking outside the picker closes the open menu', () => {
    render(
      <div>
        <ControlledPicker />
        <button data-testid="outside-button">outside</button>
      </div>
    );
    fireEvent.click(screen.getByTestId('map-source-picker').querySelector('button')!);
    expect(screen.getByTestId('map-source-picker-menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside-button'));
    expect(screen.queryByTestId('map-source-picker-menu')).toBeNull();
  });

  it('opening the Source menu closes the Details menu', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-details').querySelector('button')!);
    expect(screen.getByTestId('map-source-details-menu')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('map-source-picker').querySelector('button')!);
    expect(screen.queryByTestId('map-source-details-menu')).toBeNull();
    expect(screen.getByTestId('map-source-picker-menu')).toBeInTheDocument();
  });
});

describe('MapSourcePicker — disabled prop', () => {
  it('disables the Details trigger and prevents opening', () => {
    render(<ControlledPicker disabled />);
    const trigger = screen.getByTestId('map-source-details').querySelector('button')!;
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByTestId('map-source-details-menu')).toBeNull();
  });

  it('disables the tab buttons', () => {
    render(<ControlledPicker disabled />);
    expect(screen.getByTestId('map-source-tab-lidar')).toBeDisabled();
    expect(screen.getByTestId('map-source-tab-streetView')).toBeDisabled();
  });

  it('disables the source picker trigger', () => {
    render(<ControlledPicker disabled />);
    const trigger = screen.getByTestId('map-source-picker').querySelector('button')!;
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByTestId('map-source-picker-menu')).toBeNull();
  });
});

describe('MapSourcePicker — Aurora parity', () => {
  it('exposes Aurora\'s exact label set when the picker is open', () => {
    render(<ControlledPicker />);
    fireEvent.click(screen.getByTestId('map-source-picker').querySelector('button')!);
    for (const s of SOURCES) {
      expect(screen.getAllByText(s.label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('LiDAR')).toBeInTheDocument();
    expect(screen.getByText('Street View')).toBeInTheDocument();
  });

  it('exposes all four Aurora source IDs', () => {
    const ids = SOURCES.map(s => s.id).sort();
    expect(ids).toEqual(['bing', 'google', 'mapbox', 'nearmap']);
  });
});

// ─── 3. Direct sub-component tests ──────────────────────────────────────────

describe('DetailsDropdown — direct', () => {
  it('renders nothing when closed and a menu when open', () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    const { rerender } = render(
      <DetailsDropdown activeLayers={DEFAULT_PICKER_STATE.layers} onToggle={onToggle} open={false} onOpenChange={onOpen} />
    );
    expect(screen.queryByTestId('map-source-details-menu')).toBeNull();
    rerender(
      <DetailsDropdown activeLayers={DEFAULT_PICKER_STATE.layers} onToggle={onToggle} open={true} onOpenChange={onOpen} />
    );
    expect(screen.getByTestId('map-source-details-menu')).toBeInTheDocument();
  });
});

describe('SourceTabs — direct', () => {
  it('marks exactly one tab as selected', () => {
    render(<SourceTabs tab="lidar" onChange={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    const selected = tabs.filter(t => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('LiDAR');
  });

  it('calls onChange with the new tab id when a tab is clicked', () => {
    const onChange = vi.fn();
    render(<SourceTabs tab="streetView" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('map-source-tab-lidar'));
    expect(onChange).toHaveBeenCalledWith('lidar');
  });
});

describe('SourcePicker — direct', () => {
  it('shows the current source label on the trigger', () => {
    render(<SourcePicker source="mapbox" onChange={() => {}} open={false} onOpenChange={() => {}} />);
    expect(screen.getByTestId('map-source-picker-label').textContent).toBe('Mapbox');
  });

  it('calls onChange with the selected id when an option is clicked', () => {
    const onChange = vi.fn();
    const onOpen = vi.fn();
    render(<SourcePicker source="google" onChange={onChange} open={true} onOpenChange={onOpen} />);
    fireEvent.click(screen.getByTestId('map-source-option-nearmap'));
    expect(onChange).toHaveBeenCalledWith('nearmap');
    expect(onOpen).toHaveBeenCalledWith(false);
  });
});
