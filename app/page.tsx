import AuctionApp from "@/components/auction-app";
import { createDemoState } from "@/lib/auction";

export default function Home() {
  return <AuctionApp initialState={createDemoState()} />;
}
