import { describe,expect,it,vi } from "vitest";
import { lookupPayment } from "@/lib/reconciliation";

describe("reconciliation API",()=>{
  it("looks up an existing payment through CSRF-protected BFF without an authorization payload",async()=>{
    const request=vi.fn().mockResolvedValueOnce(Response.json({authenticated:true,csrfToken:"csrf",roles:["ROLE_OPERATOR"]}))
      .mockResolvedValueOnce(Response.json({id:"run-1",outcome:"VERIFIED_SUCCESS"}));
    vi.stubGlobal("fetch",request);
    await expect(lookupPayment("VP-123")).resolves.toMatchObject({outcome:"VERIFIED_SUCCESS"});
    expect(request.mock.calls[1][0]).toBe("/api/control/payments/VP-123/reconciliation");
    expect(request.mock.calls[1][1].body).toBeUndefined();
    expect(new Headers(request.mock.calls[1][1].headers).get("X-CSRF-TOKEN")).toBe("csrf");
  });
});
