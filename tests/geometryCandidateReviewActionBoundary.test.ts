import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lifecycleSource = readFileSync('lib/assistedEvidenceSources/geometryCandidateReviewLifecycle.ts', 'utf8');

describe('geometry candidate review action boundary', () => {
  it('keeps the action helper in assisted evidence DTO-only scope without database or downstream authority calls', () => {
    expect(lifecycleSource).toContain('submitGeometryCandidateReviewAction');
    expect(lifecycleSource).toContain('accept_for_review_projection');
    expect(lifecycleSource).toContain('deterministic_dto_only_v1');
    expect(lifecycleSource).not.toMatch(/from ['"][^'"]*(?:lib\/cad|lib\/drafting|lib\/plan-set|lib\/engineering|lib\/engineeringIntelligence|lib\/system\/conduitRouting|lib\/bom|lib\/roofGeometry|lib\/panelLayout|lib\/placementEngine|lib\/survey\/evidence|lib\/db\/surveys)/);
    expect(lifecycleSource).not.toMatch(/\b(?:INSERT INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
    expect(lifecycleSource).not.toMatch(/\.(?:insert|upsert|update|delete)\s*\(/);
    expect(lifecycleSource).not.toMatch(/\b(?:generateCADLayout|buildCADFromSurvey|calcFireSetbacks|routeConduit|evaluateEngineeringRequirements|buildCADReadinessMetadata|buildEngineeringRecommendations|buildEngineeringWorkflowOrchestration)\s*\(/);
  });
});
