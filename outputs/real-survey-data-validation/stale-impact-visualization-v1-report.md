# Stale Impact Visualization v1 Report

## Scope
This report documents Stale Impact Visualization v1 for canonical evidence row hydration and Engineering Intelligence Workspace UI.

## Row-level stale impact
Canonical evidence rows now include stale impacted state ids, stale impact reasons from invalidation events, and linked regeneration candidate plan ids. This is metadata visualization only and does not execute regeneration.

## Invalidation chain visualization
The Stale-State / Invalidation Workspace now displays stale output counts, invalidation chain counts, preserved output counts, regeneration scope counts, current stale outputs, preserved outputs, regeneration candidates, no-autonomous-action guardrails, and invalidation chain rows with triggering evidence, triggering requirements, triggering decisions, and downstream impacted states.

## Regeneration boundary
The visualization lists regeneration candidates and preserved outputs but does not trigger autonomous regeneration. Operator-controlled regeneration remains required.

## Deterministic behavior
Stale impacts are derived from `EngineeringInvalidationResult.invalidationEvents`, latest snapshot state references, persistent graph linkage, and selective regeneration plans. No AI copilot behavior, computer vision, OCR, image-byte inspection, autonomous CAD generation, or autonomous regeneration behavior was introduced.
