import { ReliabilityControlPlane } from "@/components/reliability-control-plane";
import { connection } from "next/server";

export default async function Home() {
  // A fresh CSP nonce exists only at request time; static rendering would leave scripts un-nonced.
  await connection();
  return <ReliabilityControlPlane />;
}
