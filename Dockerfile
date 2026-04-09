FROM node:lts-alpine AS build
RUN apk add --no-cache zstd tar && corepack enable pnpm
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ patches/
COPY shims/ shims/
COPY lib/package.json lib/
COPY scripts/ scripts/
RUN pnpm install --frozen-lockfile
COPY lib/ lib/
COPY tsconfig.json ./
RUN pnpm build && cd lib && npm pack --pack-destination /tmp

FROM node:lts-alpine AS runtime
RUN apk add --no-cache zstd \
  && corepack enable \
  && rm -rf /opt/yarn* /usr/local/lib/node_modules/yarn
COPY --from=build /tmp/coderaft-*.tgz /tmp/coderaft.tgz
RUN npm install -g /tmp/coderaft.tgz && rm /tmp/coderaft.tgz \
  && zstd -19 --rm /usr/local/bin/node -o /usr/local/bin/node.zst \
  && printf '#!/bin/sh\nset -e\nzstd -qd /usr/local/bin/node.zst -o /tmp/.node\nmv /tmp/.node /usr/local/bin/node\nchmod +x /usr/local/bin/node\nrm -f /usr/local/bin/node.zst\nexec /usr/local/bin/node "$@"\n' > /usr/local/bin/node \
  && chmod +x /usr/local/bin/node

FROM alpine:3.23
RUN apk add --no-cache bash zstd libstdc++ \
  && mkdir -p /data/workspace /data/home \
  && ln -s /data/home /root \
  && echo '{"type":"module"}' > /data/workspace/package.json \
  && printf 'import { createServer } from "node:http";\n\nconst server = createServer((req, res) => {\n  res.writeHead(200, { "Content-Type": "text/plain" });\n  res.end("Hello from CodeRaft!\\n");\n});\n\nserver.listen(3000, () => {\n  console.log("Server running at http://localhost:3000");\n});\n' > /data/workspace/index.ts
COPY --from=runtime /usr/local/ /usr/local/
VOLUME /data
EXPOSE 6063
CMD ["coderaft", "/data/workspace"]
