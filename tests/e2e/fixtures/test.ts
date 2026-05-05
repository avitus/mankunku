/**
 * Canonical test entrypoint for e2e specs.
 *
 * Always import { test, expect } from this file rather than '@playwright/test'.
 * It composes the project's fixtures (console-error capture, and later auth
 * + audio mocks) into a single extended test object.
 */

export { test, expect, type ConsoleCollector } from './console-errors';
