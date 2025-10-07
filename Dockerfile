FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci || npm install --no-audit --no-fund
COPY tsconfig.json .
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/package.json ./
COPY --from=base /app/dist ./dist
COPY bin ./bin
RUN adduser -D -h /app nodeuser && chown -R nodeuser:nodeuser /app
USER nodeuser
EXPOSE 3000
CMD ["node", "dist/cli.js", "serve", "--port", "3000"]

