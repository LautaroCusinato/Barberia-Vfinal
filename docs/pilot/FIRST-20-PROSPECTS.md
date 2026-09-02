# First 20 prospects: execution design

This document defines a controlled sequence, not a stored list of real businesses. Add a prospect only after public-source research, contact-owner classification, DNC/duplicate review and human approval. The CRM is the source of truth; the empty [PROSPECT-TRACKER.csv](./PROSPECT-TRACKER.csv) is only a preparation template.

## Cohort strategy

`20 leads → top 10 → contact 5 → measure → adjust → second 5 → demos → first trial`

### Top 10 selection

Rank by the score in [IDEAL-FIRST-CUSTOMER.md](./IDEAL-FIRST-CUSTOMER.md), then use these tie-breakers:

1. direct owner/employee contact is publicly verified;
2. low switching friction and a concrete scheduling problem;
3. one to five active professionals;
4. recent public activity;
5. a clear path to a 15-day trial.

Do not use a large chain, a business with a mature system and no identified gap, or a contact that belongs to an agency, provider, platform or intermediary.

## First 5

- Review each business and exact recipient with Lautaro.
- Confirm `BUSINESS_DIRECT` or `EMPLOYEE_BUSINESS`.
- Confirm DNC, prior-negative contact and duplicate checks in the CRM.
- Choose one channel and one short, personalized message.
- Contact manually, one business at a time.
- Stop new contacts at five and report outcomes.

## Learn before the second 5

Review response quality, objections, source accuracy, identity issues, demo requests and DNC. Adjust only the relevant line or variant; do not rewrite the entire offer after one response. If a product limitation appears repeatedly, pause and document it with the product owner.

## Second 5

Repeat the same gate with five new prospects. Never backfill a non-response through another channel. Never send 20 identical messages in one batch.

## Demos and trials

- A positive reply becomes a human-reviewed demo conversation.
- Use the approved demo link only when its readiness is confirmed.
- Offer a 15-day trial only after consent, scope and onboarding readiness are clear.
- Do not create a tenant, meeting, discount or billing record automatically.

## Pipeline states

`NEW → RESEARCHED → CONTACTED → REPLIED → DEMO_SCHEDULED → DEMO_DONE → TRIAL → ACTIVE`

Use `LOST` for a closed fit or exhausted respectful cadence and `DO_NOT_CONTACT` for an explicit request or safety/identity block. Record timestamps, owner, channel, exact message and next action in CRM.

## Reporting after each cohort

Report exactly: sent manually, delivered/bounced, replies, positive replies, demos, trials, DNC, errors, identity reviews and the five exact recipients. Stop and wait for Lautaro's review before expanding.
