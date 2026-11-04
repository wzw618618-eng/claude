# Acceptance and recovery

## Evidence to retain

Record source/build revision and digests; official tool/version; project compile type;
OS, architecture, WeChat/base-library version, simulator/device, realm, viewport/DPR;
actual renderer backend/caps; submitted and **successfully completed** frame receipts;
operations, screenshots and raw failures. Use existing Engine inspection and reports,
not a parallel capability registry. Retain artifacts privately until sanitized for
publication; account identity, tokens and login QR are not source artifacts.

| Claim | Required observation |
|:--|:--|
| Tool setup | Trusted install, official installation check, authorized client, login status |
| Host contracts | Native clock/display/callback/cancel/lifecycle and cleanup regression results |
| Ordinary game | Public SDK project/App/World/Catalog path, main-screen 3D pixels, 60 completed frames, input/physics |
| WASM/resources | Real module consumers and ordinary asset load, digest/provenance checks, corrupt/read/retry/cancel cases |
| Portable UI | Same full source and operation sequence as browser, Grid/ShadowRoot/dynamic form/focus, startup/fatal/Reload, images and behavior |
| Lifecycle | Hide/show, input cancellation, resize, stop/rebuild and stale-generation fencing |
| Phone support | Separate target-device run for each declared Android/iOS/mode/realm combination |
| Engine regression | Applicable focused checks plus repository-required complete Dawn smoke roster, browser and Dawn gates |

Use PASS only for the claim actually observed. Tool import, upload compilation, QR,
rAF counts, physics steps and a cleared offscreen buffer cannot replace completed
visible ordinary-game frames. Simulator success does not extend the phone matrix.

### Browser appearance and backend parity

Use Chrome as a practical reference for shared HTML/CSS semantics and usable
controls. Prioritize missing glyphs, clipping or overlap, broken layout rules,
incorrect focus/input behavior, missing affordances and disabled controls that
cannot be distinguished from editable ones. Exercise representative composed
forms and settings as well as the game overlay.

Unless the product specifies exact styling, accept normal system-font,
antialiasing, native decoration and small control-size or tooltip differences.
For a suspected font bug, compare the same actual font bytes, weight and size
before changing metrics. Avoid adding renderer special cases to match a single
browser's default decoration; explicit author styles remain authoritative.

This tolerance applies to different browser defaults. Rendering the same Blitz
draw data through CPU, WebGPU, WebGL2 or Dawn retains its existing pixel and
behavior thresholds. Preserve complete-frame comparisons and falsifiers; do not
mask an unexplained backend mismatch as a browser-style difference.

### Match the delivered native publication

Compare both `forgeax-dist.json` and the emitted compressed WASM file after transfer.
Record the uncompressed WASM digest from its native provenance separately. A shared
source digest and toolchain do not prove identical output bytes: the qualified
Blitz builds embedded Rust/Cargo/Stylo source paths and differed across checkout
locations. Preserve the complete matched glue/WASM/provenance publication when
staging an SDK build; do not replace only the WASM file or relabel an earlier
simulator result with the new digest.

When JavaScript alone changes, compare emitted package inventories to identify
the affected behavior, then rerun that behavior on the rebuilt ordinary game.
A changed native publication needs fresh evidence for its affected startup,
interaction or failure/Reload paths on the target being qualified. Follow the
current failure and user priority when choosing that target; a phone-only repair
does not need an unchanged simulator detour. A passing simulator package does not
imply the whole SDK's independent consumers passed.

For a controlled effect or performance comparison, also match the ordinary asset
GUIDs and payload digests, including Engine-provided canonical resources. In one
clean integration checkout, the ignored canonical sky was an 8x1 fallback while
the tracked cook receipt still named the full HDR. The emitted environment changed
from 783,660 bytes to 16 bytes despite unchanged authored game files. Restore or
regenerate the source matching the receipt, then rebuild through the ordinary
producer; do not count that lighting change as a rendering optimization.

### Account for DevTools project metadata

Import/open with Nightly 2.02.2610092 and Skill CLI 0.3.11 on macOS 26.3.1 ARM64
(2026-10-11) created `project.private.config.json` and added 18 default/editor
fields to `project.config.json`. Examples included `editorSetting: {}`, empty
`packOptions` include/ignore lists, `compileWorklet: false`, and `minifyWXML: true`.
Every original configuration value, including the AppID, was preserved; the other
585 published artifacts and manifest retained their exact hashes.

Keep the untouched delivery ZIP and `forgeax-dist.json` authoritative. Preserve
the original and post-IDE configuration privately, record their semantic diff and
hashes, and rehash every declared artifact. Identify added IDE metadata separately.
Diagnose any changed existing configuration value, missing artifact or changed
runtime payload before accepting the run. Do not erase IDE metadata to force a
roster match or describe the whole remote directory as byte-identical when the
IDE rewrote configuration.

## Fail at the responsible boundary

| Observed failure | First recovery |
|:--|:--|
| SSH refused / permission denied | Check tunnel/listener or the explicit existing identity respectively |
| Legacy `.cli` profile missing / unknown command | Start the official app and locate the AI `wechatide` executable |
| Pending auth/login | Follow [Tooling](tooling.md); retain task ID and show the real pending interaction |
| `PROJECT_PATH_NOT_FOUND` | Verify the path on the DevTools machine and the transferred build |
| `PROJECT_CONFIG_JSON_ERROR` / `APPID_ERROR` | Inspect generated config and account's developer access; do not substitute a different AppID silently |
| Successful tool envelope with failed nested result | Preserve nested failure; wrapper exits nonzero |
| Screenshot unavailable | Keep the capture failure and repair tool/desktop capture; missing pixels are not a pass |
| Explicit asset/schema/startup error | Route directly to the named producer/owner and reproduce |
| Activation timeout during publication capture | Inspect ordinary capture/read traces and [resident-byte rules](engine-integration.md#publication-capture-and-resident-bytes) before extending the deadline |
| `render-system-no-camera` during startup | Correlate root activation and cleanup with the first App error; apply [scene-admission diagnosis](engine-integration.md#separate-graphics-readiness-from-scene-admission) |
| Black/missing/wrong output without a named cause | Start [RHI Debug](../../forgeax-engine-rhi-debug/SKILL.md), capture the real frame and inspect work/resources before shader edits |
| API exists but module/context initialization fails | Retain original native error, real device/context facts and emitted module identity |
| Reload appears unchanged | Confirm new bundle identity and realm; retire stale runtime handles |

When required environment evidence is unavailable, state exactly what is unverified
and continue independent implementation/tests. Keep the reproducer with an owner-level
fix. Mock contracts strengthen unit coverage but do not replace available native or
browser execution. Run only checks justified by the change and existing gates.

## Cost and adoption

Measure launch-to-first-completed-visible-frame and launch-to-usable-gameplay
separately. For UI, separate mutation/style/layout/raster/copy/upload/composition;
record viewport, fonts, node count and dirty area. Keep CPU/GPU/process/WASM memory
measurements labeled by producer and mark unavailable values unknown. Set numeric
budgets from fixed-device representative baselines before declaring full adoption;
recording a number is not proof that a budget passed.

## Publish the evidence that was actually executed

Keep the pristine publication manifest and entry hash separate from any diagnostic
entry. If a launcher prepends an additional observer after the initial clone,
record the final entry hash after that transformation and verify it against the
transferred archive. The initial clone receipt remains an intermediate stage;
its different entry hash is not evidence that the Engine's ordinary bytes changed.

Raw reports can contain AppIDs, account/device identity, native paths or user text.
Publish a deliberate projection of numerical evidence with source/report hashes;
preserve the private originals. Review actual screenshots for both rendering and
transient account/notification overlays before publication. A later clean screenshot
must keep its own timestamp and identity, not replace an earlier failing record.

Use revision-pinned image/data links in the PR and verify authenticated retrieval
against the original bytes. Links to temporary local artifacts or an expiring
preview alone are not durable PR evidence. Retain the exact CI head alongside the
rendering report's source; green checks on another revision are a separate result.

For binary GitHub evidence, preserve the response bytes through retrieval. The
observed `gh api --include` raw-media path returned HTTP 200 for a PNG but failed
with `transform: short source buffer`. A binary HTTP client recovered the intact
response using the existing `gh auth token` only in memory. Check both HTTP status
and SHA-256, never print or persist the token, and state when repository access is
required. HTTP 200 alone does not establish an intact downloaded image.

After a bounded diagnostic, restore the ordinary verified publication, its own
reverse mappings/settings and the task's process state. A forced fresh process
can establish recovery, but does not prove hide/show, hot Reload or in-place resource
retirement. When the user still needs the phone, preserve their current foreground.
