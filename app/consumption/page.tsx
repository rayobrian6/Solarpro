/**
 * app/consumption/page.tsx
 *
 * Aurora parity: the "Consumption" sub-view of the 3D design surface.
 * Replaces the design canvas with a full-page utility-info form.
 *
 * Renders:
 *   [DesignSurfaceSidebar (220px)] | [ConsumptionForm (max-w-3xl)]
 *
 * The form matches the layout in aurora_frames/frame_0050.jpg — see
 * DESIGN.md in this folder for the full spec.
 */

import React from 'react';
import DesignSurfaceSidebar from '@/components/consumption/DesignSurfaceSidebar';
import ConsumptionForm from '@/components/consumption/ConsumptionForm';

export const metadata = {
  title: 'Consumption Profile — SolarPro',
  description: 'Configure utility, rate, and location for financial simulations',
};

export default function ConsumptionPage() {
  return (
    <div
      className="min-h-screen flex bg-slate-950 text-slate-100"
      data-testid="consumption-page"
    >
      <DesignSurfaceSidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <ConsumptionForm />
      </main>
    </div>
  );
}
