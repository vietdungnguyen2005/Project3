import { operatorFetch } from "@/lib/operator-session";
import type { PaymentDetail } from "@/lib/reliability";

export type ReconciliationEvidence={
  id:string;providerReference:string|null;paymentVersion:number;state:"IN_PROGRESS"|"OBSERVED"|"RESOLVED"|"INTERRUPTED";
  outcome:"VERIFIED_SUCCESS"|"VERIFIED_REJECTION"|"UNKNOWN"|"PROVIDER_UNAVAILABLE"|"NOT_FOUND"|"INTERRUPTED"|null;
  evidenceCode:string|null;requestedBy:string;resolvedBy:string|null;requestId:string|null;
  createdAt:string;observedAt:string|null;resolvedAt:string|null;leaseUntil:string;
};
export type Investigation={detail:PaymentDetail;providerReference:string|null;replayPermitted:boolean;
  nextAction:"NONE"|"ALREADY_RECONCILED"|"WAIT_FOR_LOOKUP"|"CONFIRM_SUCCESS"|"CONFIRM_REJECTION"|"CONTROLLED_REPLAY_ALLOWED"|"MANUAL_REVIEW"|"RECONCILE_PROVIDER";
  evidence:ReconciliationEvidence[];audit:Array<{actor:string;action:string;createdAt:string}>;
};
export class InvestigationError extends Error {constructor(message:string,readonly code?:string){super(message);}}
async function read<T>(response:Response):Promise<T>{
  const payload=await response.json().catch(()=>null) as T & {message?:string;code?:string}|null;
  if(!response.ok) throw new InvestigationError(payload?.message??"Investigation unavailable. Refresh the original payment before retrying.",payload?.code);
  if(payload===null) throw new InvestigationError("Response could not be verified. Refresh the original investigation.");
  return payload;
}
const path=(number:string)=>`/api/control/payments/${encodeURIComponent(number)}`;
export async function inspectPayment(number:string,signal?:AbortSignal):Promise<Investigation>{
  return read(await operatorFetch(`${path(number)}/investigation`,{signal}));
}
export async function lookupPayment(number:string):Promise<ReconciliationEvidence>{
  return read(await operatorFetch(`${path(number)}/reconciliation`,{method:"POST"}));
}
export async function resolvePayment(number:string,id:string):Promise<ReconciliationEvidence>{
  return read(await operatorFetch(`${path(number)}/reconciliation/${encodeURIComponent(id)}/resolve`,{method:"POST"}));
}
export async function replayPayment(number:string):Promise<PaymentDetail>{
  return read(await operatorFetch(`/api/control/parking/${encodeURIComponent(number)}/replay`,{method:"POST"}));
}
