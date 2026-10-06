# Social Load Lab

A PostgreSQL-backed social API and k6 performance-testing lab.

## Quick start

Requirements: Node.js 20+, npm, and Docker Desktop (or Docker Engine with Compose).

```bash
git clone https://github.com/ayankhan21/Load-tester.git
cd Load-tester
npm install
npm run dev
```

On first run, `npm run dev` starts PostgreSQL, creates the schema, and seeds the default dataset. It reuses existing data on later runs. The API is at `http://localhost:3000`.

Default settings work without a `.env` file. Copy `.env.example` to `.env` only if you want to override them.

## Run a traffic test

With the API running, use:

```bash
npm run traffic:test
```

The k6 image is run by Docker, so no separate k6 installation is needed. The live dashboard is at `http://localhost:6000`. The default test runs 20 virtual users for 30 seconds.

Change the load with k6 options:

```bash
node ./scripts/run-k6.js --vus=100 --duration=60s
```

## Database and data

PostgreSQL runs on `localhost:5432` with data stored in a Docker volume. To start or stop it separately:

```bash
docker compose up -d postgres
docker compose down
```

The default seed contains 5,000 users and 50,000 posts, plus follows and likes. To add more seed data manually:

```bash
npm run seed -- --users=1000 --posts=10000
```

## API

- `GET /health`
- `GET /users/:userId/feed?limit=20`
- `POST /posts`
- `POST /posts/:postId/like`
- `POST /users/:userId/follow/:targetUserId`
