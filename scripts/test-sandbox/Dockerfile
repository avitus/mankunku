# Keep browsers in sync with the resolved lockfile, supplied by test-sandbox.mjs.
ARG PLAYWRIGHT_VERSION
FROM node:26.5.1-bookworm-slim AS node
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
COPY --from=node /usr/local/ /usr/local/
WORKDIR /workspace
# Fixtures intercept this reserved domain. No real backend or credentials enter tests.
ENV PUBLIC_SUPABASE_URL=https://mankunku-test.supabase.invalid \
    PUBLIC_SUPABASE_ANON_KEY=mankunku-test-anon-key
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx svelte-kit sync && mkdir -p test-results playwright-report
ENV CI=1 MANKUNKU_TEST_SANDBOX=1
