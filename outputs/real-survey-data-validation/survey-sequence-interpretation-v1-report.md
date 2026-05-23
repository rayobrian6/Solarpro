# Survey Sequence Interpretation V1 Report

## Interpretation Method

Survey sequence reconstruction uses deterministic metadata only. The sequence starts from canonical manifest evidence rows and derives movement order from capture timestamp, upload timestamp fallback from survey payload/file metadata, filename ordering, category ordering, and evidence id tie-breaks. No semantic scene inference is used.

## Movement Segments

Segments are split at deterministic breakpoints. Breakpoints are emitted for category cluster transitions, duplicate timestamp ties, and timestamp gaps. Segment metadata includes dominant cluster type, dominant categories, continuity confidence, boundary reasons, transition reasons, and probable movement context. The word probable is limited to metadata grouping context and is not treated as engineering truth.

## UI Surface

The project Engineering Intelligence page now renders ordered traversal rows, movement segments, evidence clusters, photo continuity chains, sequence gaps, grouped roof-side candidates, grouped utility-side evidence, grouped electrical-side evidence, detached/trench candidate groups, and metadata completeness scores.

## Blocked and Missing States

When no canonical manifest exists, the model returns `source: not_loaded` and empty traversal/cluster arrays. It does not synthesize movement, perimeter traversal, roof side continuity, utility continuity, electrical continuity, detached-structure continuity, or trench-path continuity.
