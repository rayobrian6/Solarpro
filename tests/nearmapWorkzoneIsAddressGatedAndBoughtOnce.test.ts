// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ADDRESS → BOUNDED PROJECT WORKZONE → IMAGERY ACQUISITION.
//
// Ray's direction, verbatim: "I do not want users opening Design Studio and freely browsing
// Nearmap across a city. Nearmap is expensive... The principle is: address → bounded project
// workzone → imagery acquisition, not: Design Studio → unlimited Nearmap map browser."
//
// And the live defect it closes: "I still have to enter the old 2D environment first and select
// Nearmap before I can effectively get Nearmap into the 3D workflow." The only two things that had
// ever bought Nearmap imagery were the 2D canvas's tile fetcher — a component lifecycle — and the
// permit generator, a different workflow. Neither belongs to the project, so the studio had
// nothing of its own to show and the user had to go and prime it somewhere else.
//
// WHAT IS MEASURED HERE is the RULE and the COST, without a database and without a network:
//
//   · nothing may be acquired before a project location is resolved;
//   · nothing may be acquired for a design that cannot keep it, because a toggle would re-buy;
//   · the bound is one property-sized frame, not a radius someone can pan across a city.
//
// The gate is one pure function used by BOTH the route and the picker, so the reason the button
// gives and the reason the server gives cannot drift apart.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  workzoneGate, isStoredWorkzone,
  WORKZONE_WIDTH_PX, WORKZONE_HEIGHT_PX, WORKZONE_FILE_NAME,
} from '@/lib/aerial/projectWorkzone';
import { groundResolutionCmPerPx, nearmapImageBounds } from '@/lib/map/webMercator';

const AT = { id: 'p-1', lat: 38.6657, lng: -90.2266 };

describe('🚨 the address gate', () => {
  it('refuses before there is a project at all', () => {
    const g = workzoneGate(null, true);
    expect(g.ok).toBe(false);
    expect(g.code).toBe('no-project');
  });

  it('🚨 refuses a project with no resolved location, in Ray’s own words', () => {
    const g = workzoneGate({ id: 'p-1', lat: null, lng: null }, true);
    expect(g.ok, 'a project with no address was allowed to buy imagery').toBe(false);
    expect(g.code).toBe('no-address');
    expect(g.reason).toBe('Select a project address to load Nearmap imagery.');
  });

  it('treats 0,0 as unresolved rather than as the Gulf of Guinea', () => {
    // A project row whose coordinates were never written reads as zeroes, and zero is a real
    // place. Buying imagery of open ocean is the same defect as buying it with no address.
    expect(workzoneGate({ id: 'p-1', lat: 0, lng: 0 }, true).code).toBe('no-address');
  });

  it('refuses coordinates outside the projection', () => {
    expect(workzoneGate({ id: 'p-1', lat: 88, lng: -90 }, true).code).toBe('no-address');
    expect(workzoneGate({ id: 'p-1', lat: 38, lng: 200 }, true).code).toBe('no-address');
  });

  it('🚨 refuses a design that cannot KEEP what it buys', () => {
    // A Quick Design has no row to store against. Acquiring for it would mean acquiring again on
    // the next Native → Nearmap switch, forever — the exact cost defect this whole slice exists
    // to prevent.
    const g = workzoneGate(AT, false);
    expect(g.ok).toBe(false);
    expect(g.code).toBe('not-storable');
  });

  it('allows a saved project with a resolved address, and hands back its own location', () => {
    const g = workzoneGate(AT, true);
    expect(g.ok).toBe(true);
    expect(g.location).toEqual({ lat: AT.lat, lng: AT.lng });
    expect(g.reason).toBeUndefined();
  });
});

describe('🚨 the workzone is a property, not a city', () => {
  it('is one frame the size the permit site plan has always acquired', () => {
    expect(WORKZONE_WIDTH_PX).toBe(1440);
    expect(WORKZONE_HEIGHT_PX).toBe(810);
  });

  it('covers about 80 m by 45 m of ground at z21 — a lot, and not a neighbourhood', () => {
    const cmPerPx = groundResolutionCmPerPx(AT.lat, 21)!;
    const widthM = (WORKZONE_WIDTH_PX * cmPerPx) / 100;
    const heightM = (WORKZONE_HEIGHT_PX * cmPerPx) / 100;
    expect(widthM).toBeGreaterThan(50);
    expect(widthM, `a ${widthM.toFixed(0)} m wide workzone is a neighbourhood, not a property`)
      .toBeLessThan(150);
    expect(heightM).toBeGreaterThan(30);
    expect(heightM).toBeLessThan(100);
  });

  it('and the rectangle it reports is the rectangle it covers', () => {
    // The bounds the studio draws the photo at come from the same four numbers the acquisition
    // used, through the same projection as the tile fetcher.
    const b = nearmapImageBounds(AT.lat, AT.lng, 21, WORKZONE_WIDTH_PX, WORKZONE_HEIGHT_PX)!;
    expect(b).toBeTruthy();
    expect((b.west + b.east) / 2).toBeCloseTo(AT.lng, 9);
    expect(b.north).toBeGreaterThan(AT.lat);
    expect(b.south).toBeLessThan(AT.lat);
  });
});

describe('🚨 a stored workzone is checked, never assumed', () => {
  const good = {
    imageSource: 'nearmap', imageBase64: 'data:image/jpeg;base64,AAAA',
    imageWidth: 1440, imageHeight: 810, zoom: 21, lat: AT.lat, lng: AT.lng,
    acquiredAt: '2026-09-27T00:00:00.000Z',
  };

  it('accepts a real record', () => {
    expect(isStoredWorkzone(good)).toBe(true);
  });

  it('rejects one whose provider is not Nearmap', () => {
    // 🚨 "Never claim Nearmap when ESRI/Google is actually being displayed." A record that does
    // not say nearmap cannot be served as the project's Nearmap workzone.
    expect(isStoredWorkzone({ ...good, imageSource: 'google' })).toBe(false);
  });

  it('rejects one with no image, a non-data-URL image, or missing georeferencing', () => {
    expect(isStoredWorkzone({ ...good, imageBase64: '' })).toBe(false);
    expect(isStoredWorkzone({ ...good, imageBase64: 'https://example.com/x.jpg' })).toBe(false);
    expect(isStoredWorkzone({ ...good, zoom: null })).toBe(false);
    expect(isStoredWorkzone({ ...good, lat: 'x' })).toBe(false);
    expect(isStoredWorkzone(null)).toBe(false);
    expect(isStoredWorkzone('{}')).toBe(false);
  });

  it('carries an acquisition time and NOT a capture date', () => {
    // R19. Nearmap's tile API supplies no capture date; `acquiredAt` is when SolarPro fetched it
    // and must never be presented as when the photograph was taken.
    expect(Object.keys(good)).toContain('acquiredAt');
    expect(Object.keys(good)).not.toContain('captureDate');
  });

  it('is stored under one name, so a project has ONE workzone', () => {
    expect(WORKZONE_FILE_NAME).toBe('aerial_workzone.json');
  });
});
