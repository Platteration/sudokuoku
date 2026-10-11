# Dependency security review — PR #11

Reviewed the October 10, 2026 audit against PR head e1cb8bf and its installed lockfile. The 22 reported vulnerable package entries (15 high, 7 moderate) originate from three advisories; counts include affected ancestor packages, not 22 independent flaws.

## Applied fix

Override only `xcode`'s `uuid` dependency from 7.0.3 to 11.1.1, fixing [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Xcode 3.0.1 declares `^7.0.3`, so this is a deliberate major-version override. Its only UUID API call is CommonJS `require('uuid').v4()` in `lib/pbxProject.js`; 11.1.1 preserves that API and CommonJS support. The affected v3/v5/v6 buffer APIs are not called by Xcode. A smoke check through Xcode's actual `generateUuid()` generated 1,000 unique uppercase 24-character IDs using an empty project object graph. This does not replace a signed native build.

The override is scoped to Xcode rather than every consumer. Remove it when upstream Xcode uses a patched UUID release. Expo, React Native, Vitest and all other locked package versions are unchanged.

## Dependency paths and exposure

| Package | Locked version after fix | Dependency path / observed use | Exposure assessment |
| --- | --- | --- | --- |
| braces | 3.0.3 | Expo / React Native CLI → Metro → metro-file-map → micromatch 4.0.8 → braces | Node build/development file watching and glob processing. Deeply nested attacker-controlled patterns can exhaust the stack. No app import found in exported web/Android source maps. |
| node-forge | 1.4.0 | Expo → @expo/cli → @expo/code-signing-certificates → node-forge; CLI also imports it for iOS signing utilities | Certificate/signature tooling. Malformed RSA PKCS#1 v1.5 signature verification is affected. These paths warrant upstream remediation; this review does not establish that the vulnerable verification function is invoked by every signing operation. No app import found in exported web/Android source maps. |
| uuid | 11.1.1 | Expo configuration/prebuild plugins → xcode 3.0.1 → uuid | iOS project generation, using v4 only. Patched via the scoped override. No app import found in exported web/Android source maps. |

Expo and React Native declare tooling in their regular dependency trees, so `npm audit --omit=dev` still reports the remaining 15 high entries. The npm production dependency category is not proof that code executes in the shipped app. Conversely, source-map absence establishes only absence from these tested bundles, not safety of every native build, update-signing service or developer workflow.

## Remaining upstream advisories

- [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): audit affected range `<=3.0.3`; registry latest is 3.0.3.
- [node-forge GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): audit affected range `<=1.4.0`; registry latest is 1.4.0.

No patched published version was available for either package at review time. Do not run `npm audit fix --force`: its proposed Expo 44.0.6 downgrade disrupts SDK 57 compatibility and does not constitute an appropriate fix. No audit exceptions or severity reductions were added. The high-severity audit gate remains failing.

Recheck both advisories and package releases, then update the lockfile within supported parent ranges and repeat checks. If patches require incompatible Metro/Expo/React Native changes, perform a coordinated SDK upgrade with platform testing. Until then, avoid untrusted build configuration/glob patterns and treat certificate inputs used by signing tooling as security-sensitive. Resolve or explicitly assess these remaining tooling risks before store release.

## Verification

- Normal frozen `npm ci` passed with the override and refreshed lockfile.
- `npm run check`: typecheck passed; 129 tests in 9 files passed.
- Web and Android exports passed with `CI=1 EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1`, `--max-workers 2 --source-maps`.
- Source-map inspection found none of braces, micromatch, node-forge, uuid or xcode in either export.
- Xcode CommonJS UUID smoke check passed as described above.
- Full `npm audit --json`: 15 high, 0 moderate, 0 critical (previously 22 total). `npm audit --omit=dev --json` reports the same 15 high. Both return nonzero due to unresolved advisories.
- Local verification used Node 24.19.0 / npm 11.9.0; GitHub CI uses Node 22 and must validate the pushed commit independently.

Physical devices, signed native builds and code-signing verification were not tested. The independent GitHub Pages activation/deployment issue is unchanged.
