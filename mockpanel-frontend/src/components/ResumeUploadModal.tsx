"use client";

// components/ResumeUploadModal.tsx
// ════════════════════════════════════════════════════════════════════════════════
// RESUME UPLOAD MODAL — drag & drop PDF, optional (can skip)
// Shows after session is created, before entering interview room
// ════════════════════════════════════════════════════════════════════════════════

import { useState, useRef } from "react";
import { sessionAPI } from "@/lib/api";

interface Props {
  sessionId: string;
  onSuccess: () => void;   // Upload done → go to interview
  onSkip:    () => void;   // User skipped → go to interview anyway
  onClose:   () => void;   // X button → same as skip
}

export default function ResumeUploadModal({
  sessionId,
  onSuccess,
  onSkip,
  onClose,
}: Props) {
  const [file,       setFile]       = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [error,      setError]      = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const acceptFile = (f: File) => {
    if (f.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }
    if (f.size > 12 * 1024 * 1024) {
      setError("File too large. Maximum size is 12 MB.");
      return;
    }
    setError("");
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  };

  const handleUpload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setError("");

    try {
      await sessionAPI.uploadResume(sessionId, file);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setUploading(false);
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      role="dialog"
      aria-modal
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div
        className="relative w-full max-w-md rounded-3xl overflow-hidden"
        style={{
          background:    "rgba(14,14,14,0.98)",
          border:        "1px solid rgba(255,255,255,0.08)",
          backdropFilter:"blur(20px)",
          boxShadow:     "0 40px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-all z-10"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-8">
          {/* Header */}
          <div className="mb-7">
            <h2 className="text-[17px] font-bold text-white tracking-tight mb-1.5">
              Personalize with your Resume
            </h2>
            <p className="text-[13px] text-zinc-500 leading-relaxed">
              Upload your Resume or DAF and the AI panel will craft targeted questions based on your background.
              <span className="text-zinc-600"> This step is optional — you can skip it.</span>
            </p>
          </div>

          {/* Drop zone */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="w-full rounded-2xl px-6 py-10 text-center transition-all duration-200 outline-none"
            style={{
              background: isDragging
                ? "rgba(99,102,241,0.08)"
                : file
                  ? "rgba(16,185,129,0.06)"
                  : "rgba(255,255,255,0.02)",
              border: `2px dashed ${
                isDragging
                  ? "rgba(99,102,241,0.5)"
                  : file
                    ? "rgba(16,185,129,0.35)"
                    : "rgba(255,255,255,0.08)"
              }`,
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); }}
            />

            {file ? (
              <div className="flex items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-[14px] font-semibold text-white truncate max-w-[240px]">
                    {file.name}
                  </p>
                  <p className="text-[12px] text-emerald-400 mt-0.5">
                    {(file.size / 1024).toFixed(0)} KB · Ready to upload
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <div className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4 border border-white/[0.06]">
                  <svg className="w-6 h-6 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-[14px] text-zinc-400 font-medium">
                  Drop PDF here or{" "}
                  <span className="text-indigo-400">browse</span>
                </p>
                <p className="text-[11px] text-zinc-700 mt-1.5">PDF only · Max 12 MB</p>
              </div>
            )}
          </button>

          {/* Error */}
          {error && (
            <div className="mt-4 flex items-center gap-2 text-red-400 bg-red-500/8 border border-red-500/15 rounded-xl px-4 py-3">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[13px]">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3 mt-7">
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="w-full h-12 rounded-xl font-semibold text-[14px] text-white transition-all disabled:opacity-40"
              style={{
                background:  file && !uploading
                  ? "linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)"
                  : "rgba(255,255,255,0.06)",
                boxShadow:   file && !uploading
                  ? "0 0 24px rgba(99,102,241,0.3)"
                  : "none",
              }}
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2.5">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Parsing resume…</span>
                </span>
              ) : (
                "Continue with Resume"
              )}
            </button>

            <button
              onClick={onSkip}
              disabled={uploading}
              className="w-full h-10 rounded-xl text-[13px] text-zinc-500 hover:text-zinc-300 transition-colors font-medium disabled:opacity-40"
            >
              Skip — start without resume
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}