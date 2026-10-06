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

## Compare single and cluster mode

Run each API mode in its own terminal:

```bash
npm run dev
```

```bash
npm run dev:cluster
```

The regular server uses one Node.js process on port `3000`. Cluster mode starts up to four Node.js workers on port `3001` and divides the configured database pool limit across them. Run the same load against either listener:

```bash
node ./scripts/run-k6.js --mode=single --vus=100 --duration=60s
node ./scripts/run-k6.js --mode=cluster --vus=100 --duration=60s
```

Results append to `traffic-metrics.txt` or `traffic-metrics-cluster-mode.txt` according to the mode.

Example results from one local 60-second run:

| VUs | Single RPS | Cluster RPS | Single p95 | Cluster p95 |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 104.96 | 112.32 | 15.72 ms | 16.27 ms |
| 200 | 153.73 | 218.26 | 25.78 ms | 23.24 ms |
| 500 | 335.61 | 321.43 | 272.33 ms | 293.06 ms |
| 1,000 | 363.70 | 356.43 | 1,353.86 ms | 2,840.38 ms |
| 2,000 | 382.05 | 373.87 | 3,702.29 ms | 5,174.83 ms |
| 5,000 | 446.10 | 427.54 | 10,708.54 ms | 11,988.19 ms |

These measurements are specific to the machine and database state used for the run; use them as an example, not a capacity guarantee.

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
