// Neutral PermitInputShape type shared by CAD and drafting layers.
// Keep this module type-only and leaf-level so CAD solvers do not import the
// high-level drafting barrel and recreate CAD ↔ drafting cycles.

export interface PermitInputShape {
  project: {
    systemType?: string;
    roofType?: string;
    roofPitch?: number;
    mountingSystem?: string;
    rafterSize?: string;
    rafterSpacing?: number;
    attachmentSpacing?: number;
    panelLengthIn?: number;
    panelWidthIn?: number;
    panelWeightLbs?: number;
    conduitType?: string;
    ahjWindSpeedMph?: number;
    ahjGroundSnowPsf?: number;
    ahjRoofSetbackIn?: number;
    ahjRidgeSetbackIn?: number;
    panelPositions?: any[];
    roofPlanes?: any[];
    /**
     * Obstructions the designer MARKED BY HAND in the 3D studio.
     *
     * 🚨 DECLARED, NOT A STOWAWAY. `roofObstructions` — the field the roof plan
     * ultimately draws — is assembled on the server from the Nearmap AI sweep
     * and the aerial-vision detector. Hand-placed objects reached neither, so a
     * chimney the designer marked cleared panels in the design and was absent
     * from the stamped drawing.
     *
     * They arrive separately and tagged so the two provenances stay
     * distinguishable, and are merged in `roofCAD` — which is where every
     * obstruction becomes local-frame geometry, so the manual ones get the same
     * treatment rather than a bypass. Produced by
     * `lib/obstruction/permitProjection.ts`, which takes its clearance and
     * radius from the SAME authorities the 3D panel keep-out uses.
     */
    manualRoofObstructions?: Array<{
      lat: number;
      lng: number;
      radiusFt: number;
      clearanceFt: number;
      type: string;
      planeId?: string;
      source?: 'manual';
    }>;
    // Error 5u fix: lat/lng accessed in groundCAD.ts via `as any` — declare explicitly
    lat?: number;
    lng?: number;
    [key: string]: any;
  };
  system: {
    totalDcKw: number;
    totalAcKw: number;
    totalPanels: number;
    inverters?: Array<{
      manufacturer?: string;
      model?: string;
      strings?: Array<{
        panelWatts?: number;
        panelVoc?: number;
        panelIsc?: number;
        panelManufacturer?: string;
        panelModel?: string;
      }>;
    }>;
    [key: string]: any;
  };
  layout?: {
    // Error 5v fix: type accessed in cadEngine.ts via `as any` — declare explicitly
    type?: string;
    systemType?: string;
    fenceSegments?: any[];
    fenceTotalLengthFt?: number;
    fenceGateOpenings?: any[];
    fencePostSpacingFt?: number;
    fencePostEmbedmentFt?: number;
    fenceRailCount?: number;
    fencePanelHeightFt?: number;
    groundArrays?: any[];
    groundSetbackFt?: number;
  };
  // Error 5q fix: explicit typed field instead of relying on [key: string]: any
  _canonicalCADBridge?: import('@/lib/cad/canonicalBridge').CanonicalBridgeResult;
  // Error 5w fix: _systemDefinition accessed in roofCAD.ts via `as any` — declare explicitly
  _systemDefinition?: import('@/lib/system/systemDefinition').SystemDefinition;
  [key: string]: any;
}
