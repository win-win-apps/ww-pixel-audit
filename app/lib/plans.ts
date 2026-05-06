// Pure plan metadata. Lives outside .server.ts so client routes can import it
// for rendering pricing cards.

export type Plan = "free" | "pro" | "agency";
export type PlanKey = "pro" | "agency";

export function hasPro(plan: Plan): boolean {
  return plan === "pro" || plan === "agency";
}

export function hasAgency(plan: Plan): boolean {
  return plan === "agency";
}

export interface PlanDef {
  key: PlanKey;
  name: string;
  amount: number;
  currency: "USD";
  trialDays: number;
}

export const PLANS: Record<PlanKey, PlanDef> = {
  pro: {
    key: "pro",
    name: "WW Pixel Audit Pro",
    amount: 29,
    currency: "USD",
    trialDays: 7,
  },
  agency: {
    key: "agency",
    name: "WW Pixel Audit Agency",
    amount: 79,
    currency: "USD",
    trialDays: 7,
  },
};
