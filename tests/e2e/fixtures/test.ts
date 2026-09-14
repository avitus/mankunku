/**
 * Canonical test entrypoint for e2e specs.
 *
 * Always import { test, expect } from this file rather than '@playwright/test'
 * (or from ./auth for signed-in specs — it extends this same test). The
 * console-error guard is an AUTO fixture: every test fails on an unexpected
 * console.error or pageerror without naming `consoleCollector` (name it only
 * to read the collected output). A spec whose subject is a 404 page opts in
 * to that document's own 404 line with `test.use({ allowDocument404: true })`.
 */

export { test, expect, type ConsoleCollector } from './console-errors';
