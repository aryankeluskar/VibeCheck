---
description: Fast Forward Hackathon (Vercel x Meta) rules, tracks, judging rubric, deadlines, and partner tooling. Governs every decision on the hackathon project in this repo.
alwaysApply: true
---

# Fast Forward Hackathon — project context

This repo is an entry for the Fast Forward Hackathon. Optimize every decision for a working, deployed demo that scores well against the track rubric below, before the submission deadline. Scope ruthlessly: one useful outcome, demonstrated live, beats many half-working features.

## Team coordination (mandatory before claiming any TODO)

Four people and their agents work in parallel. Claims and work in progress often sit on branches (e.g. `claude/*`) that haven't reached `master` yet. **Before you claim or start any TODO in `README.md`, check every other branch of work:**

```bash
git fetch --all --prune
git branch -r --sort=-committerdate               # recent branches first
git log --oneline master..origin/<branch>         # what each recent branch adds
git diff --stat master...origin/<branch>          # which files it touches
gh pr list                                        # open PRs
```

- If any branch claims the TODO (a name next to it) or already changes the files it needs, don't take it. Pick another TODO or ask the user to coordinate.
- When you claim a TODO, push that one-line README change straight to `master` right away so other branches see it. A claim that only lives on your branch is invisible.
- Before you push, fetch again and rebase on `master`. Don't rewrite lines that another open branch changes (the TODO block especially); add notes nearby instead.

Sources (re-check if something seems off; organizers mark some details "to confirm"):
- Deck: https://fast-forward-deck.vercel.app (local clone in `slides/`, serve with `python3 -m http.server` from that dir)
- Builder Resources: https://vercel.notion.site/Builder-Resources-Fast-Forward-3f3e06b059c4818eba9ada18e6f32dc0
- Hackathon page / submission portal: https://community.vercel.com/hackathons/fast-forward-hack
- Showcase: https://community.vercel.com/hackathons/fast-forward-hack/showcase

## Event

- Wednesday, October 14, 2026, 10:00am–6:00pm Pacific, San Francisco.
- Co-hosts: Vercel + Meta. Integration partners: Neon (Postgres), Shopify.
- Brief: build an app or agent that keeps working, adapts intelligently, or helps people understand, decide, and act faster.
- Max team size: 4. Pick exactly one award track; you are judged only in that track.
- Wi-Fi: `Motoring Club Member` / password `burnrubber`.
- Event + submission help: Marc Baiza, Maya Avendano. Technical mentors on the floor during build time. VR headsets: Meta team, VR experience room, back right corner of the venue.

## Hard deadlines (Pacific)

| Time | What |
| --- | --- |
| 11:00am | Build begins (existing teams may start at 10:40) |
| 12:30pm | Lunch |
| 3:00pm | Stop features. Deploy, test links signed-out / on another device, finish entry, rehearse 3-min demo |
| 4:00pm | Target submission deadline. Treat this as the real deadline |
| 4:10pm | Portal closes; entries can no longer be edited |
| 4:10–4:50pm | Round 1: each track's 3-judge panel reviews submissions (no live pitches) and picks top 3 |
| 4:50–5:00pm | Top 9 notified (3 per track); prepare demo order and AV |
| 5:00–5:35pm | Finalist live demos, 3 minutes each, no Q&A |
| 5:35–5:50pm | Deliberation, one winner per track |
| 5:50pm | Winners + awards; close at 6:00pm |

Round 1 is judged from the submission alone, so the deployed URL, description, and setup instructions must stand on their own without the team present.

## Tracks and entry criteria

### Agents & Factories — "useful agents that keep working"
Build an agent system that continues producing useful work after you step away. `eve` is encouraged.
Must:
- Deploy on Vercel.
- Run asynchronously or from schedules/events.
- Produce useful work without a manual prompt for every step.
- Show how a person can monitor and steer the system.
Vercel starting point: eve; add tools, connections, and a schedule or event trigger; show the output and how a person steers the agent.
Example ideas: a research monitor that produces a cited brief; a release assistant that checks changes and flags risks.
Judges: Andrew Barba, Ben Pankow, Andre Landgraf.

### Multi-modal Apps — "combining models and modalities through AI Gateway"
Must:
- Use at least two models and two modalities, routed through Vercel AI Gateway.
- Have fallback behavior, with model choices that account for latency and cost. Meta models are optional.
Demo focus: explain the model choices, the routing, and what happens when a provider fails.
Vercel starting point: AI SDK + AI Gateway. Get one model call working, then add the second model/modality and test fallback. Vercel Sandbox, Workflows, and other primitives are encouraged.
Judges: Vanessa Teo, James Arthur, Misha Damjanic.

### VR Apps — "immersive experiences with v0 and Meta tools"
Eligibility (not scored, pass/fail): an immersive WebXR experience that runs in the browser on Meta Quest from a live Vercel HTTPS URL. Judges try every entry on a Quest headset; desktop emulation alone does not qualify.
Starting point: v0 + Meta's Immersive Web SDK (IWSDK) template, preview with IWER, deploy to Vercel, test on a headset early.
- IWSDK starter for v0: https://github.com/meta-quest/iwsdk-v0-template/
- IWER (desktop WebXR emulation): https://github.com/meta-quest/immersive-web-emulation-runtime
- Immersive Web SDK: https://github.com/facebook/immersive-web-sdk
Workflow: build one interaction (e.g. three floating grabbable objects), test each change in IWER, deploy, open the same HTTPS URL in the headset browser, enter VR, verify the core interaction. MQDH (Meta Quest Developer Hub) is optional; ask the Meta team. Optional PWA/APK packaging via `hz-store-pwa` is not a requirement.
Troubleshooting: URL won't load on headset → verify the exact HTTPS URL on desktop first. Can't enter VR → check the Enter VR control and in-headset permission prompts.
Finalists must arrange headset access and screen casting with the AV team before their slot.
Judges: Alisa Kurt, Felix Zhang, Andrew Imm.

## Judging rubric

Each criterion scored 1–10, equal weight, total out of 30, averaged across the track's judges.

Agents & Factories and Multi-modal Apps:
- Usefulness: solves a real problem and produces reliable, useful output.
- Creativity: original idea or implementation, thoughtfully designed.
- Impact: saves time, improves quality, reduces costs, or enables new work (potential scale, value creation, overall execution).
- Ties: usefulness, then impact, then a short follow-up demo.

VR Apps:
- Fun & engagement: enjoyable and compelling to keep exploring.
- Creativity & use of VR: inventive use of immersion, spatial interaction, hand tracking, mixed reality, movement, or presence.
- Ambition & execution: technical ambition, and the core experience works responsively and comfortably.
- Ties: Creativity & use of VR.

## Submission

One teammate submits for the whole team (each Vercel Community account holds one project). Sign in at the hackathon page, join, and fill in:
- Project Name and Description: what it is, who it's for, the problem it solves, the technologies used, and explicitly how it meets the track's entry criteria.
- Public Deployed URL: the working demo judges open. Must work in a signed-out browser / on another device.
- Social Links (optional, up to 5): repo, backup demo video, posts.
- Track: exactly one of Agents & Factories, Multi-modal Apps, VR Apps.
- Team members: up to 4 including the submitter.
- Demo setup instructions: any login, test account, or device needed, or "None".
Then Submit Project and confirm it appears in the showcase with correct links. Edit with Save Changes until 4:10pm.
Recommended: a short recorded backup demo in case the live demo fails.

3-minute finalist demo structure: the problem, the live result, the impact. Have the demo link open before your turn.

## Partner tooling

Vercel (deploy early, redeploy after each change, re-open the submitted URL to confirm it serves the latest version):
- v0 (build and iterate), eve (agents that keep working), AI SDK (model calls, tools, structured output), AI Gateway (models, modalities, routing), Workflows (durable multi-step tasks), Sandbox (run generated code).
- AI Gateway: create an API key on the credited Vercel team and set it as the server-side env var `AI_GATEWAY_API_KEY`. The event promo code is for credit redemption, not an API key. Gateway credits only cover requests billed through Vercel, not separate provider accounts.
- Works locally but fails deployed: check env vars for the deployed environment and inspect runtime logs. Model request fails: check credentials, model/modality support, and the Gateway request details.
- Credit redemption codes (AI Gateway $100, Vercel Pro trial, v0) are on the Builder Resources "Start here" tab. Do not commit them.

Neon: use Neon Postgres for the database. Docs: https://neon.com/docs. Every hacker gets $200 in Neon credits: https://console.neon.tech/app/?promo=fast-forward-hack

Shopify (optional side quest, any track): Shop MCP lets you search products, check availability, and start checkout with no account or key. Quickstart: https://shop.dev/docs/quickstart · Tools: https://shop.dev/docs/tools
- Fetch results live; never cache results or re-host merchant images.
- Keep product URLs exactly as returned.
- One checkout per merchant; link shoppers to its `continue_url` instead of completing purchases in the demo.
- Ideas: shopping assistant that asks size/budget/style then compares; gift finder by photo or description; cross-merchant comparison.

## Prizes

One winning team per track, up to 4 members each.
- Per winning member, $4,600 in credits: $1,800 Vercel platform ($300/month for 6 months), $600 AI Gateway, $400 v0, $1,800 Neon. Plus Meta credits (amount to be confirmed).
- $18,400 per full four-person team; up to $55,200 total.
- Physical package per winner: Neon Keychron keyboard, VRC racing swag, and a VRC Racing jacket.
- Note: the deck headlines show "$44,345 total" and "$3,689 per member", which contradict the deck's own breakdown and the Builder Resources page. The figures above match the breakdown.

Side quests (optional, separate from track awards): racing simulator (FX trading card); beat every model in the VRC racing game at vracing.vercel.app, password `vracingclub`, with a screenshot as proof (low-profile keyboard); build with Shop MCP ($2,500 Shop Cash per Builder Resources, $1,084 per the deck; picked by the Shopify judge in the final round); try the VR experience in the Meta lounge.

## Opening speakers

Marc Baiza (welcome, rules, judging; Vercel from pages to agents), Yury Selivanov (Vercel, full-stack + AI apps on Vercel today), Alisa Kurt (Meta, VR building with v0 and immersive web tools), Andre Landgraf (Neon, Postgres for your project). 4:50pm remarks: Tomo (Vercel CPO), then Serena on supporting founders and builders.
