"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useWallet } from "@/lib/useWallet";
import { getProfile, saveProfile, getUserRoasts, type Profile, type RoastIndex } from "@/lib/api";
import { STATE_LABEL, STATE_COLOR, RoastState } from "@/lib/contract";

export default function ProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address: paramAddress } = use(params);
  const { address: myAddress } = useWallet();

  const isOwner = myAddress?.toLowerCase() === paramAddress.toLowerCase();

  const [profile, setProfile]   = useState<Profile | null>(null);
  const [roasts, setRoasts]     = useState<RoastIndex[]>([]);
  const [editing, setEditing]   = useState(false);
  const [username, setUsername] = useState("");
  const [bio, setBio]           = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    getProfile(paramAddress).then((p) => {
      setProfile(p);
      setUsername(p.username);
      setBio(p.bio);
    }).catch(() => {});

    getUserRoasts(paramAddress).then(setRoasts).catch(() => {});
  }, [paramAddress]);

  const handleSave = async () => {
    if (!myAddress) return;
    setSaving(true); setError("");
    try {
      await saveProfile({ address: myAddress, username, bio });
      setProfile((p) => p ? { ...p, username, bio } : p);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const short = `${paramAddress.slice(0, 6)}...${paramAddress.slice(-4)}`;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">

        <Link href="/" className="muted-text hover:text-slate-100 text-sm mb-6 inline-block transition-colors">
          ← Home
        </Link>

        {/* Profile card */}
        <div className="skeuo-panel p-6 mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              {editing ? (
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={32}
                  placeholder="Username"
                  className="input-surface px-3 py-1 text-white text-xl font-bold w-full"
                />
              ) : (
                <h1 className="text-2xl font-bold">
                  {profile?.username || short}
                </h1>
              )}
              <p className="muted-text text-sm mt-1 break-all">{paramAddress}</p>
            </div>

            {isOwner && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="skeuo-button-secondary text-sm px-3 py-1"
              >
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={160}
                rows={2}
                placeholder="Short bio (160 chars)"
                className="w-full input-surface p-3 text-sm resize-none mt-2"
              />
              {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
              <div className="flex gap-3 mt-3">
                <button
                  onClick={handleSave}
                  disabled={saving || !username.trim()}
                  className="skeuo-button disabled:opacity-50 text-white text-sm px-4 py-2"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="skeuo-button-secondary text-sm px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            profile?.bio && <p className="soft-text text-sm mt-2">{profile.bio}</p>
          )}

          {saved && <p className="text-green-300 text-sm mt-2">Profile saved!</p>}
        </div>

        {/* Roast history */}
        <h2 className="section-title mb-4">
          Arenas Participated In ({roasts.length})
        </h2>

        {roasts.length === 0 ? (
          <p className="muted-text text-sm">No arenas yet.</p>
        ) : (
          <div className="space-y-3">
            {roasts.map((r) => (
              <Link
                key={r.roast_id}
                href={`/arena/${r.roast_id}`}
                className="flex items-center justify-between skeuo-panel-soft px-4 py-3 transition-all"
              >
                <div>
                  <span className="text-slate-100 font-bold">Arena #{r.roast_id}</span>
                  {r.state === "SETTLED" && r.winner?.toLowerCase() === paramAddress.toLowerCase() && (
                    <span className="ml-2 text-orange-400 text-xs">WINNER</span>
                  )}
                </div>
                <span className={STATE_COLOR[r.state as unknown as RoastState] ?? "text-zinc-400"}>
                  {STATE_LABEL[r.state as unknown as RoastState] ?? r.state}
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

