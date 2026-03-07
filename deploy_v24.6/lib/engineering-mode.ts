// ============================================================
// Engineering Mode Controller
// AUTO / MANUAL mode state management + correction audit trail
// ============================================================
//
// AUTO mode:  System deterministically corrects violations.
//             Every correction is logged with NEC reference.
//
// MANUAL mode: User overrides are accepted.
//              Compliance warnings are displayed.
//              All overrides are logged in audit trail.
//
// ============================================================

export type EngineeringMode = 'AUTO' | 'MANUAL';

export type CorrectionType =
  | 'OCPD_CAPPED'           // OCPD capped at module maxSeriesFuse
  | 'OCPD_CALCULATED'       // OCPD calculated from Isc
  | 'AC_WIRE_BUMPED'        // AC wire gauge bumped for ampacity
  | 'AC_WIRE_BUMPED_VDROP'  // AC wire gauge bumped for voltage drop
  | 'DC_WIRE_BUMPED'        // DC wire gauge bumped
  | 'CONDUIT_UPSIZED'       // Conduit upsized for fill
  | 'MANUAL_OVERRIDE'       // User override in MANUAL mode
  | 'NEC_VIOLATION_FLAGGED' // Violation flagged (MANUAL mode, no auto-fix)
  | 'AUTO_RESOLVED';        // Generic auto-resolution

export interface CorrectionLogEntry {
  id: string;                   // unique entry id
  timestamp: string;            // ISO timestamp
  mode: EngineeringMode;
  type: CorrectionType;
  field: string;                // e.g. "string-1-1.ocpd", "ac.wireGauge"
  originalValue: string | number;
  resolvedValue: string | number;
  necReference: string;
  reason: string;
  autoApplied: boolean;         // true = system applied, false = user override
  userAcknowledged: boolean;    // user has seen this correction
}

export interface EngineeringModeState {
  mode: EngineeringMode;
  correctionLog: CorrectionLogEntry[];
  pendingViolations: PendingViolation[];
  lastCalculatedAt: string | null;
  autoResolutionCount: number;
  manualOverrideCount: number;
}

export interface PendingViolation {
  id: string;
  field: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  necReference: string;
  suggestedValue?: string | number;
  currentValue: string | number;
  requiresUserAction: boolean;
}

// ─── Mode Controller Class ────────────────────────────────────────────────────

export class EngineeringModeController {
  private state: EngineeringModeState;

  constructor(initialMode: EngineeringMode = 'AUTO') {
    this.state = {
      mode: initialMode,
      correctionLog: [],
      pendingViolations: [],
      lastCalculatedAt: null,
      autoResolutionCount: 0,
      manualOverrideCount: 0,
    };
  }

  // ─── Mode Management ───────────────────────────────────────────────────────

  getMode(): EngineeringMode {
    return this.state.mode;
  }

  setMode(mode: EngineeringMode): void {
    this.state.mode = mode;
  }

  isAuto(): boolean {
    return this.state.mode === 'AUTO';
  }

  // ─── Correction Logging ────────────────────────────────────────────────────

  logCorrection(entry: Omit<CorrectionLogEntry, 'id' | 'timestamp' | 'mode' | 'userAcknowledged'>): CorrectionLogEntry {
    const fullEntry: CorrectionLogEntry = {
      ...entry,
      id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      mode: this.state.mode,
      userAcknowledged: false,
    };
    this.state.correctionLog.push(fullEntry);
    if (entry.autoApplied) {
      this.state.autoResolutionCount++;
    } else {
      this.state.manualOverrideCount++;
    }
    return fullEntry;
  }

  // ─── Auto-Resolution (AUTO mode only) ─────────────────────────────────────

  applyAutoCorrection(
    field: string,
    type: CorrectionType,
    originalValue: string | number,
    resolvedValue: string | number,
    necReference: string,
    reason: string
  ): CorrectionLogEntry {
    if (this.state.mode !== 'AUTO') {
      throw new Error('applyAutoCorrection called in MANUAL mode. Use logManualOverride instead.');
    }
    return this.logCorrection({
      type,
      field,
      originalValue,
      resolvedValue,
      necReference,
      reason,
      autoApplied: true,
    });
  }

  // ─── Manual Override (MANUAL mode) ────────────────────────────────────────

  logManualOverride(
    field: string,
    originalValue: string | number,
    overrideValue: string | number,
    necReference: string,
    userReason: string
  ): CorrectionLogEntry {
    return this.logCorrection({
      type: 'MANUAL_OVERRIDE',
      field,
      originalValue,
      resolvedValue: overrideValue,
      necReference,
      reason: `MANUAL OVERRIDE: ${userReason}`,
      autoApplied: false,
    });
  }

  // ─── Violation Tracking ────────────────────────────────────────────────────

  addViolation(violation: Omit<PendingViolation, 'id'>): void {
    const existing = this.state.pendingViolations.find(v => v.field === violation.field && v.code === violation.code);
    if (!existing) {
      this.state.pendingViolations.push({
        ...violation,
        id: `viol-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      });
    }
  }

  clearViolations(): void {
    this.state.pendingViolations = [];
  }

  clearViolationByField(field: string): void {
    this.state.pendingViolations = this.state.pendingViolations.filter(v => v.field !== field);
  }

  // ─── State Access ──────────────────────────────────────────────────────────

  getState(): Readonly<EngineeringModeState> {
    return { ...this.state };
  }

  getCorrectionLog(): CorrectionLogEntry[] {
    return [...this.state.correctionLog];
  }

  getUnacknowledgedCorrections(): CorrectionLogEntry[] {
    return this.state.correctionLog.filter(e => !e.userAcknowledged);
  }

  acknowledgeCorrection(id: string): void {
    const entry = this.state.correctionLog.find(e => e.id === id);
    if (entry) entry.userAcknowledged = true;
  }

  acknowledgeAll(): void {
    this.state.correctionLog.forEach(e => { e.userAcknowledged = true; });
  }

  getPendingViolations(): PendingViolation[] {
    return [...this.state.pendingViolations];
  }

  getSummary(): {
    mode: EngineeringMode;
    autoResolutions: number;
    manualOverrides: number;
    pendingViolations: number;
    unacknowledgedCorrections: number;
  } {
    return {
      mode: this.state.mode,
      autoResolutions: this.state.autoResolutionCount,
      manualOverrides: this.state.manualOverrideCount,
      pendingViolations: this.state.pendingViolations.length,
      unacknowledgedCorrections: this.getUnacknowledgedCorrections().length,
    };
  }

  // ─── Serialization (for API transport) ────────────────────────────────────

  toJSON(): EngineeringModeState {
    return { ...this.state };
  }

  static fromJSON(state: EngineeringModeState): EngineeringModeController {
    const ctrl = new EngineeringModeController(state.mode);
    ctrl.state = { ...state };
    return ctrl;
  }
}

// ─── Stateless helper: build correction summary for API response ──────────────

export interface AutoResolutionSummary {
  mode: EngineeringMode;
  totalCorrections: number;
  ocpdCorrections: number;
  wireCorrections: number;
  conduitCorrections: number;
  manualOverrides: number;
  entries: CorrectionLogEntry[];
}

export function buildResolutionSummary(
  log: CorrectionLogEntry[],
  mode: EngineeringMode
): AutoResolutionSummary {
  return {
    mode,
    totalCorrections: log.length,
    ocpdCorrections: log.filter(e => e.type.startsWith('OCPD')).length,
    wireCorrections: log.filter(e => e.type.includes('WIRE')).length,
    conduitCorrections: log.filter(e => e.type === 'CONDUIT_UPSIZED').length,
    manualOverrides: log.filter(e => e.type === 'MANUAL_OVERRIDE').length,
    entries: log,
  };
}