import AuctionApp from "@/components/auction-app";
import { createBootstrapState } from "@/lib/bootstrap-state";

export default function Home() {
  return <AuctionApp initialState={createBootstrapState()} />;
}
