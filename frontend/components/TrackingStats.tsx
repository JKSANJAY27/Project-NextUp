import React from "react";

interface TrackingStatsProps {
  total: number;
  registration: number;
  shortlisted: number;
  onlineAssessment: number;
  interview: number;
  offer: number;
}

export default function TrackingStats({
  total,
  registration,
  shortlisted,
  onlineAssessment,
  interview,
  offer,
}: TrackingStatsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
      <div className="border-2 border-border bg-card p-4 flex flex-col justify-between h-24 transition-colors hover:border-foreground">
        <span className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">Total Applications</span>
        <span className="text-3xl font-extrabold tracking-tighter text-foreground">{total}</span>
      </div>
      <div className="border-2 border-yellow-500/30 bg-yellow-500/5 p-4 flex flex-col justify-between h-24">
        <span className="text-[10px] font-black tracking-widest text-yellow-500 uppercase">Registration</span>
        <span className="text-3xl font-extrabold tracking-tighter text-yellow-500">{registration}</span>
      </div>
      <div className="border-2 border-blue-500/30 bg-blue-500/5 p-4 flex flex-col justify-between h-24">
        <span className="text-[10px] font-black tracking-widest text-blue-500 uppercase">Shortlisted</span>
        <span className="text-3xl font-extrabold tracking-tighter text-blue-500">{shortlisted}</span>
      </div>
      <div className="border-2 border-orange-500/30 bg-orange-500/5 p-4 flex flex-col justify-between h-24">
        <span className="text-[10px] font-black tracking-widest text-orange-500 uppercase">Online Assessment</span>
        <span className="text-3xl font-extrabold tracking-tighter text-orange-500">{onlineAssessment}</span>
      </div>
      <div className="border-2 border-purple-500/30 bg-purple-500/5 p-4 flex flex-col justify-between h-24">
        <span className="text-[10px] font-black tracking-widest text-purple-500 uppercase">Interview</span>
        <span className="text-3xl font-extrabold tracking-tighter text-purple-500">{interview}</span>
      </div>
      <div className="border-2 border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col justify-between h-24">
        <span className="text-[10px] font-black tracking-widest text-emerald-500 uppercase">Offer Received</span>
        <span className="text-3xl font-extrabold tracking-tighter text-emerald-500">{offer}</span>
      </div>
    </div>
  );
}
