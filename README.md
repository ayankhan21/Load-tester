# Social Load Lab

A small PostgreSQL-backed social media backend used as a personal performance lab. The goal is to keep the stack intentionally simple so the database behavior is easy to inspect and optimize later.

## Requirements

- Node.js 20+
- npm
- Docker Desktop or Docker Engine
- k6 for the live traffic dashboard (install the CLI and make sure `k6` is available on your PATH; [installation guide](https://grafana.com/docs/k6/latest/set-up/install-k6/))

## Start PostgreSQL

```bash
docker compose up -d
```

This starts a local PostgreSQL instance on `localhost:5432` using a Docker volume for persistence.

## Install dependencies

```bash
npm install
```

## Configure environment

Copy the example environment file and adjust values if needed:

```bash
cp .env.example .env
```

The default values are:

```env
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=social
DB_USER=postgres
DB_PASSWORD=postgres

DB_POOL_MIN=2
DB_POOL_MAX=20
```

## Initialize the database schema

```bash
npm run db:init
```

## Seed a small dataset

```bash
npm run seed -- --users=1000 --posts=10000
```

## Seed the full dataset

```bash
npm run seed -- --users=50000 --posts=500000
```

## Start the API

```bash
npm run dev
```

The API will listen on `http://localhost:3000`.

## Run the live traffic test

With the API running, start the k6 traffic test:

```bash
npm run traffic:test
```

k6 opens its live web dashboard at `http://localhost:6000`. The test uses 20 virtual users for 30 seconds by default, with the same feed, post, like, and follow traffic mix as the original runner.

Pass k6 options after `--` to change the load:

```bash
npm run traffic:test -- --vus 100 --duration 60s
```

The previous TypeScript traffic runner remains available as `npm run traffic:legacy`.

## API endpoints

### Health

```bash
curl http://localhost:3000/health
```

### Feed

```bash
curl "http://localhost:3000/users/123/feed?limit=20"
```

### Create post

```bash
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -d '{"userId":123,"content":"Hello world"}'
```

### Like post

```bash
curl -X POST http://localhost:3000/posts/456/like \
  -H "Content-Type: application/json" \
  -d '{"userId":123}'
```

### Follow user

```bash
curl -X POST http://localhost:3000/users/123/follow/456
```

## Notes

- This project intentionally does not add Redis, Kafka, authentication, or ORM layers.
- The backend uses raw SQL through `pg` so query behavior stays explicit.
- The seed process is built for large dataset generation without doing one insert per row in a tight loop.
