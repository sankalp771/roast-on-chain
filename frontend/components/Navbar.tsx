"use client";
import Link from "next/link";
import { useWallet } from "@/lib/useWallet";

export default function Navbar() {
  const { address, isConnecting, isWrongNetwork, connect, switchNetwork } = useWallet();

  const short = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  return (
    <nav className="top-nav px-4 sm:px-6 py-4 flex items-center justify-between">
      <Link href="/" className="brand-mark text-lg sm:text-xl">
        <span className="brand-accent">ROAST</span><span className="text-slate-100">ARENA</span>
      </Link>

      <div className="flex items-center gap-4">
        {address && (
          <Link href={`/profile/${address}`} className="soft-text hover:text-slate-100 text-sm transition-colors">
            {short}
          </Link>
        )}

        {isWrongNetwork ? (
          <button
            onClick={switchNetwork}
            className="skeuo-button skeuo-button-danger text-sm px-4 py-2"
          >
            Switch to Monad
          </button>
        ) : address ? (
          <span className="state-pill state-open">
            {short}
          </span>
        ) : (
          <button
            onClick={connect}
            disabled={isConnecting}
            className="skeuo-button text-sm px-4 py-2"
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>
    </nav>
  );
}
