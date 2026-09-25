# Lane F — Site Survey / Field App UX

Research date: 2026-09-25. Method: videos downloaded with `python tools/watch.py <id> 0.04 <n>`,
frames read as images and merged with caption transcripts into one timeline before concluding.
Artifacts live at `C:\Users\Ray\Solarpro Claude\tools\watch\<videoId>\`.
Marketing pages were not used as evidence; one vendor help-centre doc is listed separately and
labelled as a doc, not a walkthrough.

## SUMMARY — transferable interaction principles

1. The answer and its proof belong on ONE row. SiteCapture puts a camera icon on every field, so
   "Rafter Sizes = 2 x 6" and the photo that proves it are a single unit. SolarPro splits answers
   (step 3) from photos (step 5), so nothing binds a value to its evidence.
2. The outstanding-required count must be visible from the top screen, per section, at all times
   (`Roof/Array Information  21`). That is the "can I leave yet" instrument.
3. The prompt must travel into the camera. SiteCapture paints the slot name in the viewfinder
   ("Photo: Front of Home (include address number)"), so a photo cannot be mis-filed.
4. Capture-time quality feedback beats post-hoc rejection: Scanifly tells pilots to enable the
   zebra over-exposure warning because an over-exposed region is unusable for reconstruction.
5. Annotation should emit STRUCTURED data. Scanifly's stickers are a vocabulary — `2x6`, `2x8`,
   `24" ON CENTER`, `AC DISCONNECT` — tapped onto the photo, in two colours for existing vs planned.
6. Conditionality shrinks the form and hardens it: answering "subpanel: yes" opens a subpanel photo
   request; "no" never asks. Absence gets asserted, not inferred ("Not Applicable" is a field type).
7. Offline is store-and-forward, not a blocker: sync as you shoot, hold everything when there is no
   signal, flush on reconnect. Nobody makes the crew wait.
8. The survey should feed the designer LIVE — "a designer designing this project as you're recording
   the job site information" — not as a batch handoff after the truck leaves.
9. Required-evidence sets should be regional and versioned (SolarTools ships region survey packages
   every 48h with a badge), which is exactly how an AHJ-driven evidence list should behave.
10. The economic frame, stated by installers themselves: one trip, because the customer is one to two
    hours away, and because a thin survey is what gets the plan set denied at permit.

## LEDGER

| category | product | title | URL/id | pub date | official-or-operator | duration watched | key timestamps | workflow | good behavior | bad behavior | user workaround | SolarPro current behavior | STEAL/ADAPT/REJECT/BACKLOG | RE+ impact | user value | implementation risk | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| field app | SiteCapture (now Aurora Solar) | SiteCapture iOS App Demonstration | n6kYjYKm5bg | 2016-06-07 | operator (reseller/consultant Chris Doyle) | 9:54, 188 caption cues + 30 frames, 3 read | 0:27 sort by distance; 1:02 per-section required counts (Customer 2 / Roof-Array 21 / Electrical 18 / Final Signoff 3); 2:01 photo annotate; 2:18 voice note; 3:08 per-field high-res; 3:56 "I have all these required fields that I still need to complete"; 5:04 offline hold-and-sync; 5:32 PDF + email from phone; 7:01 live to designer; 8:07 conditional subpanel | project list -> status In Progress -> sections -> fields+photos -> signature -> PDF | outstanding-required count per section on the root screen; store-and-forward offline; live sync to web so a designer works while the crew is on site; conditional fields; per-field high-res flag for data plates and bills (OCR); voice note + caption on a photo | 2016-era iOS UI; completed report vanishes from device "for good"; template quality is entirely the customer's problem | crews rely on the section counters as the leave-site check; "measure twice" habit | 6-step wizard with a numbered progress bar; required gating exists but only as a per-step Next lock; no per-section outstanding count anywhere; no offline; no voice note; no annotation | STEAL (required counts, offline queue, live sync) | HIGH | HIGH — turns "am I done" from memory into a number | MED | proposed |
| field app | SiteCapture | SiteCapture Solar PV Site Survey Demonstration | AV6zXNYJAEw | 2016-06-07 | operator | 7:23, 30 frames (8 read), no captions published | 0:46 "Photo: Utility Bill" painted in viewfinder; 1:16 "Photo: Front of Home (include address number)"; 1:40 "Photo: Roof Access Point" + thumbnail filmstrip; 2:34 "Array Location 1"; 3:14 "Array Location 2/3" with upload spinner; 6:34 "Main Service Panel Location"; 6:48 generated PDF with each photo captioned by its prompt | named photo slots, many multi-photo, each opening a camera that carries the slot name | prompt name is in the viewfinder, so mis-filing is structurally impossible; instruction embedded in the label ("include address number"); multi-photo slots with count; background upload while the surveyor keeps shooting; output PDF labels every photo with the prompt that requested it | no visible skip/why-missing affordance in frames; slot list is long and flat | surveyors shoot extra photos into the nearest slot | native file input; label+hint sit above the slot and disappear once the OS camera opens; upload is a blocking per-slot fetch with no background queue | STEAL (in-viewfinder prompt) | HIGH | HIGH — kills mis-categorised evidence at source | LOW | proposed |
| field app | SiteCapture | Sample Site Survey (filled residential survey) | IeQeiWYAf-M | 2016-05-31 | operator | 8:43, 26 frames, 3 read | 0:42 Utility Bill / Utility Provider / Year Home Built / Number of Stories / HOA (Y/N) each with its own camera icon; 3:02 "Rafter Sizes = 2 x 6" and "Rafter Spacing (inches on center) = 16", both with camera icons; 5:31 "Is there a Sub-panel? No"; 5:31 "Main Service Panel Location"; HiR badge in viewfinder | one scrolling form where every question can carry evidence | every answer row has an optional camera — the value and the photo that proves it are one record; rafter SIZE and SPACING are both first-class typed fields; high-res mode is visibly badged in the viewfinder | free-text spacing invites "16" vs "16 in" drift | surveyors photograph the tape measure against the rafter | rafter SPACING exists as a 16/24/other chip; rafter SIZE does not exist anywhere; no per-field camera | STEAL (per-field camera; rafter size field) | HIGH | HIGH — structural review currently has no rafter size input at all | MED | proposed |
| field app | Scanifly | Using Custom Checklist for Site Surveys | P6Ris57llf0 | 2024-01-19 | official | 1:08, 30 cues + 22 frames, 3 read | 0:16 desktop checklist builder; 0:33 mark fields required, whole sections optional; 0:33 builder field types Text/Dropdown/Checkbox/Radio/Media/Time/Date/Not Applicable; 0:46 in-app photo annotation toolbar; 0:53 sticker palette: 18"/20"/24"/32"/48" ON CENTER, 2x4 2x6 2x8 2x10 2x12, AC DISCONNECT, BATTERY/STORAGE, in black and red | customer authors the form on desktop; crew fills it on mobile and annotates | annotation emits a controlled vocabulary rather than freehand; two colours distinguish existing vs planned equipment; sections can be optional because "every site has different scopes"; "Not Applicable" is a first-class field type | the whole evidence spec is the customer's to author — Scanifly ships no opinion about what engineering needs | installers copy a template from their engineer | evidence categories, a 12-item engineering requirement registry and a 9-zone capture plan all exist server-side; none is authorable and none is visible on the phone | STEAL (sticker vocabulary) / ADAPT (required is derived, not authored) | HIGH | HIGH — a tapped `2x6` sticker is machine-readable structural evidence | MED | proposed |
| capture doctrine | Scanifly | Data Capture with a DJI Mavic Series Drone | 8V2e-yQvo0U | 2021-05-17 | official | 5:57, 207 cues | 2:29 enable over-exposure zebra warning + crosshairs; 2:45 "too bright to be usable in ... reconstruction"; 2:50 interval photo 3-5 s; 3:18 orbit the site TWICE; 3:41 POI radius until whole site incl. facade in frame; 3:51 2-5 mph; 4:19 96 photos context flight; 5:05 75 photos detail flight; 5:38 "fly two flights at each site minimum" | context orbit then detail orbit, both via DJI GO 4 POI + interval | an explicit, falsifiable capture doctrine (two orbits, high overlap, ~176 images); quality feedback at capture time tied to downstream reconstruction usability | the doctrine lives in a VIDEO and in DJI's app — Scanifly's own software enforces none of it; a crew that flies one orbit finds out later | crews memorise the two-orbit rule or re-fly | SolarPro has no drone capture path and no capture-time quality check of any kind | ADAPT (capture-time usability check) | MED | MED | MED | backlog |
| installer doctrine | n/a (Green Home Systems) | Solar Survey Guide - How to Use a Drone | CqKDvaHkiO0 | 2022-09-22 | operator (real installer, real house) | 3:43, 91 cues | 0:08 front-of-house photo to verify we are designing the RIGHT roof against satellite; 0:19 "roof, structural and electrical"; 0:27 "an accurate plan set that doesn't get denied during the permit process"; 0:38 360 of every side to locate MSP and find clear equipment areas; 0:55 stand 8-15 ft back from MSP to show obstructions; 1:03 measure open space either side of MSP (inverters go there, goes on the diagram); 1:31 busbar rating photo — "one of the biggest things we need", must be clear; 1:52 do NOT open the utility side; 1:57 dead plate off -> breakers + service wire size; 2:11 subpanel, same set; 2:25 attic: measure and photograph trusses/rafters, spacing usually 24" OC, rafter size 2x4/2x6; 2:53 fallbacks if no attic — roof overhang outside, or exposed beams inside; 3:10 drone 360, 6-10 photos; 3:22 trees / shadow sources | roof -> structural -> electrical, walked in order | ties every photo to a downstream consumer and finally to permit denial; per-photo standoff distance; an explicit safety prohibition; explicit FALLBACK paths when the attic is inaccessible; "when in doubt take more pictures" | all of it is tribal knowledge in a YouTube video; nothing enforces it | crews watch this video during onboarding | no busbar field, no dead-front-off slot, no subpanel slot, no MSP clearance measurement, no rafter size, no attic-inaccessible fallback, no standoff guidance | STEAL (fallback paths, standoff hints) | HIGH | HIGH — this is the actual list SolarPro must guarantee | MED | proposed |
| training | Interplay Learning | Solar Site Assessment of Electrical | X_9r70-xhY0 | 2018-06-11 | official training (simulation) | 5:37, 141 cues | 0:14 "information ... that cannot be gathered from visual observation"; 0:51 service panel brand from the INSIDE label (GE/Murray/Square D/Schneider/Siemens/Cutler-Hammer/other); 1:32 busbar rating is critical, buried in the panel label; 1:46 choices 100/125/150/175/200/225/larger; 2:07 "so that the system designers can know the maximum solar breaker"; 2:16 space for the solar breaker; 2:28 code requires the PV breaker at the OPPOSITE end of the bus from the main; 3:04 answer choices — two ADJACENT slots for a 2-pole 240 V / two NON-adjacent singles / no empty spaces at all (crew must bring tandems); 4:03 CENTER-FED yes/no, because some AHJs restrict PV on centre-fed panels; 4:48 device serial / ID | a guided electrical assessment where each question carries an "i" explaining why and where to find it | every question states its downstream use and its code basis; the breaker-space question is asked as a STRUCTURE (adjacency + position relative to the main), not as a count; centre-fed is captured because the AHJ may refuse the design | simulation, not a shipping app | assessors carry a paper clipboard | panelRating is captured but BUSBAR rating is not; availableBreakerSlots is a count ('0','1-2','3-4','5+') which cannot answer adjacency or position; centre-fed does not exist; no per-question "why we need this" | STEAL (busbar, adjacency, centre-fed) | HIGH | HIGH — directly feeds the 705.12(B) calculation SolarPro asserts but never computes | LOW | proposed |
| installer doctrine | GreenLancer | How to Perform a Thorough Solar Site Assessment | B9E8LvUW5F8 | 2020-04-01 | operator (former installer + former designer) | 3:31, 106 cues | 0:19 "grab all the proper information on ONE trip"; 0:27 "this client could be an hour two hours even more than that away"; 0:46 "the site assessment is probably the most important thing that the engineer or designer of record is going to be able to use"; 1:17 shade Nearmap/Google Earth missed; 1:21 roof obstructions (a vent you did not see); 1:28 roof PITCH is not reliable from aerial and drives crew speed and safety in the bid; 1:51 roof condition — advise re-roof BEFORE solar; 2:13 licensed professional removes the service panel cover; 2:28 "take pictures ... so that you're not going back out or asking the client to take pictures — that's our job as the installer"; 2:43 narrated VIDEO as evidence, e.g. "it's 3:00 pm and there's shade on this portion of the roof"; 3:03 one printable form so you don't make multiple trips | assess outside, then inside, photograph everything | states the re-visit economics explicitly; names the aerial-vs-ground divergences that force a site visit at all; narrated video with a stated TIME as shade evidence; a norm that asking the customer to re-photograph is a failure | the deliverable is a PDF form — zero enforcement | print the form | SolarPro prefills roof material/pitch/condition from satellite with an accept/override and a struck-through provenance line (genuinely good, keep it); no video capture, no time-stamped shade evidence | ADAPT (narrated video note) | MED | MED | MED | backlog |
| field app | SolarTools | Video 2 — Overview of Solar Survey Tool V2 | NhZ10Xw6n_E | (SolarToolsApp) | official | 4:35, 121 cues | 0:21 region-specific survey packages refreshed every 48 h; 0:30 red badge "1" over Settings when a new package exists; 0:41 parent / intermediate / subcategory hierarchy; 1:08 parent+intermediate FIXED, only subcategories addable; 1:21 field types incl. "Audio Photo notes"; 2:06 closing the survey by accident auto-timestamps and files it under "incomplete surveys"; 2:23 four fixed parents — customer data / building info / application-specific / additional data | a versioned regional question set, navigated as a category tree | the required question set is delivered and versioned by REGION rather than hardcoded; the spine is fixed so extensions cannot corrupt the schema; incomplete surveys are a first-class, named, timestamped folder — never silently lost | in-app banner advertisements inside a professional survey tool | none needed | survey steps are a hardcoded 6-item const; REQUIRED_PHOTO_CATEGORIES is a hardcoded 5-item array; a draft lives only in this browser's localStorage and is cleared on submit | ADAPT (AHJ-versioned required set) / REJECT (ads) | HIGH | MED | HIGH | backlog |
| doc (not a walkthrough) | Scanifly | Checklists — Help Center | help.scanifly.com/checklists | n/a | official doc | read, not watched — listed for completeness | n/a | n/a | Submit is gated until every required field is filled; a button bottom-right reveals per-section required-field counts; checklist updates appear in the project in real time; PDF export | doc does not state offline behaviour | n/a | n/a | supporting evidence only | n/a | n/a | n/a | read |
| failed fetch | Wattmonk | Wattmonk Solar Site Survey Application Tutorial | OjRhDVwLsBs | n/a | n/a | 0:00 — `ERROR: [youtube] OjRhDVwLsBs: This video is not available` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | NOT WATCHED |
| failed fetch | SiteCapture | SiteCapture - Dynamic Fields | WcWCG7aS0h4 | n/a | n/a | 0:00 — `ERROR: [youtube] WcWCG7aS0h4: This video is not available` | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | NOT WATCHED |

## SOLARPRO — what the code actually does today

Read from source, not from docs.

**The field app** — `app/survey/[token]/page.tsx` (526 lines), `components/survey/*` (3,747 lines).
A 6-step wizard (`SURVEY_STEPS` in `lib/survey/v2/types.ts`): Site Overview, Roof & Mounting,
Electrical Service, Obstructions & Layout (optional), Photos, Review & Submit. `SurveyShell.tsx`
renders a numbered progress bar and a "Saved HH:MM" indicator.

- **It does block.** `canAdvanceStep()` (page.tsx:64) hard-locks Next per step, and step 5 requires
  all of `REQUIRED_PHOTO_CATEGORIES`. `StepReview.tsx:148` also prints an amber
  `Missing required photos: ...` line plus hazard warnings (e.g. Zinsco/FPE panel brands).
  This is genuinely better than "collect photos and hope".
- **Five required photo slots**, hardcoded in `lib/survey/v2/types.ts`: `main_panel_open`,
  `main_panel_closed`, `meter`, `roof_overview`, `service_entrance`. Four optional:
  `roof_detail`, `attic_access`, `obstruction`, `additional`. Each has a one-line hint
  (`PhotoSlot.tsx`), no example image.
- **Provenance is good on capture.** `StepPhotos.tsx:37` samples device GPS at capture time in
  parallel with the upload and fails soft to null, with a comment explaining that browser
  file-input photos carry no EXIF GPS. Every photo carries `capturedAt`, `category`, `gps`; the
  payload carries `inspectorName` and `surveyId`.
- **Satellite prefill with override** — `StepRoof.tsx` shows "Detected from satellite:" / "Photo
  suggested:" with an accept control and a struck-through superseded value. Keep this; it is the
  single best interaction in the field app and it is better than anything in the corpus.

### The five real gaps

1. **`fieldOrchestration.ts` is invisible to the field.** `lib/survey/evidence/fieldOrchestration.ts`
   is a movement-ordered capture plan — 9 movement zones (`exterior_arrival`,
   `utility_service_area`, `main_service_equipment`, `routing_path`, `attic_structural_area`,
   `roof_area`, ...), each with `technicianInstruction`, per-item `priority`
   (`required`/`conditional`/`optional`), `canonicalCategory`, `engineeringUsage` and
   `minimizesBacktrackingBecause`. Its only consumers are
   `app/admin/engineering-intelligence/project/[id]/page.tsx` and its own test. Nothing under
   `app/survey/` or `components/survey/` imports anything from `lib/survey/evidence/`. **SolarPro
   already wrote the capture plan and never showed it to the person on the roof.**
2. **Three disconnected taxonomies.** The field app knows 9 `PhotoCategory` values; the server
   knows ~25 `SurveyEvidenceCategory` values (`categoryRegistry.ts`); the readiness engine knows 12
   `EngineeringRequirementId` values (`engineeringRequirements.ts`) with `readinessImpact` and
   `missingSeverity`. Three requirements are `blocking` (`main_service_panel`, `utility_meter`,
   `roof_overview`) and two are `review_required` (`attic_access`, `structural_access`) — but
   `attic_access` is **optional** in the field app, and `rafters` has **no field slot at all**.
   So a crew can legitimately finish 5/5 and drive away while structural review is already flagged.
3. **The verdict arrives after the truck has left.** The requirement evaluation UI is a 3,829-line
   office page at `app/projects/[id]/survey/[surveyId]/page.tsx` — "Engineering Requirement
   Registry", satisfied / partial / missing / blocked counts, `requiredMissing` lists, provenance
   and traceability. Excellent, and unreachable from the phone.
4. **There is no offline path.** A repo-wide grep for `navigator.onLine`, `serviceWorker`,
   `indexedDB` and `offline` returns nothing in the survey surfaces. `StepPhotos.handleCapture`
   does a bare `fetch('/api/survey/upload-photo')` per photo; on failure it writes a red string
   into the slot and returns. The draft in `localStorage` holds only the returned URL, never the
   file, so **a photo taken in a dead spot is gone**. `handleSubmit` is a single POST with no
   retry and no queue; `clearDraft()` runs only on success.
5. **Missing engineering-critical fields.** No busbar rating (only `panelRating`); no rafter SIZE
   (only `rafterSpacing` 16/24/other); no rafter span; no centre-fed flag; no MSP clearance
   measurement; no subpanel photo slot; `availableBreakerSlots` is a count
   (`'0'|'1-2'|'3-4'|'5+'`) which cannot express "two adjacent slots at the opposite end from the
   main". No annotation, no voice note, no video.

Related prior work: `lib/fieldMeasurement/*` and `RouteMeasurementPanel` (WS-5) are a separate,
office-side, conduit-run measurement system with a REPORTED_UNVERIFIED -> VERIFIED lifecycle
(see memory `ws5-field-measurement-reachability`). Its "recording is not verification" ruling is
the right precedent for survey evidence too, and migration 118 is still unrun.

## TOP CANDIDATES FOR SOLARPRO

**1. Run the engineering requirement registry ON DEVICE, before submit.**
What to build: expose `buildEngineeringRequirementEvaluation` through a
`GET /api/survey/readiness?token=...` that the field app calls on entering step 6, and render
blocking / review_required / informational as three bands on the review screen, each naming the
capture item and the zone to walk back to.
Why it beats what we have: the same verdict exists today but only at
`/projects/[id]/survey/[surveyId]`, which the crew reads after driving home. This is the whole
mission — "a crew must not be able to leave the site missing something engineering needs" — and
the engine is already written and tested.
Bounded: one route + one review-screen section. No schema change.
Proof: a survey with 5/5 required photos but no attic/rafter evidence must show
`structural_access: review required` on the phone, and the same survey must show the identical
verdict on the office page.

**2. Per-section outstanding-required counts (SiteCapture's orange numbers).**
What to build: a count of unsatisfied required items beside each of the 6 step labels in
`SurveyShell`'s progress strip, derived from `canAdvanceStep` plus the registry, not from a second
hardcoded list.
Why it beats what we have: today the crew learns a step is incomplete only by trying to leave it.
A number on the spine answers "am I done" without navigation.
Bounded: `SurveyShell.tsx` + one selector.
Proof: the four numbers sum to zero exactly when Submit enables.

**3. Offline capture queue.**
What to build: write the File to IndexedDB at capture time with its category, GPS and timestamp;
render the slot as captured-pending-upload; drain the queue on `online` and before submit; block
submit while anything is unflushed, with a plain "3 photos still to upload" line.
Why it beats what we have: a dead spot currently destroys the photo. Every competitor in the
corpus holds and forwards; SiteCapture's operator states it flatly at 5:04.
Bounded: one hook plus a status line; nothing server-side changes.
Proof: kill the network in devtools, capture all five required photos, restore the network, and
submit with all five present.

**4. The missing engineering-critical electrical and structural fields.**
What to build: busbar rating (100/125/150/175/200/225/other); breaker space as a structure —
adjacent-pair / non-adjacent-singles / none — plus position relative to the main; centre-fed
yes/no; rafter SIZE (2x4…2x12); MSP side clearances.
Why it beats what we have: `availableBreakerSlots` as a count cannot answer the question
NEC 705.12(B) actually asks, and busbar is the input SolarPro's readiness column claims a PASS
for without ever computing it (see memory `claude-can-watch-video` — Solargraf prints the
120 % calculation on the drawing). Centre-fed is an AHJ question, and AHJ is the wedge.
Bounded: additive fields on `SurveyElectricalService` / `SurveyRoofConditions` + the two step
components; existing payloads stay valid as nulls.
Proof: a Braidon-shaped survey with busbar 200 A and a 35 A PV breaker reaches the permit snapshot
as a computed 705.12(B) result rather than an asserted one.

**5. Per-field evidence camera, and the prompt in the viewfinder.**
What to build: a small camera affordance on each answer row that attaches a photo to THAT field;
and a capture overlay that keeps the slot label and hint on screen during capture.
Why it beats what we have: it binds a claimed value to its proof, which is what makes a survey
defensible rather than a photo album, and it removes mis-filing. SiteCapture does both; the
"Rafter Sizes 2 x 6 [camera]" row is the model.
Bounded: extend `SurveyPhoto` with an optional `fieldKey`; a shared `FieldCamera` component.
Risk: the browser hands off to the OS camera, so an in-viewfinder overlay needs `getUserMedia`
rather than a file input — do the label-persistent capture sheet first and treat the true overlay
as a follow-up.
Proof: the office page can show, for `rafterSpacing = 16`, the photo that was taken to justify it.

**6. Structural sticker vocabulary on the attic photo.**
What to build: Scanifly-style tappable badges (`2x4`…`2x12`, `16"/24" ON CENTER`) placed on the
attic/rafter photo, each emitting a structured annotation record, not a drawing.
Why it beats what we have: it captures rafter size and spacing at the pixel where they were
observed, and it is faster than a dropdown for a person on a ladder.
Bounded: fixed vocabulary, no freehand, one overlay component.
Proof: the annotation round-trips into `project_physical_data` and the structural sheet cites it.

## EXIT CRITERIA STATUS

1. **>=2 materially relevant products — MET.** SiteCapture/Aurora (3 videos), Scanifly (2),
   SolarTools (1), plus two installer/training doctrines (Green Home Systems, GreenLancer,
   Interplay).
2. **>=1 official/training source — MET.** Scanifly `P6Ris57llf0` and `8V2e-yQvo0U` (vendor),
   Interplay `X_9r70-xhY0` (training), SolarTools `NhZ10Xw6n_E` (vendor).
3. **>=1 real user/operator source — MET.** Green Home Systems `CqKDvaHkiO0` is an installer
   narrating a real house; GreenLancer `B9E8LvUW5F8` is a former installer and former designer;
   Chris Doyle's three SiteCapture videos are operator-made, not vendor-published.
4. **Core workflow end-to-end — MET.** `n6kYjYKm5bg` covers project pick -> status -> sections ->
   fields+photos -> annotation -> voice note -> signature -> PDF -> email -> live web sync, and
   states the offline behaviour. `IeQeiWYAf-M` shows the same flow filled in.
5. **Findings repeating — PARTIALLY MET.** Required-field gating, per-section counts, photo-as-
   evidence-for-a-field, and the one-trip economic frame each recur in three or more independent
   sources. But the specific questions I most want to see repeated — what a product does when a
   required photo is SKIPPED, and what it does when the network dies mid-capture — rest on a
   single operator statement (5:04 of `n6kYjYKm5bg`) and one vendor doc. Not saturated.
6. **Opportunities triaged — MET.** Every ledger row carries a verdict; six candidates are scoped
   with a proof.
7. **SolarPro equivalent audited — MET.** Read from source; five concrete gaps named with file and
   line references, including the orchestration model that no field surface imports.
8. **Candidates shipped or backlogged — NOT MET.** All six are proposed only. Nothing has been
   built, no chip has been filed, and this lane wrote no product code by instruction.

**Saturation is NOT declared.** Criteria 5 and 8 do not hold. Two fetches failed
(`OjRhDVwLsBs`, `WcWCG7aS0h4`) and both were skip/validation-behaviour sources, which is exactly
the evidence thinnest here. The next pass should target: (a) a product's behaviour when a required
photo is deliberately skipped, (b) offline capture demonstrated rather than described, and (c) the
Scanifly mobile app's own end-to-end survey, which its YouTube channel does not appear to publish.
