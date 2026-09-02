# Ideal first customer

## Purpose

Austral should start with one barbería real where the owner can see value quickly, give honest feedback and decide whether ARS 30.000+ per month is justified. This is a qualification model, not a claim about any specific business.

## High-priority profile

- One to five active barbers or professionals.
- Owner or decision-maker involved in day-to-day operations.
- Recent public activity on Instagram, Google or an official website.
- Receives turn requests through WhatsApp, Instagram DM or a basic booking page.
- Manual, fragmented or only partly automated agenda.
- Enough recurring client activity to expose scheduling friction.
- Observable problem: repeated availability questions, double handling, unclear services, scattered professional schedules or client records.
- Public commercial contact whose ownership can be verified.
- Ability to test for 15 days and discuss paid continuity manually.

## Low-priority profile

- Large chains or franchises requiring procurement.
- Advanced proprietary app or integrated booking operation with no identified gap.
- Inactive or abandoned public presence.
- Contact belongs to an agency, software provider, marketing intermediary or booking platform.
- No direct owner/employee path and no willingness to identify one.

## Qualification guardrails

`HUMAN_REVIEW_REQUIRED` is always on. A contact can reach `READY_TO_CONTACT` only when:

1. the business is active and the source is public;
2. the recipient is classified `BUSINESS_DIRECT` or `EMPLOYEE_BUSINESS`;
3. DNC, prior negative contact and duplicate checks pass;
4. the message is personalized and reviewed by Lautaro;
5. the contact channel is manually approved.

`UNKNOWN`, `AGENCY` and `SOFTWARE_PROVIDER` stay in review. Never infer an owner's identity from a generic address, directory, booking platform or vendor domain.

## Scoring model (0–100)

Score evidence, not enthusiasm. If a variable is unknown, record `unknown` and cap the score until a human resolves it.

| Variable | Weight | Evidence to record |
|---|---:|---|
| Manual/fragmented turn handling | 20 | Public WhatsApp/DM/phone flow, paper agenda or repeated availability handling |
| Suitable team size (1–5) | 15 | Public team page or business statement |
| Recent activity | 15 | Recent posts, updated site, current hours or reviews |
| Digital presence | 10 | Official Instagram, website or Google profile |
| Observable scheduling pain | 15 | Specific, public operational friction; no invented problem |
| Current system gap | 10 | Manual/basic system or a clearly stated gap |
| Owner/employee contactability | 10 | Direct business channel and identifiable role |
| Payment potential | 5 | Business maturity, repeat service and plausible ability to test |

### Priority bands

- **A (75–100):** contact after full preflight; best first-customer candidates.
- **B (55–74):** research and human review; contact only after A learnings.
- **C (35–54):** reserve; contact only if the hypothesis changes.
- **DESCARTAR (<35):** do not contact, or close because the business is inactive, disallowed or unresolvable.

## First-customer hypothesis

The strongest first customer is not necessarily the largest barbería. It is the owner-led business where one concrete scheduling problem can be improved within the 15-day trial and measured manually. The desired path is:

`RESPONSE → DEMO → TRIAL → FIRST REAL BOOKING → PAID CONTINUITY`

No result is guaranteed. The pilot exists to test the hypothesis.
