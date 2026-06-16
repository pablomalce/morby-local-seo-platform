"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Download, LogOut, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { deleteMyAccount, exportMyData, signOutAction } from "@/lib/auth/account-actions";

export function ExportButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    start(async () => {
      const res = await exportMyData();
      if (!res.ok || !res.data) {
        setError(res.message ?? "Export failed");
        return;
      }
      const blob = new Blob([res.data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vulkan-growth-os-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="rounded-vulkan border border-metal-800 bg-metal-950 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-vulkan bg-vulkan-orange/15 text-vulkan-orange">
          <Download className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="flex-1">
          <p className="font-display text-[13px] uppercase tracking-hud text-vulkan-white">
            Export your data
          </p>
          <p className="mt-1 text-[12px] text-metal-400">
            Right to data portability — download everything we hold about you as JSON.
          </p>
        </div>
      </div>
      <Button onClick={handleClick} disabled={pending} className="mt-4 w-full" variant="secondary">
        {pending ? "Generating..." : "DOWNLOAD JSON"}
      </Button>
      {error && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-hud text-red-400">{error}</p>
      )}
    </div>
  );
}

export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    start(async () => {
      const res = await deleteMyAccount();
      if (res && !res.ok) {
        setError(res.message ?? "Delete failed");
      }
    });
  }

  return (
    <div className="rounded-vulkan border border-red-900/40 bg-red-950/20 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-vulkan bg-red-900/40 text-red-300">
          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="flex-1">
          <p className="font-display text-[13px] uppercase tracking-hud text-red-200">
            Delete account
          </p>
          <p className="mt-1 text-[12px] text-red-300/80">
            Right to erasure — permanently removes your account and all tenant data. Cannot be
            undone.
          </p>
        </div>
      </div>
      {!confirming ? (
        <Button
          onClick={() => setConfirming(true)}
          variant="danger"
          className="mt-4 w-full"
          disabled={pending}
        >
          DELETE MY ACCOUNT
        </Button>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="flex items-start gap-2 text-[11px] text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Type <code className="font-mono text-red-200">DELETE</code> to confirm.
            </span>
          </p>
          <input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder="DELETE"
            className="w-full rounded-vulkan border border-red-900/60 bg-red-950/30 px-3 py-2 font-mono text-[12px] uppercase tracking-hud text-red-200 outline-none focus:border-red-500"
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setConfirming(false); setConfirmInput(""); }} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirm}
              disabled={pending || confirmInput !== "DELETE"}
              className="flex-1"
            >
              {pending ? "Deleting..." : "CONFIRM DELETE"}
            </Button>
          </div>
          {error && (
            <p className="font-mono text-[10px] uppercase tracking-hud text-red-400">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="secondary" className="w-full">
        <LogOut className="h-3.5 w-3.5" />
        SIGN OUT
      </Button>
    </form>
  );
}
