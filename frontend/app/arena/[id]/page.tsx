"use client";
import { useEffect, useState, useCallback, use } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useWallet } from "@/lib/useWallet";
import {
  ROAST_ARENA_ABI, CONTRACT_ADDRESS,
  RoastState, STATE_LABEL, STATE_COLOR,
} from "@/lib/contract";
import { getRoastContent, submitContent, getChallengeContent, type RoastContent, type ChallengeContent } from "@/lib/api";
import { useCountdown, formatCountdown } from "@/lib/useCountdown";

// ─── Types ────────────────────────────────────────────────────────────────────
interface OnChainRoast {
  id: bigint;
  creator: string;
  openUntil: bigint;
  voteUntil: bigint;
  roastStake: bigint;
  voteStake: bigint;
  state: number;
  participantCount: bigint;
  totalVotes: bigint;
  roasterPool: bigint;
  voterPool: bigint;
  highestVotes: bigint;
  numWinners: bigint;
  winnerVoterCount: bigint;
}

function fmt(wei: bigint) {
  return parseFloat(ethers.formatEther(wei)).toFixed(4).replace(/\.?0+$/, "") + " ETH";
}

// ─── Phase banner ─────────────────────────────────────────────────────────────
// All timestamps passed here are already adjusted to real-time scale.
function PhaseBanner({
  state, openUntil, voteUntil,
}: { state: number; openUntil: number; voteUntil: number }) {
  const now = Math.floor(Date.now() / 1000);
  const effectiveState =
    state === RoastState.SETTLED || state === RoastState.CANCELLED ? state
    : now < openUntil ? RoastState.OPEN
    : RoastState.VOTING;

  const target = effectiveState === RoastState.OPEN ? openUntil : voteUntil;
  const secs   = useCountdown(target);
  const label  = STATE_LABEL[effectiveState];
  const color  = STATE_COLOR[effectiveState];

  const phaseText =
    effectiveState === RoastState.OPEN    ? "Roasters joining — drop your best roast below"
    : effectiveState === RoastState.VOTING  ? "Voting is LIVE — pick your favourite roaster"
    : effectiveState === RoastState.SETTLED ? "Arena settled — winners crowned"
    : "Arena cancelled — refunds available";

  return (
    <div className="skeuo-panel p-5 mb-6 flex items-center justify-between">
      <div>
        <div className={`text-xl font-bold ${color}`}>{label}</div>
        <div className="muted-text text-sm mt-1">{phaseText}</div>
      </div>
      {(effectiveState === RoastState.OPEN || effectiveState === RoastState.VOTING) && (
        <div className={`text-3xl font-bold tabular-nums ${secs < 30 ? "text-red-300 pulse-soft" : "text-slate-100"}`}>
          {formatCountdown(secs)}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ArenaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const roastId = parseInt(id, 10);

  const { address, signer, connect } = useWallet();

  const [roast, setRoast]               = useState<OnChainRoast | null>(null);
  const [participants, setParticipants]   = useState<string[]>([]);
  const [winners, setWinners]             = useState<string[]>([]);
  const [voteCounts, setVoteCounts]       = useState<Record<string, number>>({});
  const [contents, setContents]           = useState<RoastContent[]>([]);
  const [challengeContent, setChallengeContent] = useState<ChallengeContent | null>(null);
  const [myContent, setMyContent]         = useState("");
  const [hasJoined, setHasJoined]         = useState(false);
  const [hasVoted, setHasVoted]           = useState(false);
  const [iAmWinner, setIAmWinner]         = useState(false);
  const [iVotedRight, setIVotedRight]     = useState(false);
  const [claimedRoaster, setClaimedRoaster] = useState(false);
  const [claimedVoter, setClaimedVoter]   = useState(false);

  // blockOffset = blockTimestamp - realTimestamp (seconds).
  // Anvil timestamps can drift from system clock (e.g. after evm_increaseTime).
  // We subtract this offset from all on-chain timestamps before display so
  // countdowns reflect real elapsed time rather than blockchain elapsed time.
  const [blockOffset, setBlockOffset]     = useState(0);

  const [joining, setJoining]             = useState(false);
  const [voting, setVoting]               = useState<string | null>(null);
  const [settling, setSettling]           = useState(false);
  const [settled, setSettled]             = useState(false); // immediate hide after settle
  const [claiming, setClaiming]           = useState<"roaster"|"voter"|"refund"|null>(null);
  const [submittingContent, setSubmittingContent] = useState(false);
  const [error, setError]                 = useState("");
  const [txMsg, setTxMsg]                 = useState("");

  const getProvider = useCallback(() =>
    new ethers.JsonRpcProvider(
      process.env.NEXT_PUBLIC_MONAD_RPC || "https://testnet-rpc.monad.xyz"
    ), []);

  const readContract = useCallback(() =>
    new ethers.Contract(CONTRACT_ADDRESS, ROAST_ARENA_ABI as string[], getProvider()),
  [getProvider]);

  const loadChainData = useCallback(async () => {
    try {
      const provider = getProvider();
      const c = readContract();

      // Fetch current block timestamp alongside contract data.
      // This lets us correct any clock skew between Anvil and real time.
      const [r, pList, wList, latestBlock] = await Promise.all([
        c.getRoast(roastId),
        c.getParticipants(roastId),
        c.getWinners(roastId),
        provider.getBlock("latest"),
      ]);

      // Compute offset: how many seconds ahead of real time is the blockchain?
      const realNow = Math.floor(Date.now() / 1000);
      const chainNow = latestBlock ? Number(latestBlock.timestamp) : realNow;
      setBlockOffset(chainNow - realNow); // can be negative if chain is behind

      // ethers v6 returns readonly Result proxies — convert to plain JS before
      // setting as React state (React's reconciler may try to mutate index [0])
      const parts: string[] = Array.from(pList);
      const wins: string[]  = Array.from(wList);
      setRoast({
        id: r.id, creator: r.creator,
        openUntil: r.openUntil, voteUntil: r.voteUntil,
        roastStake: r.roastStake, voteStake: r.voteStake,
        state: r.state,
        participantCount: r.participantCount, totalVotes: r.totalVotes,
        roasterPool: r.roasterPool, voterPool: r.voterPool,
        highestVotes: r.highestVotes, numWinners: r.numWinners,
        winnerVoterCount: r.winnerVoterCount,
      });
      setParticipants(parts);
      setWinners(wins);

      if (parts.length > 0) {
        try {
          const counts: bigint[] = Array.from(await c.getVoteCounts(roastId, parts));
          const map: Record<string, number> = {};
          parts.forEach((addr: string, i: number) => {
            map[addr.toLowerCase()] = Number(counts[i]);
          });
          setVoteCounts(map);
        } catch {
          // Transient RPC inconsistency (QuickNode load balancing) — self-heals on next poll
        }
      }

      if (address) {
        // allSettled so one RPC hiccup doesn't crash the whole poll cycle
        const settled = await Promise.allSettled([
          c.hasJoined(roastId, address),
          c.hasVoted(roastId, address),
          c.isWinner(roastId, address),
          c.hasClaimedRoaster(roastId, address),
          c.hasClaimedVoter(roastId, address),
        ]);
        const val = <T,>(i: number, fallback: T): T =>
          settled[i].status === "fulfilled" ? (settled[i] as PromiseFulfilledResult<T>).value : fallback;
        const joined    = val(0, false);
        const voted     = val(1, false);
        const winner    = val(2, false);
        const clRoaster = val(3, false);
        const clVoter   = val(4, false);
        setHasJoined(joined);
        setHasVoted(voted);
        setIAmWinner(winner);
        setClaimedRoaster(clRoaster);
        setClaimedVoter(clVoter);

        if (voted) {
          const myVote: string = await c.votedFor(roastId, address);
          const votedForWinner: boolean = await c.isWinner(roastId, myVote);
          setIVotedRight(votedForWinner);
        }

        // If chain says settled, sync local flag too (handles page refreshes)
        if (Number(r.state) === RoastState.SETTLED || Number(r.state) === RoastState.CANCELLED) {
          setSettled(true);
        }
      }
    } catch (err) {
      // Suppress transient CALL_EXCEPTION errors from QuickNode load balancing —
      // they self-heal on the next poll cycle (every 4s). Log everything else.
      if ((err as { code?: string })?.code !== "CALL_EXCEPTION") {
        console.error("loadChainData:", err);
      }
    }
  }, [roastId, address, readContract, getProvider]);

  const loadContent = useCallback(async () => {
    try {
      const rows = await getRoastContent(roastId);
      setContents(rows);
    } catch { /* backend may not be running */ }
  }, [roastId]);

  const loadChallengeContent = useCallback(async () => {
    try {
      const data = await getChallengeContent(roastId);
      setChallengeContent(data);
    } catch { /* no challenge content set, or backend not running */ }
  }, [roastId]);

  useEffect(() => {
    loadChainData();
    loadContent();
    loadChallengeContent();
    const tid = setInterval(() => { loadChainData(); loadContent(); }, 4000);
    return () => clearInterval(tid);
  }, [loadChainData, loadContent, loadChallengeContent]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const writeContract = () => {
    if (!signer) throw new Error("No signer");
    return new ethers.Contract(CONTRACT_ADDRESS, ROAST_ARENA_ABI as string[], signer);
  };

  const handleJoin = async () => {
    if (!signer) { connect(); return; }
    if (!roast) return;
    setJoining(true); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.joinRoast(roastId, { value: roast.roastStake });
      setTxMsg(`Joining arena… (staking ${fmt(roast.roastStake)})`);
      await tx.wait();
      setTxMsg("Joined! Drop your roast below.");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Failed to join");
    } finally {
      setJoining(false);
    }
  };

  const handleSubmitContent = async () => {
    if (!address || !myContent.trim()) return;
    setSubmittingContent(true);
    try {
      await submitContent(roastId, address, myContent.trim());
      setMyContent("");
      await loadContent();
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to save roast content");
    } finally {
      setSubmittingContent(false);
    }
  };

  const handleVote = async (candidate: string) => {
    if (!signer) { connect(); return; }
    if (!roast) return;
    setVoting(candidate); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.vote(roastId, candidate, { value: roast.voteStake });
      setTxMsg(`Casting vote… (staking ${fmt(roast.voteStake)})`);
      await tx.wait();
      setTxMsg("Vote cast!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Vote failed");
    } finally {
      setVoting(null);
    }
  };

  const handleSettle = async () => {
    if (!signer) { connect(); return; }
    setSettling(true); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.settle(roastId);
      setTxMsg("Settling arena…");
      await tx.wait();
      setSettled(true); // immediately hide button — don't wait for next poll
      setTxMsg("Arena settled!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Settle failed");
    } finally {
      setSettling(false);
    }
  };

  const handleClaimRoaster = async () => {
    if (!signer) { connect(); return; }
    setClaiming("roaster"); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.claimRoasterReward(roastId);
      setTxMsg("Claiming roaster reward…");
      await tx.wait();
      setTxMsg("Roaster reward claimed!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Claim failed");
    } finally {
      setClaiming(null);
    }
  };

  const handleClaimVoter = async () => {
    if (!signer) { connect(); return; }
    setClaiming("voter"); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.claimVoterReward(roastId);
      setTxMsg("Claiming voter reward…");
      await tx.wait();
      setTxMsg("Voter reward claimed!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Claim failed");
    } finally {
      setClaiming(null);
    }
  };

  const handleClaimRefund = async () => {
    if (!signer) { connect(); return; }
    setClaiming("refund"); setError(""); setTxMsg("");
    try {
      const c = writeContract();
      const tx = await c.claimRefund(roastId);
      setTxMsg("Claiming refund…");
      await tx.wait();
      setTxMsg("Refund claimed!");
      await loadChainData();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 160) || "Refund failed");
    } finally {
      setClaiming(null);
    }
  };

  // ─── Derived state ─────────────────────────────────────────────────────────

  // On-chain timestamps in seconds (blockchain scale).
  const openUntil    = roast ? Number(roast.openUntil)  : 0;
  const voteUntil    = roast ? Number(roast.voteUntil)  : 0;
  const storedState  = roast ? roast.state : -1;

  // Adjust blockchain timestamps to real-time scale for display & state checks.
  // If blockOffset = 240 (chain is 4min ahead), subtracting it aligns to realNow.
  const openUntilReal = openUntil - blockOffset;
  const voteUntilReal = voteUntil - blockOffset;

  // Use real-time `now` against real-time-adjusted deadlines.
  const now = Math.floor(Date.now() / 1000);

  const effectiveState: RoastState =
    storedState === RoastState.SETTLED || storedState === RoastState.CANCELLED
      ? storedState
      : now < openUntilReal ? RoastState.OPEN
      : RoastState.VOTING;

  const canJoin   = effectiveState === RoastState.OPEN && !hasJoined;
  const canVote   = effectiveState === RoastState.VOTING && !hasVoted;
  const canSettle = !settled &&
    now >= voteUntilReal &&
    storedState !== RoastState.SETTLED &&
    storedState !== RoastState.CANCELLED &&
    (hasJoined || hasVoted);

  const isSettled   = storedState === RoastState.SETTLED;
  const isCancelled = storedState === RoastState.CANCELLED;

  const contentByAuthor: Record<string, RoastContent> = {};
  contents.forEach((c) => { contentByAuthor[c.author.toLowerCase()] = c; });

  const myAddr    = address?.toLowerCase() ?? "";
  const alreadyPosted = !!contentByAuthor[myAddr];
  // Only show the roast textarea if joined, OPEN window, and NOT yet submitted.
  const canPost   = hasJoined && effectiveState === RoastState.OPEN && !alreadyPosted;

  const maxVotes  = Math.max(1, ...Object.values(voteCounts));

  const roasterShare = roast && roast.numWinners > 0n
    ? roast.roasterPool / roast.numWinners
    : 0n;
  const voterShare = roast && roast.winnerVoterCount > 0n
    ? roast.voterPool / roast.winnerVoterCount
    : 0n;

  if (!roast) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center text-zinc-600">
          Loading arena #{roastId}…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">

        <Link href="/" className="muted-text hover:text-slate-100 text-sm mb-6 inline-block transition-colors">
          ← All Arenas
        </Link>

        <h1 className="text-3xl font-bold mb-1 tracking-tight">Arena <span className="brand-accent">#{roastId}</span></h1>
        <p className="muted-text text-sm mb-1">
          {Number(roast.participantCount)} roasters · {Number(roast.totalVotes)} votes
        </p>
        <p className="muted-text text-xs mb-6">
          Roaster stake: {fmt(roast.roastStake)} · Vote stake: {fmt(roast.voteStake)}
        </p>

        {/* Challenge subject — what this arena is about */}
        {challengeContent && (
          <div className="skeuo-panel p-5 mb-6">
            <p className="section-title mb-2">What we&apos;re roasting</p>
            <h2 className="text-white font-bold text-xl mb-2">{challengeContent.title}</h2>
            {challengeContent.description && (
              <p className="text-zinc-400 text-sm mb-3 whitespace-pre-wrap">{challengeContent.description}</p>
            )}
            {challengeContent.media_url && (() => {
              const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
              const src  = challengeContent.media_url.startsWith("/")
                ? `${BASE}${challengeContent.media_url}`
                : challengeContent.media_url;
              return /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(src) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt="Challenge media"
                  className="max-h-64 rounded-lg object-contain border border-zinc-700"
                />
              ) : (
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-orange-400 hover:text-orange-300 text-sm underline break-all"
                >
                  {src}
                </a>
              );
            })()}
          </div>
        )}

        {/* Pass real-time-adjusted timestamps so countdown shows actual remaining time */}
        <PhaseBanner state={storedState} openUntil={openUntilReal} voteUntil={voteUntilReal} />

        {/* Pool sizes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <div className="skeuo-panel-soft p-4 text-center">
            <div className="section-title mb-1">Roaster Pool</div>
            <div className="text-white font-bold text-lg">{fmt(roast.roasterPool)}</div>
            {isSettled && roast.numWinners > 0n && (
              <div className="muted-text text-xs mt-1">{fmt(roasterShare)} / winner</div>
            )}
          </div>
          <div className="skeuo-panel-soft p-4 text-center">
            <div className="section-title mb-1">Voter Pool</div>
            <div className="text-white font-bold text-lg">{fmt(roast.voterPool)}</div>
            {isSettled && roast.winnerVoterCount > 0n && (
              <div className="muted-text text-xs mt-1">{fmt(voterShare)} / winner voter</div>
            )}
          </div>
        </div>

        {/* Winner banner */}
        {isSettled && winners.length > 0 && (
          <div className="skeuo-panel p-5 mb-6">
            <div className="text-orange-400 text-xs uppercase tracking-widest mb-2 text-center">
              {winners.length === 1 ? "Winner" : `${winners.length}-Way Tie`}
            </div>
            {winners.map((w) => (
              <div key={w} className="text-white font-bold text-sm break-all text-center">{w}</div>
            ))}
            <div className="text-orange-400 text-sm mt-2 text-center">
              {Number(roast.highestVotes)} vote{Number(roast.highestVotes) !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="skeuo-panel p-5 mb-6 text-center text-red-300">
            Arena cancelled — not enough participants or no votes cast.
          </div>
        )}

        {error  && <p className="text-red-300 text-sm mb-4">{error}</p>}
        {txMsg  && <p className="text-green-300 text-sm mb-4">{txMsg}</p>}

        {/* Claim / Refund buttons */}
        {isSettled && iAmWinner && !claimedRoaster && (
          <button onClick={handleClaimRoaster} disabled={claiming !== null}
            className="w-full skeuo-button text-white font-bold py-3 mb-3">
            {claiming === "roaster" ? "Claiming…" : `Claim Roaster Reward (${fmt(roasterShare)})`}
          </button>
        )}
        {isSettled && iAmWinner && claimedRoaster && (
          <p className="text-center text-yellow-600 text-sm mb-3">Roaster reward already claimed.</p>
        )}

        {isSettled && hasVoted && iVotedRight && !claimedVoter && (
          <button onClick={handleClaimVoter} disabled={claiming !== null}
            className="w-full skeuo-button skeuo-button-success text-white font-bold py-3 mb-3">
            {claiming === "voter" ? "Claiming…" : `Claim Voter Reward (${fmt(voterShare)})`}
          </button>
        )}
        {isSettled && hasVoted && !iVotedRight && (
          <p className="text-center text-zinc-600 text-sm mb-3">You backed the losing side — no voter reward.</p>
        )}
        {isSettled && hasVoted && iVotedRight && claimedVoter && (
          <p className="text-center text-green-700 text-sm mb-3">Voter reward already claimed.</p>
        )}

        {isCancelled && (hasJoined || hasVoted) && (
          <button onClick={handleClaimRefund} disabled={claiming !== null}
            className="w-full skeuo-button-secondary disabled:opacity-50 text-white font-bold py-3 mb-3">
            {claiming === "refund" ? "Claiming refund…" : "Claim Refund"}
          </button>
        )}

        {/* Join button */}
        {canJoin && (
          <button onClick={handleJoin} disabled={joining}
            className="w-full skeuo-button text-white font-bold py-3 mb-6">
            {joining ? "Joining…" : `Join Arena as Roaster (stake ${fmt(roast.roastStake)})`}
          </button>
        )}

        {/* Roast content — shown only if joined, OPEN window, and not yet submitted */}
        {canPost && (
          <div className="mb-6 skeuo-panel-soft p-4">
            <p className="soft-text text-sm mb-3">Your roast (saved off-chain, linked to your wallet):</p>
            <textarea
              value={myContent}
              onChange={(e) => setMyContent(e.target.value)}
              maxLength={500} rows={3}
              placeholder="Drop your roast here..."
              className="w-full input-surface p-3 text-sm resize-none"
            />
            <div className="flex justify-between items-center mt-2">
              <span className="muted-text text-xs">{myContent.length}/500</span>
              <button onClick={handleSubmitContent} disabled={submittingContent || !myContent.trim()}
                className="skeuo-button-secondary disabled:opacity-50 text-white text-sm px-4 py-2">
                {submittingContent ? "Saving…" : "Save Roast"}
              </button>
            </div>
          </div>
        )}

        {/* If already posted, show the submitted content with a note */}
        {hasJoined && effectiveState === RoastState.OPEN && alreadyPosted && (
          <div className="mb-6 skeuo-panel-soft p-4">
            <p className="section-title mb-2">Your roast (submitted)</p>
            <p className="soft-text text-sm">{contentByAuthor[myAddr].content}</p>
          </div>
        )}

        {/* Settle button */}
        {canSettle && (
          <button onClick={handleSettle} disabled={settling}
            className="w-full skeuo-button-secondary text-white font-bold py-3 mb-6">
            {settling ? "Settling…" : "Settle Arena (Voting Closed)"}
          </button>
        )}

        {/* Participants / vote cards */}
        <h2 className="section-title mb-3">Roasters</h2>

        {participants.length === 0 ? (
          <p className="muted-text text-sm">No participants yet.</p>
        ) : (
          <div className="space-y-4">
            {participants.map((addr) => {
              const lower   = addr.toLowerCase();
              const content = contentByAuthor[lower];
              const votes   = voteCounts[lower] ?? 0;
              const isWin   = winners.some((w) => w.toLowerCase() === lower);
              const pct     = Math.round((votes / maxVotes) * 100);
              const isMe    = address?.toLowerCase() === lower;
              const canVoteThis = canVote && !isMe;

              return (
                <div key={addr}
                  className={`skeuo-panel-soft p-4 ${isWin ? "ring-1 ring-orange-400/50" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-slate-100 text-sm font-bold truncate">
                          {isMe ? "You" : `${addr.slice(0, 6)}…${addr.slice(-4)}`}
                        </span>
                        {isWin && <span className="text-orange-300 text-xs font-bold">WINNER</span>}
                      </div>

                      {content ? (
                        <p className="soft-text text-sm leading-relaxed">{content.content}</p>
                      ) : (
                        <p className="muted-text text-sm italic">No roast submitted yet…</p>
                      )}

                      {(effectiveState === RoastState.VOTING || isSettled) && (
                        <div className="mt-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-800/80 rounded-full h-1.5">
                              <div className="bg-orange-400 h-1.5 rounded-full transition-all"
                                style={{ width: `${pct}%` }} />
                            </div>
                            <span className="soft-text text-xs w-12 text-right">
                              {votes} vote{votes !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {canVoteThis && (
                      <button onClick={() => handleVote(addr)} disabled={voting !== null}
                        className="shrink-0 skeuo-button-secondary disabled:opacity-50 text-white text-sm px-4 py-2 transition-all">
                        {voting === addr ? "Voting…" : `Vote (${roast ? fmt(roast.voteStake) : "…"})`}
                      </button>
                    )}
                    {canVote && isMe && (
                      <span className="shrink-0 muted-text text-xs py-2">can&apos;t self-vote</span>
                    )}
                    {hasVoted && effectiveState === RoastState.VOTING && (
                      <span className="shrink-0 text-green-300 text-xs py-2">voted</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}






