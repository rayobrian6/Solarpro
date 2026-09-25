# Competitor failure hunt — what operators actually fight

**Round 4, 2026-09-25.** This page exists to close the one gap every one of the
eleven research lanes recorded: the corpus was heavy on vendor demos (which show
products working) and thin on operators fighting them.

**Method.** The previous pass tried only the routes that failed (reddit.com,
vendor help centres). This pass used different routes: YouTube **comments** on
the walkthrough videos already in the corpus, 1–3 star reviews on primary review
platforms, FTC/BBB/consumer-complaint records, and a solar trade forum.

**What was actually collected**

| Route | Result |
|---|---|
| YouTube comments via `yt-dlp --write-comments` | **292 comments** across 57 videos. Most vendor videos have comments **disabled or empty** — 48 of 57 returned zero. 9 videos carried real practitioner comments |
| Capterra (US + SG mirrors) | Primary reviews read for Aurora and Solargraf, including full 1-star Cons |
| Software Advice (Gartner network) | Solargraf reviews readable where Capterra US truncated |
| Trustpilot | Aurora, Enerflo, Thumbtack, Angi Leads/HomeAdvisor-Pro |
| FTC | Administrative complaint + final order against HomeAdvisor/Angi |
| BBB | Angi and CraftJack complaint counts |
| PissedConsumer | CraftJack contractor complaints, verbatim |
| solarpaneltalk.com | One genuine installer thread on automated roof design |

**Source-type discipline.** Every row below is labelled. A large share of what a
search engine returns for "X review" is written by a *rival vendor* (SurgePV,
Qbits, Heaven Green Energy, Sunbase, Scoop, SPOTIO all sell competing products).
Those are labelled **SEO/rival blog** and are **not counted** as operator
evidence anywhere in this document, no matter how quotable.

---

## 1. THE TOP 10 THINGS USERS FIGHT

Ranked by how often and how bitterly the complaint recurs. "Independent sources"
counts **distinct people or institutions** — the same commenter appearing on two
videos counts **once**, and rival-vendor blogs count **zero**.

### 1. Paying for leads that were never real — **15+ independent sources, 4 institutions**

The single best-evidenced complaint in the entire corpus, and the only one with a
federal enforcement action behind it.

- **FTC administrative complaint and final order** against HomeAdvisor/Angi.
  HomeAdvisor "represent that service providers only will receive leads matching
  the types of services they provide and their preferred geographic area, many of
  them do not", and "often tells service providers that its leads result in jobs
  at rates much higher than it can substantiate". Order: up to **$7.2 million**;
  over **$3 million refunded to 110,000+ home-service businesses**.
  [FTC 2022 complaint](https://www.ftc.gov/news-events/news/press-releases/2022/03/ftc-charges-homeadvisor-inc-cheating-businesses-including-small-businesses-seeking-leads-home) ·
  [FTC 2023 order](https://www.ftc.gov/news-events/news/press-releases/2023/01/ftc-order-requires-homeadvisor-pay-72-million-stop-deceptively-marketing-its-leads-home)
- **Angi Leads / HomeAdvisor Pro on Trustpilot: 1.9 / 5 across 37,260 reviews.**
  Lynn (2026-09-01): *"After spending more than $5,000 over approximately one
  year, we have not received a single lead that I would consider legitimate."*
  Rich (2026-09-06): *"39 'leads' total and only 3 were real people."*
  [ca.trustpilot.com/review/homeadvisorpros.com](https://ca.trustpilot.com/review/homeadvisorpros.com)
- **Thumbtack on Trustpilot**, 6 named pros. William Sternberg (2026-09-18):
  *"they charge for unusable leads. For example outside my clearly stated service
  area."* Mariya Ten (2026-09-13): *"Thumbtack continued charging for leads—even
  when customers never responded."*
  [trustpilot.com/review/www.thumbtack.com](https://www.trustpilot.com/review/www.thumbtack.com)
- **CraftJack on PissedConsumer**, 9 named contractors. Donavyn Egl (2023-08-04):
  *"They charge you regardless if the lead is a good fit... you dont get the
  option to except or not, they charge regardless."* Renato D (2018-08-06): leads
  were *"Google Voice (VoIP), a free service scammers use"*.
  [craftjack.pissedconsumer.com](https://craftjack.pissedconsumer.com/review.html)
- **BBB**: Angi, **1,803 complaints closed in 3 years**.
  [BBB Angi](https://www.bbb.org/us/in/indianapolis/profile/contractor-referral/angi-0382-3041007/complaints)

The bitterness here is an order of magnitude above anything in the design-tool
lanes. Contractors use the words *scam*, *stealing* and *criminals*.

### 2. Placing and manipulating panels/geometry is fought, not used — **6 independent sources, 4 products**

Every one of these is a practitioner asking, in public, how to do something the
product cannot do.

- OpenSolar, `wsB6VRCWerY`, @Billetus (**3 likes**): *"Placing panels with Open
  solar is an AWFUL experience :("*
- OpenSolar, `wsB6VRCWerY`, @paulmas1690 (2 likes): *"The inverters I use are a
  pain in the butt to add and wire while doing a proposal. This is a great tool
  but not user friendly"*
- Solargraf, `Z2GE6m8jitw`, @jakobspeksnijder8847: *"you just want to rotate the
  whole panel set up. I know you can move it but I do not see an option to rotate
  it a couple of degrees so it better lines up with the roof line"*
- HelioScope, `D4fHHMeBDDU`, @Rivera2000: *"How can we merge the 2 edges of the
  different roofs?? I can0t find that anywhere please help!!"*
- HelioScope, `D4fHHMeBDDU`, @Alex-ms8mb: *"How do I rotate a copy pasted field
  segment?"*
- HelioScope, `UTgre4il4Fo`, @swongstandard8011 on curved roofs: *"Nope. you just
  have to make straight lines that looks like a curve."*
- Aurora, `KxoclvoNc8c`, @bhupendersingh6334: *"Is there any way to move whole
  house in aurora."*

### 3. The auto-model is confidently wrong, and correcting it is worse than starting over — **4 independent sources**

- **Solargraf**, Jackson C., Sales Rep, Construction, 1★, 2025-05-29 (Capterra):
  *"This is the most frustrating software I've ever used. Any properties missing
  their data, the 3D modeling tool gets easily confused and creates monstrosities
  of designs. A huge bear to get to work accurately unless designing simple homes
  in well documented areas. New construction? Good luck! Incredibly frustrating.
  Very hard to customize, data is often wrong, unreliable and crashed often,
  overall a terrible software."*
  [capterra.com.sg/reviews/1006132/solargraf](https://www.capterra.com.sg/reviews/1006132/solargraf)
- **Aurora**, Waleed A., 2019-10-23 (Capterra): *"Sometimes it doesn't detect
  accurate pitch."*
- **Aurora**, `6c7eYT49vl0` (the 93-min SmartRoof Workshop), @Yorider-UK: *"i have
  watched your all videos .but I am unable to adjust lidar according to roof faces
  & dormers."* — a user who consumed the vendor's **entire** training library and
  still cannot perform the core correction.
- **solarpaneltalk.com**, @solarix, 2021-03-10 — a working installer:
  *"The aerial imagery is not good enough to accurately place all the roof
  obstructions like plumbing vents"*; *"Virtually every time we do a pre-planned
  array, we have to modify the design because a vent is located a couple inches
  off"*; *"You just never know where the exact placement of an array is going to
  be until you get on the roof."*
  [thread](https://www.solarpaneltalk.com/forum/solar/the-pros-and-cons-of-solar-energy/423913-automated-solar-roof-design)

### 4. Numbers you cannot trust, so you run a second tool to check — **3 independent sources**

- **Solargraf**, verified CEO, Electrical Mfg, 1★, 2020-11-28: *"The calculations
  are way off. We use SunPower Eddie to compare and Solargraf was always 10%-20%
  off. The permit pack is ridiculous."*
- **Solargraf**, Mark, Renewables & Environment, 2019-12-24: *"Would love the
  ability to model shading from trees or chimneys."*
- **OpenSolar**, `wsB6VRCWerY`, @loiseaucarine8260: *"calculations are off and
  support will not help."*
- *(Not counted: SurgePV — an **SEO/rival blog** — quotes a G2 review reading
  "Shading software is absolute garbage and entirely inaccurate". **G2 returns 403
  to the fetchers, so this could not be verified at source.** It is recorded here
  as second-hand and excluded from the count.)*

### 5. The margin lives in a spreadsheet outside the product — **4 independent sources**

The clearest "what do you keep a spreadsheet for" finding in the hunt.

- **Aurora**, `aBy9AeiUPf0`, @tethysenergy: *"I can't beleive there is no
  functionailty to properly price up solar & battery components using this
  software. Any software like this should allow installers to create a list of
  items with prices that can then be marked up ready for the proposal... **There's
  no way for solar installers to see their profit margins using this software.**
  The deisign aspect is really very good, however this is a 'half product'."*
- **OpenSolar**, `A0NKDNC4pcc`, @ElectricalInnovations (a UK installer, on their
  own video, answering a viewer asking how they set up quote pricing): *"Weve
  moved on from this a bit now and **use a separate pricing spreadsheet and just
  add the manual total into Open Solar**."*
- **Aurora**, Wouter Z., Solar Design Engineer, 1★, 2024-09-12 (Capterra): *"The
  proposal and financial calculations functionality is very limited. Auroa solar
  is essentially made for nothing more that a house with a grid tie inverter."*
- **OpenSolar**, `wsB6VRCWerY`, @sanjuansteve: *"It's very much like the Excel
  spreadsheet proposal template I created back in 2007."*

### 6. Support is unreachable exactly when you are blocked — **5 independent sources, 3 products**

- **Aurora**, CU (CA), 3★ Trustpilot, 2025-09-03: *"Customer Service is non
  existent. When there is a billing issue, expect to wait 2 weeks with no
  responses. and endless trouble tickets being created, that wind up getting no
  responses. **Have a backup design tool just in case, or your business will be at
  a standstill.**"* [trustpilot.com/review/aurorasolar.com](https://www.trustpilot.com/review/aurorasolar.com)
- **Solargraf**, verified CEO, 1★, 2020-11-28: *"There is no way to contact the
  design team except through the app which takes days."*
- **Solargraf**, Paul, Design, 4★, 2024-09-06: *"The Waite time for customer
  support is now longer."*
- **OpenSolar**, `wsB6VRCWerY`, @loiseaucarine8260: *"support will not help... **No
  were does it show how to fix it and no assistance bot.**"*
- **OpenSolar**, `P8JACuy96V8`, @persianchris2451: *"Just the fact that nobody here
  has had their questions answered in 2 years tells me enough."*

### 7. Raw internal errors reach the user with no recovery path — **1 independent source, but decisive**

Only one source, kept high because of what it *proves* rather than how often it
recurs.

- **OpenSolar**, `wsB6VRCWerY`, @loiseaucarine8260 pasted the error they were
  given: *"Calculation error. design: 32 Panels: **'>' not supported between
  instances of 'float' and 'NoneType'**. No were does it show how to fix it and no
  assistance bot."*

That is a raw Python `TypeError` rendered as a user-facing message. The user
cannot act on it, and the same comment says support did not help. This is the
purest example in the corpus of a product handing its own internal failure to the
operator as their problem.

### 8. 3D is slow, memory-hungry, and unusable on the device in the field — **4 independent sources**

- **Aurora**, Wasay M., 4★, 2019-08-06: *"Consumes a lot of memory. Auto save
  option isn't available. Sometimes stuck in between."*
- **Aurora**, Waleed A., 2019-10-23: *"Working continuously on a specific site
  sometimes consumes too much memory."*
- **Aurora**, Faheem S., 2019-11-06: *"it requires high system configuration, With
  low system configuration it performs very slow."*
- **Solargraf**, James M., Sales Director, 3★, 2024-09-06: *"Glitchy 3-d bogs down
  my computers and **is difficult to set points on a tablet**."*

The tablet clause matters more than the rest: that is the device on the roof.

### 9. Work is lost — no autosave, and a second login clobbers you — **2 independent sources**

- **Aurora**, Waleed A., 2019-10-23 (Capterra): *"If the account is simultaneously
  login from two systems, **the work is lost**"* — the review text attributes this
  to there being no autosave.
- **Aurora**, Wasay M., 2019-08-06 (Capterra): *"Auto save option isn't
  available."*

Both are 2019 and may since be fixed — recorded with that caveat. Ranked here
anyway because it is the failure mode SolarPro is structurally closest to.

### 10. The permit/engineering deliverable is where the tools stop — **3 independent sources**

This is SolarPro's declared wedge, so the evidence matters.

- **Solargraf**, Rudy C., **Master Electrician**, 2★, 2024-02-27 (Capterra):
  *"ENGINEERING SEEMS LIKE A LOST CAUSE. HAVING TO ASK FOR CORRECTIONS THAT ARE SO
  BASIC AS TO MARKING LINE AND LOAD CORRECTLY ONLY TO RECIEVE PLANS INCORRECT
  AGAIN."* — a licensed electrician, sending the same basic correction twice.
- **Solargraf**, verified CEO, 1★, 2020-11-28: *"The permit pack is ridiculous."*
- **@jonathanc8329** asked the *same question on two different vendors' videos* —
  OpenSolar `P8JACuy96V8`: *"I am wondering how we get one line diagrams,
  structural and for the planset?"*; HelioScope `D4fHHMeBDDU`: *"I would of liked
  to see the one line diagram actually for this."* **This is one person, counted
  once** — but it evidences the gap spanning two products, and in both cases the
  vendor's reply was a documentation link, not a feature.

---

### Ranked #11 — single-source, but the highest-value finding in the hunt

**The homeowner's chosen option is never written back.**

- **Solargraf**, Ryan, Construction, **5★** (i.e. from a *satisfied* customer),
  2024-09-06: *"When multiple options were presented to homeowner, Solargraf does
  not provide a way for us to **persist which option the homeowner selected**."*

One source only, so it cannot be ranked by recurrence. It is called out because
it is a pure **output-consistency** failure of exactly the kind SolarPro already
has a standing ruling against: a thing the customer chose that never reaches the
system of record. See §3 and §5.

---

## 2. EVIDENCE TABLE

`source type` key: **OP** = verified operator complaint · **VM** = vendor
marketing about a rival · **SEO** = rival-vendor comparison blog · **REG** =
regulator/BBB record.

| complaint | product | type | URL / id | verbatim or close paraphrase | SolarPro same problem? | leapfrog opportunity |
|---|---|---|---|---|---|---|
| Leads not matching stated trade/area; conversion claims unsubstantiated | HomeAdvisor / Angi | REG | [ftc.gov 2022](https://www.ftc.gov/news-events/news/press-releases/2022/03/ftc-charges-homeadvisor-inc-cheating-businesses-including-small-businesses-seeking-leads-home) | "many of the leads it sells are actually purchased from affiliates and did not come from HomeAdvisor's website" | **No** — SolarPro's model is exclusive-claim, not resale | Publish lead *provenance* on the card: where it came from, when, how many pros can claim it |
| "not received a single lead that I would consider legitimate" after $5,000 | Angi Leads | OP | [trustpilot](https://ca.trustpilot.com/review/homeadvisorpros.com) | Lynn, 2026-09-01 | No | Spend-to-outcome ledger per contractor, visible before renewal |
| Charged for leads outside stated service area | Thumbtack | OP | [trustpilot](https://www.trustpilot.com/review/www.thumbtack.com) | William Sternberg, 2026-09-18: "they charge for unusable leads. For example outside my clearly stated service area" | No | Hard geo-gate at claim time, not a refund queue |
| "They charge you regardless if the lead is a good fit... you dont get the option to except or not" | CraftJack | OP | [pissedconsumer](https://craftjack.pissedconsumer.com/review.html) | Donavyn Egl, 2023-08-04 | No | Claim is an explicit accept; never auto-bill |
| 1,803 BBB complaints in 3 years | Angi | REG | [bbb.org](https://www.bbb.org/us/in/indianapolis/profile/contractor-referral/angi-0382-3041007/complaints) | — | No | — |
| "Placing panels with Open solar is an AWFUL experience" | OpenSolar | OP | `wsB6VRCWerY` | @Billetus, 3 likes | See §3 | — |
| Cannot rotate a placed array a few degrees to match the roof line | Solargraf | OP | `Z2GE6m8jitw` | @jakobspeksnijder8847 | See §3 | Snap-array-to-eave: one click, derived from the edge the user names |
| Cannot merge two roof edges | HelioScope | OP | `D4fHHMeBDDU` | @Rivera2000: "I can0t find that anywhere please help!!" | See §3 | — |
| Curved roof → "you just have to make straight lines that looks like a curve" | HelioScope | OP | `UTgre4il4Fo` | @swongstandard8011 | See §3 | — |
| "Is there any way to move whole house" | Aurora | OP | `KxoclvoNc8c` | @bhupendersingh6334 | See §3 | — |
| Auto-model "creates monstrosities of designs"; "New construction? Good luck!" | Solargraf | OP | [capterra.sg](https://www.capterra.com.sg/reviews/1006132/solargraf) | Jackson C., 1★, 2025-05-29 | See §3 | Refuse to auto-model when source data is absent; say *which* input is missing |
| "Sometimes it doesn't detect accurate pitch" | Aurora | OP | [capterra](https://www.capterra.com/p/191094/Aurora-Solar/reviews/) | Waleed A., 2019-10-23 | See §3 | — |
| Watched every vendor video, still cannot adjust LiDAR to dormers | Aurora | OP | `6c7eYT49vl0` | @Yorider-UK | See §3 | — |
| "Virtually every time we do a pre-planned array, we have to modify the design because a vent is located a couple inches off" | (all remote-imagery tools) | OP | [solarpaneltalk](https://www.solarpaneltalk.com/forum/solar/the-pros-and-cons-of-solar-energy/423913-automated-solar-roof-design) | @solarix, 2021-03-10 | See §3 | Field-measured obstruction correction that re-flows into the permit set |
| Production "always 10%-20% off"; cross-checked against a second tool | Solargraf | OP | [softwareadvice](https://www.softwareadvice.com/construction/solargraf-profile/) | verified CEO, 1★, 2020-11-28 | See §3 | Show the assumption stack behind the number, and let the installer override with a reason |
| "Would love the ability to model shading from trees or chimneys" | Solargraf | OP | [capterra.sg](https://www.capterra.com.sg/reviews/1006132/solargraf) | Mark, 2019-12-24 | See §3 | — |
| "There's no way for solar installers to see their profit margins using this software" | Aurora | OP | `aBy9AeiUPf0` | @tethysenergy | See §3 | Cost/price/margin on the same screen as the design, sourced from the BOM |
| "use a separate pricing spreadsheet and just add the manual total into Open Solar" | OpenSolar | OP | `A0NKDNC4pcc` | @ElectricalInnovations (installer) | See §3 | Kill the spreadsheet: line-item cost + markup inside the product |
| "proposal and financial calculations functionality is very limited" | Aurora | OP | [capterra](https://www.capterra.com/p/191094/Aurora-Solar/reviews/) | Wouter Z., 1★, 2024-09-12 | See §3 | — |
| "expect to wait 2 weeks with no responses... Have a backup design tool just in case" | Aurora | OP | [trustpilot](https://www.trustpilot.com/review/aurorasolar.com) | CU, 3★, 2025-09-03 | See §3 | Every refusal carries its own fix; never require a ticket to get unblocked |
| "no way to contact the design team except through the app which takes days" | Solargraf | OP | [softwareadvice](https://www.softwareadvice.com/construction/solargraf-profile/) | verified CEO, 1★ | See §3 | — |
| Raw `TypeError` shown as the error message; "No were does it show how to fix it" | OpenSolar | OP | `wsB6VRCWerY` | @loiseaucarine8260 | See §3 | — |
| "Glitchy 3-d bogs down my computers and is difficult to set points on a tablet" | Solargraf | OP | [softwareadvice](https://www.softwareadvice.com/construction/solargraf-profile/) | James M., 3★, 2024-09-06 | See §3 | A tablet-grade capture mode that does not require the 3D engine |
| "Consumes a lot of memory. Auto save option isn't available. Sometimes stuck in between" | Aurora | OP | [capterra](https://www.capterra.com/p/191094/Aurora-Solar/reviews/) | Wasay M., 4★, 2019-08-06 | See §3 | — |
| "If the account is simultaneously login from two systems, the work is lost" | Aurora | OP | [capterra](https://www.capterra.com/p/191094/Aurora-Solar/reviews/) | Waleed A., 2019-10-23 | See §3 | — |
| Basic line/load marking returned wrong twice; "ENGINEERING SEEMS LIKE A LOST CAUSE" | Solargraf | OP | [capterra](https://www.capterra.com/p/224635/Solargraf/reviews/) | Rudy C., Master Electrician, 2★, 2024-02-27 | See §3 | SolarPro's wedge — generate the SLD from the design, never re-key it |
| "The permit pack is ridiculous" | Solargraf | OP | [softwareadvice](https://www.softwareadvice.com/construction/solargraf-profile/) | verified CEO, 1★ | See §3 | — |
| "how we get one line diagrams, structural and for the planset?" | OpenSolar + HelioScope | OP | `P8JACuy96V8`, `D4fHHMeBDDU` | @jonathanc8329 — **one person, both vendors** | See §3 | — |
| **"does not provide a way for us to persist which option the homeowner selected"** | Solargraf | OP | [capterra.sg](https://www.capterra.com.sg/reviews/1006132/solargraf) | Ryan, 5★, 2024-09-06 | See §3 | **See §5 — best leapfrog** |
| "36 financing options for the customer to choose from - WAY TOO MANY!" | Solargraf | OP | [capterra.sg](https://www.capterra.com.sg/reviews/1006132/solargraf) | Mark, 2019-12-24 | See §3 | Rank and default the finance options; do not enumerate the cartesian product |
| "The interface is cluttered and difficult to navigate"; "The amount of training required to get new team members up to speed is ridiculous" | Enerflo | OP | [trustpilot](https://www.trustpilot.com/review/enerflo.com) | Ray Gillespie, 1★, 2024-05-18 | See §3 | — |
| "they continue to charge my account after cancellation" | Solargraf | OP | [capterra](https://www.capterra.com/p/224635/Solargraf/reviews/) | verified owner, 1★, 2021-01-27 | Undetermined (billing not audited) | — |
| Shading "absolute garbage" (attributed to G2) | Solargraf | **SEO** | surgepv.com/reviews/solargraf | **second-hand; G2 403 — NOT verified at source** | — | — |
| Scanifly drone-visit scheduling bottleneck, per-project pricing | Scanifly | **SEO** | qbitsenergy.com, surgepv.com | rival-vendor claims only | — | **Lane unfilled — see §4** |
| OpenSolar "hidden add-on costs", real price $80–150/user | OpenSolar | **SEO** | heavengreenenergy.com | rival-vendor claim, cites unverifiable Reddit/LinkedIn screenshots | — | **Not usable** |

---

## 3. WHERE SOLARPRO HAS THE SAME PROBLEM

Read-only audit of the repo, 2026-09-25. **Checked in the code, not guessed.**
The point of this section is not to feel good.

### 🚨 SAME PROBLEM — three, and one of them is live

**A. Raw internal errors reach the user** *(competitor complaint #7 — OpenSolar's
Python traceback)*

SolarPro does the same thing, in the same shape. There is no error-sanitising
helper anywhere in the repo (`sanitizeError|userFacingError|safeErrorMessage` →
0 hits).

- `app/engineering/page.tsx:8473` — pastes **the raw HTTP response body**, first
  200 characters, into a toast.
- `app/engineering/page.tsx:8477` — `toast.error(\`Permit generation error: ${(e as Error).message}\`)`
- `app/engineering/page.tsx:8954`, `:9074` — `toast.error('Save failed: ' + String(err))`
- `components/design/DesignStudio.tsx:2135`, `components/design/ShadeAnalysisPanel.tsx:100`
- Server side, ~40 routes return the exception verbatim, including
  `app/api/admin/migrations/route.ts:874` — **a raw Postgres error reaching an
  admin screen.**

The good pattern already exists and is simply bypassed: `handleRouteDbError`
(`lib/db/core.ts:150-200`) turns DB failures into *"Service temporarily
unavailable. Please try again in a moment."*

**B. Proposal email — a missing key reports SUCCESS** *(competitor complaint:
Solargraf's "The additional email address never sends")*

This is worse than the complaint it matches. `lib/email.ts:27-38`:

```ts
const resend = getResendClient();
if (!resend) {
  console.log('… EMAIL (dev fallback — RESEND_API_KEY not set) …');
  return { success: true };
}
```

`getResendClient()` returns `null` when `RESEND_API_KEY` is unset **or still the
placeholder**, and this branch is **not gated on `NODE_ENV`**. In production with
a missing or placeholder key, every proposal email silently no-ops, the route
still writes `sent_at` and `sent_to_email`
(`app/api/proposals/[id]/send-email/route.ts:139-147`), and the UI tells the
installer *"Proposal sent to <email>"*.

Also matching the complaint: **no CC / additional-recipient field exists at all**
(`SendEmailOptions` is `{to, subject, html, text}`), and there is **no bounce or
delivery-status telemetry** anywhere.

**C. Concurrent-session work loss** *(competitor complaint #9 — Aurora's "if the
account is simultaneously login from two systems, the work is lost")*

SolarPro's autosave is genuinely good — 3-second debounce, `beforeunload`
`sendBeacon`, and a restore gate that stops a cold Neon start beaconing an empty
design over a stored one (`components/design/DesignStudio.tsx:1414-1479`, `:1072`).

**But there is zero optimistic concurrency.** The save route
`app/api/projects/[id]/layout/route.ts` takes no version, etag or `updated_at`
check; a repo-wide grep for `If-Match|expectedVersion|rowVersion|xmin` returns
nothing outside `node_modules`. The layout row is keyed `(project_id, user_id)`
(`lib/db/projects.ts:1124-1129`), so **two tabs on the same account write the same
row**, each POSTing its full panel array every 3 seconds. Last write wins.

A subsystem-wipe guard (`lib/db/projects.ts:1131-1170`) catches the gross case,
not the ordinary one. And although every save writes a full version snapshot and a
restore route exists (`app/api/projects/[id]/versions/[versionId]/route.ts`),
**no UI anywhere consumes it** — grep across `app/**.tsx` and `components/**.tsx`
for `project_versions|VersionHistory|/versions` returns nothing. An installer who
loses work cannot get it back without hand-calling the API.

### PARTIAL — SolarPro is one screen away

**D. The margin is computed and then thrown away** *(competitor complaint #5)*

`lib/pricingEngine.ts:247` defines `calculateProfitMargin(price, cost)`. It is
called exactly once — `lib/pricingEngine.ts:415`. Grep across the entire repo
returns **only those two lines**: no page, component or API route renders it.

Meanwhile every input already exists, on two different screens:
- **Design Studio sidebar** (`components/design/DesignSidebar.tsx:281-311`) shows
  "Gross System Cost" — which is `cashPrice`, i.e. **the customer price, not
  cost** (`app/api/production/route.ts:123`).
- **Engineering page** (`app/engineering/page.tsx:9476-9494`) renders a real BOM
  cost roll-up: `$Xk` "BOM Cost" and `$/W hardware`, priced per line from the
  distributor catalog (`lib/bom/distributorPricing.ts`).
- `costEstimate.laborCost` / `equipmentCost` are computed
  (`app/api/production/route.ts:659-660`) and **rendered nowhere**.
- Margin % exists only as a *global admin config input*
  (`app/admin/pricing/page.tsx:549-554`), never a per-project readout.

So SolarPro is in the same position Aurora's user described: the design is good,
the cost data is there, and there is no screen where an installer sees cost,
price and margin for a project at the same time.

**E. Panel move/rotate records no undo** *(competitor complaint #2)*

SolarPro *beats* the rotation complaint (see below) but loses on reversal.
`applyArrayTransform` (`components/3d/SolarEngine3D.tsx:10535-10570`) is the
single funnel for both move and rotate, and it calls only `onPanelsChange`. It
never pushes history. `pushSnapshot` has three call sites, all in
`components/design/useSiteDesign.ts:352, 880, 958`, and the unit of history is
`RoofPlane[]` (`lib/3d/geometryHistory.ts:16-19`).

**Drag an array off the roof by accident and Ctrl-Z either does nothing or
replays an older roof.** Given memory's standing rule that every destructive op
needs a named inverse, this is a live gap.

**F. The production number is unexplained where the installer works**
*(competitor complaint #4)*

The **customer-facing** proposal is genuinely good — a full "Proposal
Assumptions" block with utility rate, net-metering type, escalation, production
model, usage source and degradation (`app/proposals/view/[id]/page.tsx:1790-1857`),
and a TSRF badge that appears only when shade analysis actually ran.

The **installer-facing** Design Studio number is bare.
`components/design/DesignSidebar.tsx:230-236` shows Annual Production / Offset /
Specific Yield with no loss assumption, no source, no shade statement — grep for
`losses|derate|PVWatts|NREL|shade` in that file returns 0 hits. Worse,
`lib/pvwatts.ts:445-447` **silently falls back** from the live NREL PVWatts API
to a local model, `DesignStudio.tsx:1154/:1168` tags the estimate
`source: 'local'` vs `'fallback'`, and **that flag is never rendered**. The user
cannot distinguish an NREL-backed number from a crude
`systemSizeKw * 4.5 * 365 * 0.86` approximation (`DesignStudio.tsx:1158`).

### WHERE SOLARPRO IS ALREADY AHEAD

Recorded so the next pass does not re-litigate them.

| Competitor complaint | SolarPro |
|---|---|
| **Cannot rotate an array to match the roof line** (Solargraf, `Z2GE6m8jitw`) | **Solved three ways** — a floating ⟳ grab handle (`SolarEngine3D.tsx:10619-10661`), live drag with camera freeze (`:7576-7667`), and numeric/keyboard (`:10700-10711`). And the maths is right for the user's *actual* goal: `rotateArrayBy` (`:10591-10616`) rotates **in-plane about the roof normal**, so tilt, azimuth and energy are unchanged |
| **3D bogs down the computer / too much memory** (Aurora ×3, Solargraf) | **Real, deliberate guards** — `requestRenderMode: true` (`:3669`), tiered LOD 64→32→16 (`:4409-4413`), a count-based geometry budget (`skipGrid = panels > 12`), incremental add/remove diffing instead of full rebuild (`:6623-6674`), and full entity + viewer disposal on unmount (`:15159-15162`). *Gap: no hard entity cap, and the file header's "GPU-instanced panel rendering" claim at `:9` is stale — panels are entities* |
| **"how do we get one line diagrams, structural and for the planset?"** (@jonathanc8329, two vendors) | **Both exist and are reachable.** SLD auto-renders with zero clicks when the tab is open (`app/engineering/page.tsx:7362-7375`); the permit package is one button (`:8426`). Honest count from a design: **two clicks, no data re-entry** — not one |
| **Basic line/load marking returned wrong twice** (Solargraf, Master Electrician) | The SLD is generated from a single `computeSystem() → PermitSystemModel` source of truth (`app/api/engineering/sld/route.ts`), never re-keyed. The retired duplicate route is a deliberate **HTTP 410 tombstone** pointing at the canonical one |
| **Vents "a couple inches off" force a redesign every time** (@solarix, solarpaneltalk) | **Fixed, with tests.** A hand-placed obstruction now reaches the plan set via `lib/obstruction/permitProjection.ts` — a *projection*, not a second store, taking clearance and radius from the same authorities the 3D keep-out uses. Covered by `tests/manualObstructionReachesPlanset.test.ts` and `tests/manualObstructionThroughCAD.test.ts` |
| **"you dont get the option to except or not, they charge regardless"** (CraftJack) | `lib/network/leadPurchase.ts` **auto-refunds** on a lost race (`:221`, `:258`, `:297`), writes an `assignment.claim_refunded` audit event, and defaults to `exclusive` claim mode (`:78`) |
| **Blocked with no way forward** (Aurora, Solargraf, OpenSolar — 5 sources) | Design/permit/electrical refusals carry a **required remedy field** (`lib/design/deletionAuthority.ts:816-822`), rendered as `(why, remedy)` pairs. e.g. *"There are no panels to clear." / "Place panels with Auto Layout or Fill Roof first."* The MPPT refusal (`lib/system/mpptAllocator.ts:380-415`) quantifies the shortfall and gives three ranked fixes. **Better than anything in the competitor corpus** — but see §3A: the raw-exception toasts are the exact opposite |

### One gap that is not a competitor's problem — it is an absence

**SolarPro has no multi-option proposal at all.** `app/proposals/page.tsx` has no
option/variant array, and the homeowner view
(`app/proposals/view/[id]/page.tsx:716-754`) is a single accept-and-sign flow.
Solargraf's customer complained it cannot *persist which option the homeowner
chose*; SolarPro cannot present options in the first place. See §5.

---

## 4. SOURCES BLOCKED OR EXHAUSTED

So the next pass does not repeat them.

### Blocked (HTTP 403 / paywall / TLS)

| Source | Failure | Notes for next pass |
|---|---|---|
| **reddit.com** | blocked to fetchers (carried over from round 3) | still the largest untapped pool; needs a different client |
| **g2.com** (all product pages) | **403** | blocks the single most-cited operator-review corpus. The "shading is garbage" Solargraf quote lives here and could **not** be verified |
| **trustradius.com** | **403** | tried Aurora and HelioScope |
| **help.aurorasolar.com** release notes | **403** | changelog route unusable |
| **support.opensolar.com** release notes | **403** | changelog route unusable |
| **help.helioscope.com** release notes | TLS internal error | changelog route unusable |
| **contractortalk.com** | 307 → `tollbit.` subdomain → **402 Payment Required** | genuine trade forum, now metered. CraftJack and lead-gen threads are behind it |
| **ziprecruiter.com** | **403** | job-posting workaround lane could not be filled with a verbatim posting |
| **bbb.org** complaint *narratives* | page returns metadata only | counts and ratings readable; individual narratives are not |

### Exhausted / genuinely empty (do not retry)

- **YouTube comments on vendor channels** — 48 of 57 corpus videos returned zero
  comments; Aurora, Solargraf, Bodhi, Enerflo and Scanifly channels have them
  disabled or unused. The 292 comments collected are essentially the whole
  available pool for this corpus. Productive videos were `wsB6VRCWerY`,
  `aBy9AeiUPf0`, `UTgre4il4Fo`, `D4fHHMeBDDU`, `P8JACuy96V8`, `A0NKDNC4pcc`,
  `6c7eYT49vl0`, `KxoclvoNc8c`, `Z2GE6m8jitw`.
- **sourceforge.net / slashdot.org** product pages — "This software hasn't been
  reviewed yet", 0.0/5, for Scanifly and Enerflo. No content.
- **Capterra for OpenSolar, HelioScope, Scanifly, Enerflo** — these products have
  **no Capterra listing**; searches resolve to unrelated products (Open Social,
  OpenStack). Only Aurora (`/p/191094/`) and Solargraf (`/p/224635/`) exist.
- **YouTube search for complaint-shaped phrasing** — "why I switched from",
  "honest review", "problems with" plus each product name returned vendor demos,
  rival-vendor blogs-as-video, and consumer-grade "is solar a scam" content. **No
  operator teardown video of any of these seven products was found to exist.**
- **Scanifly operator complaints: LANE UNFILLED.** Two G2 reviews total (per a
  search summary; G2 itself 403), zero SourceForge reviews, no Capterra listing,
  and every YouTube result is Scanifly's own channel. Everything a search returns
  about Scanifly's downsides is written by a company selling an alternative.
  **Recording this as unfilled rather than filling it with marketing.**

### Route that worked and is not exhausted

**`capterra.com.sg` and other Capterra locale mirrors return longer, untruncated
review text than `capterra.com`.** Jackson C.'s full 1-star Solargraf review and
Ryan's option-persistence complaint were only readable on the SG mirror. Next
pass should try `.co.uk`, `.com.au` and `.ca` mirrors for every product.

---

## 5. THE SINGLE BEST LEAPFROG

### Show the installer their margin, on the design screen, from the BOM

**Why this one.** It is the only complaint in the hunt that scores on all four
axes at once:

1. **Best-evidenced complaint that is actually about the product** (4 independent
   operator sources, versus 2 for autosave and 1 for option-persistence). The
   marketplace complaints are better-evidenced still, but SolarPro already beats
   those (§3).
2. **It is the "what do you keep a spreadsheet for" question, answered out loud
   by an installer on camera.** That was the single hardest thing to find in this
   hunt and it was found verbatim.
3. **Nobody has it.** Aurora, OpenSolar, Solargraf and HelioScope all price the
   *customer*. None of them shows the installer their own cost.
4. **SolarPro already computes every input and throws the answer away.**

**The evidence.**

- **Aurora**, YouTube `aBy9AeiUPf0`, @tethysenergy — the longest and angriest
  practitioner comment in the entire 292-comment harvest:

  > *"I can't beleive there is no functionailty to properly price up solar &
  > battery components using this software. Any software like this should allow
  > installers to create a list of items with prices that can then be marked up
  > ready for the proposal or at least an equivalent $/kWp costing system with
  > adders. This lack of functionality makes this product utterly useless at
  > drawing up proposals for clients. **There's no way for solar installers to see
  > their profit margins using this software.** The deisign aspect is really very
  > good, however this is a 'half product' and some serious work needs to be done
  > before this can be used by installers to design and cost up installations."*

- **OpenSolar**, YouTube `A0NKDNC4pcc`, @ElectricalInnovations — a working UK
  installer, on their own walkthrough video, answering a viewer who asked how
  they configure quote pricing:

  > *"We set the system at price per KW and battery to price per kWh. Weve moved
  > on from this a bit now and **use a separate pricing spreadsheet and just add
  > the manual total into Open Solar**."*

  This is the artefact the whole hunt was looking for: the spreadsheet that lives
  outside the product, named by the person who keeps it.

- **Aurora**, Capterra, Wouter Z., **Solar Design Engineer**, 1★, 2024-09-12:
  *"The proposal and financial calculations functionality is very limited. Aurora
  solar is essentially made for nothing more that a house with a grid tie
  inverter... incredibly expensive ripoff... incredibly limited and really
  insufficient for a solar company"*

- **OpenSolar**, YouTube `wsB6VRCWerY`, @sanjuansteve, comparing the product
  favourably to *his own 2007 Excel template* — the same tell from the other
  direction.

**Why SolarPro can ship it fast — this is the part that makes it a leapfrog and
not a roadmap item.** Every ingredient is already written:

| Ingredient | Already exists at |
|---|---|
| Margin function | `lib/pricingEngine.ts:247` `calculateProfitMargin(price, cost)` — **called once, rendered nowhere** |
| Per-line hardware cost from the distributor catalog | `lib/bom/distributorPricing.ts`, rendered as "BOM Cost" + "$/W hardware" at `app/engineering/page.tsx:9476-9494` |
| Labor + equipment cost | `app/api/production/route.ts:659-660` — computed, **rendered nowhere** |
| Customer price | `cashPrice`, already on the Design Studio sidebar (mislabelled "Gross System Cost", `components/design/DesignSidebar.tsx:281-311`) |

The work is a **presentation layer over data that is already computed**, plus one
label correction. There is no new source of truth — which matters, because it
keeps the cross-lane rule from round 3 intact:

> A finance product must not select the price. A supplier must not select the
> parts. **One authority, two derived presentations.**

The BOM stays the cost authority; `pricingEngine` stays the price authority. The
margin screen is a third *view*, not a third store.

**The leapfrog framing.** Aurora's own user calls it a *"half product"* because it
designs beautifully and cannot tell you whether the job makes money. SolarPro
already has the permit package Aurora does not, and already has the BOM cost
Aurora does not. Putting cost, price and margin on one screen turns SolarPro from
"the one that does permits" into **the only tool in the category that can answer
'should we bid this?'** — and retires a spreadsheet an installer told us, on
camera, that he is still keeping.

### Runner-up, for the record

**Fix `lib/email.ts:27-38` first anyway.** It is not a leapfrog — it is a live
defect capable of silently swallowing every proposal a company sends while
telling them it was delivered (§3B). One line. It outranks everything here on
urgency and nothing here on strategic value.
