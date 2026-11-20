import type { Team } from "@/lib/auction";
import { TeamCrest } from "./ipl-visuals";

export function FranchiseHero({ team, ownerName }: {
  team: Team; ownerName: string;
}) {
  return <section className="franchise-hero" aria-label={`${team.name} auction room`}>
    <div className="franchise-hero-crest"><TeamCrest team={team}/></div>
    <div className="franchise-hero-copy">
      <h1>{ownerName}</h1>
      <p className="franchise-hero-owner">{team.name}</p>
    </div>
    <span className="franchise-hero-monogram" aria-hidden="true">{team.shortName}</span>
  </section>;
}
