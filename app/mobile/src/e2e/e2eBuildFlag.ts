/**
 * Build-time switch for the E2E-only test seams (issue #932).
 *
 * The Maestro harness drives the real app on an emulator, but two inputs a
 * user supplies cannot be produced there: a physical QR code held up to the
 * camera, and a real photo from the camera/gallery. Those screens therefore
 * render one deterministic "simulate" control each, and those controls must
 * never appear in a user-facing build.
 *
 * The switch is a plain source constant rather than an environment variable
 * read at runtime, deliberately. `process.env.EXPO_PUBLIC_*` is inlined by
 * Babel while bundling; when that inlining does not happen for a release APK
 * built through Gradle, the expression survives as a runtime `process.env`
 * lookup that resolves to `undefined` in a production bundle. The seams would
 * then silently disappear and the E2E job would fail with a UI that looks
 * correct but cannot be driven. A source constant is baked in by the same
 * compiler pass as any other literal, so `e2e/enable-e2e-build.js` can flip
 * it for an E2E build (see `.github/workflows/mobile-e2e.yml`) and there is
 * no bundler configuration that can lose it.
 *
 * The committed value is `false`: production builds always ship the seams
 * disabled. Never commit this file with the flag flipped to `true`.
 */
export const E2E_BUILD_ENABLED: boolean = false;
