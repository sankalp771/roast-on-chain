"use client";
import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useWallet } from "@/lib/useWallet";
import { ROAST_ARENA_ABI, CONTRACT_ADDRESS } from "@/lib/contract";
import { getRecentRoastsFromDB, submitChallengeContent, uploadMedia, type RoastIndex } from "@/lib/api";
import { useCountdown, formatCountdown } from "@/lib/useCountdown";

function Countdown({ openUntil, voteUntil, state }: { openUntil: number; voteUntil: number; state: string }) {
  const now = Math.floor(Date.now() / 1000);
  const isFinished = state === "SETTLED" || state === "CANCELLED";
  const inRoastWindow = !isFinished && now < openUntil;
  const target = isFinished ? 0 : inRoastWindow ? openUntil : voteUntil;
  const secs = useCountdown(target);

  if (isFinished) return <span className="muted-text">-</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`text-xs font-semibold uppercase tracking-wide ${inRoastWindow ? "text-orange-500" : "text-yellow-400"}`}>
        {inRoastWindow ? "Roast" : "Vote"}
      </span>
      <span className={secs < 30 ? "text-red-300 pulse-soft" : "text-slate-300"}>
        {formatCountdown(secs)}
      </span>
    </span>
  );
}

export default function Home() {
  const { signer, isWrongNetwork, connect, switchNetwork } = useWallet();
  const [roasts, setRoasts]       = useState<RoastIndex[]>([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [roastStake, setRoastStake]       = useState("0.01");
  const [voteStake, setVoteStake]         = useState("0.005");
  const [challengeTitle, setChallengeTitle]   = useState("");
  const [challengeDesc, setChallengeDesc]     = useState("");
  const [mediaType, setMediaType]             = useState<"text" | "image">("text");
  const [mediaFile, setMediaFile]             = useState<File | null>(null);
  const [mediaPreview, setMediaPreview]       = useState<string | null>(null);
  const [error, setError]                 = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await getRecentRoastsFromDB(20);
      setRoasts(rows);
    } catch {
      setError("Could not load arenas — is the backend running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const handleCreate = async () => {
    if (!signer) { connect(); return; }
    if (isWrongNetwork) { switchNetwork(); return; }

    const roastWei = ethers.parseEther(roastStake || "0");
    const voteWei  = ethers.parseEther(voteStake  || "0");
    if (roastWei === 0n || voteWei === 0n) {
      setError("Both stake amounts must be > 0");
      return;
    }
    if (!challengeTitle.trim()) {
      setError("Tell everyone what they're roasting");
      return;
    }

    setCreating(true);
    setError("");
    try {
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ROAST_ARENA_ABI as string[], signer);
      const tx = await contract.createRoast(roastWei, voteWei, { value: roastWei });
      const receipt = await tx.wait();
      const iface = new ethers.Interface(ROAST_ARENA_ABI as string[]);
      let roastId: string | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "RoastCreated") { roastId = parsed.args.roastId.toString(); break; }
        } catch { /* skip non-matching logs */ }
      }
      if (roastId) {
        const addr = await signer.getAddress();
        let mediaUrl = "";
        if (mediaType === "image" && mediaFile) {
          try { mediaUrl = await uploadMedia(mediaFile); } catch { /* non-fatal */ }
        }
        await submitChallengeContent(
          parseInt(roastId),
          addr,
          challengeTitle.trim(),
          challengeDesc.trim(),
          mediaUrl,
        ).catch(() => { /* non-fatal — arena still works without it */ });
        window.location.href = `/arena/${roastId}`;
      } else {
        load();
      }
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 120) || "Transaction failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 sm:py-10">
        <div className="skeuo-panel text-center mb-8 sm:mb-10 px-6 py-8">
          <h1 className="text-4xl sm:text-5xl font-bold mb-3 tracking-tight">
            <span className="brand-accent">Roast</span>Arena
          </h1>
          <p className="soft-text text-base sm:text-lg">
            3 min to roast. 4 min to vote. Chain decides the winner.
          </p>
        </div>

        {/* Create button / form */}
        <div className="flex flex-col items-center mb-10 gap-4">
          {!showForm ? (
            <button
              onClick={() => { if (!signer) { connect(); } else { setShowForm(true); } }}
              className="skeuo-button text-white font-bold text-lg px-8 py-4 w-full max-w-md"
            >
              + Create New Arena
            </button>
          ) : (
            <div className="skeuo-panel p-6 w-full max-w-md space-y-4">
              <h3 className="text-slate-100 font-bold text-lg">Create Arena</h3>

              <label className="block">
                <span className="text-zinc-400 text-sm">What are we roasting? <span className="text-orange-500">*</span></span>
                <input
                  type="text"
                  maxLength={100}
                  placeholder="e.g. My NFT project, this tweet, this dev..."
                  value={challengeTitle}
                  onChange={(e) => setChallengeTitle(e.target.value)}
                  className="input-surface mt-1 w-full px-3 py-2 placeholder:text-slate-500"
                />
                <span className="text-zinc-600 text-xs">{challengeTitle.length}/100</span>
              </label>

              <label className="block">
                <span className="text-zinc-400 text-sm">Context / description <span className="text-zinc-600">(optional)</span></span>
                <textarea
                  maxLength={500}
                  rows={3}
                  placeholder="Add more context for the roasters..."
                  value={challengeDesc}
                  onChange={(e) => setChallengeDesc(e.target.value)}
                  className="input-surface mt-1 w-full px-3 py-2 placeholder:text-slate-500 resize-none"
                />
                <span className="text-zinc-600 text-xs">{challengeDesc.length}/500</span>
              </label>

              {/* Content type toggle */}
              <div>
                <span className="text-zinc-400 text-sm block mb-2">Content type</span>
                <div className="flex gap-2">
                  {(["text", "image"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setMediaType(t);
                        if (t === "text") { setMediaFile(null); setMediaPreview(null); }
                      }}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium capitalize transition-all ${
                        mediaType === t
                          ? "border-orange-500 bg-orange-500/10 text-orange-400"
                          : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
                      }`}
                    >
                      {t === "text" ? "📝 Text only" : "🖼️ Image"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Image upload — only shown when mediaType === "image" */}
              {mediaType === "image" && (
                <div>
                  <span className="text-zinc-400 text-sm block mb-2">Upload image</span>
                  {mediaPreview ? (
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={mediaPreview}
                        alt="Preview"
                        className="w-full max-h-48 object-contain rounded-lg border border-zinc-700 bg-zinc-900"
                      />
                      <button
                        type="button"
                        onClick={() => { setMediaFile(null); setMediaPreview(null); }}
                        className="absolute top-2 right-2 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-full w-7 h-7 flex items-center justify-center text-xs border border-zinc-700"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-zinc-700 hover:border-orange-500 rounded-lg cursor-pointer bg-zinc-900 transition-colors">
                      <span className="text-zinc-500 text-sm">Click to choose image</span>
                      <span className="text-zinc-600 text-xs mt-1">JPEG · PNG · GIF · WebP · max 10 MB</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0] ?? null;
                          setMediaFile(f);
                          setMediaPreview(f ? URL.createObjectURL(f) : null);
                        }}
                      />
                    </label>
                  )}
                </div>
              )}

              <div className="border-t border-slate-700 pt-4">
                <p className="section-title mb-3">Stake settings</p>
              </div>

              <label className="block">
                <span className="text-zinc-400 text-sm">Roaster stake (ETH per roaster)</span>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={roastStake}
                  onChange={(e) => setRoastStake(e.target.value)}
                  className="input-surface mt-1 w-full px-3 py-2"
                />
              </label>

              <label className="block">
                <span className="text-zinc-400 text-sm">Vote stake (ETH per vote)</span>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={voteStake}
                  onChange={(e) => setVoteStake(e.target.value)}
                  className="input-surface mt-1 w-full px-3 py-2"
                />
              </label>

              <p className="text-zinc-500 text-xs">
                You pay {roastStake} ETH now to create &amp; join. Others stake the same to roast.
                Voters stake {voteStake} ETH. Winning voters share the voter pool.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 skeuo-button text-white font-bold py-2"
                >
                  {creating ? "Creating…" : "Create Arena"}
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setError("");
                    setChallengeTitle("");
                    setChallengeDesc("");
                    setMediaType("text");
                    setMediaFile(null);
                    setMediaPreview(null);
                  }}
                  className="px-4 py-2 skeuo-button-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isWrongNetwork && (
            <p className="text-yellow-300 text-sm">
              Wrong network.{" "}
              <button onClick={switchNetwork} className="underline hover:text-yellow-100 transition-colors">Switch</button>
            </p>
          )}
        </div>

        {error && <p className="text-center text-red-300 mb-6 text-sm">{error}</p>}

        <h2 className="section-title mb-4">Recent Arenas</h2>

        {loading ? (
          <p className="muted-text text-center py-10">Loading arenas…</p>
        ) : roasts.length === 0 ? (
          <div className="skeuo-panel-soft text-center py-16">
            <p className="soft-text text-lg mb-2">No arenas yet.</p>
            <p className="muted-text text-sm">Be the first to create one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {roasts.map((r) => (
              <Link
                key={r.roast_id}
                href={`/arena/${r.roast_id}`}
                className="block skeuo-panel-soft px-5 py-4 hover:translate-y-[-1px] transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-slate-100 font-bold">Arena #{r.roast_id}</span>
                    <span className="muted-text text-sm ml-3">
                      by {r.creator_username || `${r.creator.slice(0, 6)}…`}
                    </span>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <Countdown openUntil={r.open_until} voteUntil={r.vote_until} state={r.state} />
                    <span className={`state-pill ${
                      r.state === "OPEN" ? "state-open"
                      : r.state === "VOTING" ? "state-voting"
                      : r.state === "SETTLED" ? "state-settled"
                      : "state-cancelled"
                    }`}>
                      {r.state}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}





