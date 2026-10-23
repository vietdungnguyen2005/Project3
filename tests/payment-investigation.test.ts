import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PaymentInvestigation } from "@/components/payment-investigation";

it("requires an operator session before fetching protected evidence or offering actions", () => {
  const markup = renderToStaticMarkup(createElement(PaymentInvestigation, { number:"VP-123", canOperate:false, onChanged:() => undefined }));
  expect(markup).toContain("Sign in as an operator");
  expect(markup).not.toContain("Confirm verified success");
  expect(markup).not.toContain("Execute controlled replay");
});
