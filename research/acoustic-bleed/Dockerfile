FROM node:26.5.1-bookworm-slim AS node
FROM python:3.12-slim
RUN apt-get update -qq && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
RUN pip install --no-cache-dir numpy==2.2.6 scipy==1.15.3
COPY . .
ENV OPENBLAS_NUM_THREADS=1
CMD ["sh", "-c", "python research/acoustic-bleed/server.py & exec npx vite --config research/acoustic-bleed/vite.config.ts"]
