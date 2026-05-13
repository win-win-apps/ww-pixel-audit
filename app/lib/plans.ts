// Pure plan metadata. Lives outside .server.ts so client routes can import it
// for rendering pricing cards.
//
// We had an Agency tier at one point but removed it during the "no fake
// features" audit pass — the daily monitoring it depended on wasn't real.
// Plan type stays just free/pro now.

export type Plan = "free" | "pro";
export type PlanKey = "pro";

export function hasPro(plan: Plan): boolean {
  return plan === "pro";
}

export interface PlanDef {
  key: PlanKey;
  name: string;
  amount: number;
  currency: "USD";
  trialDays: number;
}

// No free trial. Per learnings from the WW Store Credit app: free trials get
// abused (install / use / uninstall / reinstall on another store). Free plan
// + paid plan with no trial converts cleaner. Pay to unlock Pro immediately.
export const PLANS: Record<PlanKey, PlanDef> = {
  pro: {
    key: "pro",
    name: "WW Pixel Audit Pro",
    amount: 29,
    currency: "USD",
    trialDays: 0,
  },
};
