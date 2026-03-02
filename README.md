# 🔥 RoastArena

**Onchain roast battles on Monad Testnet.** Create an arena, stake MON, drop your best burn, and let the crowd vote. Losing voters fund the winners — prediction market meets roast comedy.

Live at: (https://roast-on-chain.vercel.app/) · Contract: [`0xAa9381a6C0717aF8345C36477D09B76CeF2A05F4`](https://testnet.monadexplorer.com/address/0xAa9381a6C0717aF8345C36477D09B76CeF2A05F4) on Monad Testnet

Built by Duvesh & Sankalp
---

## How It Works

| Phase | Duration | What happens |
|---|---|---|
| **OPEN** | 3 min | Roasters pay `roastStake` to join & submit their roast |
| **VOTING** | 4 min | Anyone pays `voteStake` to vote for their favourite roaster |
| **SETTLED** | — | Winners split the roaster pool; voters who backed a winner split the voter pool |
| **CANCELLED** | — | Triggered if < 2 roasters joined or nobody voted — full refunds issued |

**The prediction-market twist:** Losing voters' stakes flow to the winners' voters. Back the wrong roaster and your stake funds those who backed the right one.

---

## Project Structure

```
roast-arena/
├── src/
│   └── RoastArena.sol          # Solidity smart contract
├── script/
│   ├── Deploy.s.sol            # Foundry deployment script
│   └── Simulate.s.sol          # Full end-to-end simulation (7 scenarios)
├── test/
│   └── RoastArena.t.sol        # Forge test suite (~765 lines)
├── backend/                    # Node.js / Express API
│   ├── index.js                # Routes & middleware
│   ├── db.js                   # Schema + Turso helpers
│   ├── listener.js             # On-chain event listener
│   └── storage.js              # File upload handler (local / cloud-switchable)
├── frontend/                   # Next.js 16 app
│   ├── app/
│   │   ├── page.tsx            # Home — arena listing + create form
│   │   ├── arena/[id]/page.tsx # Arena detail — join / vote / claim
│   │   └── profile/[address]/page.tsx
│   ├── components/Navbar.tsx
│   └── lib/
│       ├── contract.ts         # ABI, addresses, chain config, enums
│       ├── useWallet.ts        # Wallet hook (ethers.js)
│       ├── api.ts              # Backend API client
│       └── useCountdown.ts
└── foundry.toml
```

---

## Smart Contract

**`src/RoastArena.sol`** — Solidity ^0.8.24, deployed with Foundry

### State machine

```
OPEN (0)  ──3 min──▶  VOTING (1)  ──4 min──▶  SETTLED (2)
                                         └──▶  CANCELLED (3)
```

State is computed lazily from `block.timestamp` against the stored deadlines — no keeper needed.

### Key write functions

| Function | Who can call | Description |
|---|---|---|
| `createRoast(roastStake, voteStake)` | Anyone | Creates arena; creator auto-joins, pays `roastStake` |
| `joinRoast(roastId)` | Anyone (OPEN phase) | Joins as roaster, pays exact `roastStake` |
| `vote(roastId, candidate)` | Anyone (VOTING phase) | Casts one vote, pays `voteStake`; no self-votes |
| `settle(roastId)` | Roasters or voters | Finalises arena, determines winners |
| `claimRoasterReward(roastId)` | Winners | Claim equal share of roaster pool |
| `claimVoterReward(roastId)` | Voters who backed a winner | Claim share of voter pool |
| `claimRefund(roastId)` | Any participant | Refund from CANCELLED arena |

### Reward math

```
roasterShare = roasterPool / numWinners

voterPool    = sum of all voteStakes
voterShare   = voterPool / winnerVoterCount
             = voterPool / (numWinners × highestVotes)
```

> Example: 3 voters stake 0.5 ETH each → pool = 1.5 ETH. Alice wins with 2 votes.
> Two Alice-voters each receive 1.5 / 2 = **0.75 ETH** (1.5× their stake). Bob's voter loses.

### Security

- Pull-payment pattern (reentrancy safe) on all claim functions
- Custom errors for gas efficiency (`RoastNotFound`, `AlreadyClaimed`, `NotInWindow`, …)
- `exists()` modifier guards all view functions
- Integer division — dust stays in contract

---

## Backend

**Node.js + Express 5, Turso (SQLite) database**

### API routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/roasts?limit=20` | Recent arenas, newest first |
| `GET` | `/roast/:id` | Single arena metadata |
| `GET` | `/roast/:id/content` | All roast submissions (with profiles) |
| `POST` | `/roast/:id/content` | Submit roast text (max 500 chars, one per wallet) |
| `GET` | `/roast/:id/challenge` | What's being roasted (title, description, media) |
| `POST` | `/roast/:id/challenge` | Set challenge content |
| `POST` | `/upload` | Upload image (JPEG/PNG/GIF/WebP, max 10 MB) |
| `GET` | `/profile/:address` | User profile |
| `POST` | `/profile` | Upsert profile (username, avatar, bio) |
| `GET` | `/profile/:address/roasts` | Roast history for an address |

### Database schema

```sql
profiles          (address PK, username, avatar_url, bio, updated_at)
roast_index       (roast_id PK, creator, state, open_until, vote_until, pools, …)
participant_index (roast_id, address — composite PK)
roast_content     (id, roast_id, author UNIQUE per roast, content, created_at)
challenge_content (roast_id PK, creator, title, description, media_url, created_at)
listener_state    (key PK, value — persists lastPolledBlock across restarts)
```

### Event listener

Polls `eth_getLogs` every 5 s in 100-block chunks (Monad RPC limit).
Persists `lastPolledBlock` to DB so restarts resume from where they left off.
Cold-start lookback: last 200 blocks.

Events handled: `RoastCreated` · `ParticipantJoined` · `VoteCast` · `RoastSettled` · `RoastCancelled`

---

## Frontend

**Next.js 16.1.6 · React 19 · ethers.js v6 · Tailwind CSS 4**

### Pages

| Route | Description |
|---|---|
| `/` | Arena list with live countdown (Roast / Vote phase labels), create-arena form |
| `/arena/[id]` | Join, submit roast text, vote, settle, claim rewards; live vote bars |
| `/profile/[address]` | Edit username/bio/avatar; view roast history |

### Create-arena form

- Challenge title (required, max 100 chars) — what everyone is roasting
- Description (optional, max 500 chars)
- Media: **Text only** or **Image upload** (stored via backend, swappable to cloud)
- Roaster stake & vote stake amounts
- Transaction fires on-chain → off-chain content is submitted after confirmation

### Wallet integration (`lib/useWallet.ts`)

- Auto-connects if wallet already approved the site
- Detects wrong network and offers one-click switch
- Adds Monad Testnet to MetaMask if not already configured
- Reacts to account and chain changes

### RPC resilience

- `Promise.allSettled` for all per-user view calls — one node hiccup doesn't break the whole poll
- `getVoteCounts` wrapped in its own try-catch (transient `CALL_EXCEPTION` from QuickNode load balancing on fresh arenas self-heals on the next 4 s poll)
- Block-timestamp offset correction — aligns chain timestamps to real-world clock for accurate countdowns

---

## Local Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Node.js ≥ 20
- A Monad Testnet wallet with some MON ([faucet](https://faucet.monad.xyz))

### 1. Smart contract

```bash
# Build
forge build

# Run tests
forge test -vv

# Run full simulation
forge script script/Simulate.s.sol --fork-url https://testnet-rpc.monad.xyz -vv

# Deploy to Monad Testnet
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### 2. Backend

```bash
cd backend
cp .env.example .env   # fill in your values
npm install
node index.js
# → http://localhost:3001
```

**`backend/.env`**
```
CONTRACT_ADDRESS=0xAa9381a6C0717aF8345C36477D09B76CeF2A05F4
MONAD_RPC=https://testnet-rpc.monad.xyz
PORT=3001
TURSO_DATABASE_URL=libsql://<your-db>.turso.io
TURSO_AUTH_TOKEN=<your-token>
```

### 3. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # fill in your values
npm install
npm run dev
# → http://localhost:3000
```

**`frontend/.env.local`**
```
NEXT_PUBLIC_CONTRACT_ADDRESS=0xAa9381a6C0717aF8345C36477D09B76CeF2A05F4
NEXT_PUBLIC_MONAD_RPC=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_CHAIN_ID=10143
```

---

## Deployment (Production)

| Layer | Hosted on |
|---|---|
| Smart contract | Monad Testnet |
| Backend API | Render (Node service) |
| Frontend | Vercel / any static host |
| Database | Turso (edge SQLite) |
| File uploads | Local `uploads/` folder (swap `backend/storage.js` for S3/R2/Cloudinary) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity ^0.8.24, Foundry |
| Blockchain | Monad Testnet (chain ID 10143) |
| Backend | Node.js, Express 5, ethers.js v6 |
| Database | Turso (libSQL / SQLite) |
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Web3 client | ethers.js v6, MetaMask |
| File storage | Local (pluggable to cloud) |

---

## Simulation Scenarios

`script/Simulate.s.sol` covers seven end-to-end flows against a live fork:

1. **Happy path** — Alice wins, winner voters rewarded
2. **Only creator** — CANCELLED, refunded
3. **No votes** — CANCELLED, roasters refunded
4. **Three-way tie** — pools split equally among all three
5. **Prediction market** — losing voter stakes redistributed to Alice's backers
6. **Roaster also votes** — roaster pays extra stake to vote
7. **Revert edge cases** — validates all custom errors fire correctly
