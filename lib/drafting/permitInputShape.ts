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
    [key: string]: any;
  };
  system: {
    totalDcKw: number;
    totalAcKw: number;
    totalPanels: number;
    inverters?: Array<{
      strings?: Array<{
        panelWatts?: number;
        panelVoc?: number;
        panelIsc?: number;
      }>;
    }>;
    [key: string]: any;
  };
  layout?: {
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
  [key: string]: any;
}
