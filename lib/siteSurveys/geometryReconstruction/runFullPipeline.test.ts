import { describe, expect, it } from 'vitest';

import { getGeometryPipelineTimeoutMs } from './runFullPipeline';

describe('geometry pipeline timeout configuration', () => {
  it('keeps inline fallback execution under the Vercel timeout by default', () => {
    expect(getGeometryPipelineTimeoutMs({})).toBe(270_000);
  });

  it('uses the longer Render background worker timeout', () => {
    expect(getGeometryPipelineTimeoutMs({ GEOMETRY_RECONSTRUCTION_WORKER: 'true' })).toBe(900_000);
    expect(getGeometryPipelineTimeoutMs({ RENDER_SERVICE_NAME: 'geometry-reconstruction-worker' })).toBe(900_000);
  });

  it('allows an explicit full-pipeline timeout override', () => {
    expect(getGeometryPipelineTimeoutMs({
      GEOMETRY_RECONSTRUCTION_WORKER: 'true',
      GEOMETRY_PIPELINE_TIMEOUT_MS: '1200000',
    })).toBe(1_200_000);
  });
});
