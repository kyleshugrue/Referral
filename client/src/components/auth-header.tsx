import React from "react";

export default function AuthHeader() {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-transparent">
      {/* iOS status bar padding */}
      <div className="h-[env(safe-area-inset-top)]" />
      
      {/* Header with Referral title */}
      <div className="px-4 h-16 flex items-center justify-center">
        <h1 className="text-3xl font-semibold text-white">
          Referral
        </h1>
      </div>
    </div>
  );
}