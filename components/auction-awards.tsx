import { Award, Banknote, Flame, Gavel, Swords, Trophy, Users } from "lucide-react";
import type { RoomState } from "@/lib/auction";
import { getAuctionAwards, type AwardWinner } from "@/lib/auction-awards";
import { PlayerImage, TeamCrest } from "./ipl-visuals";
import "./auction-awards.css";

const ICONS = { headline: Trophy, roster: Users, purse: Banknote, battle: Flame, table: Gavel, rivals: Swords };

export function AuctionAwards({ state }: { state: RoomState }) {
  if (state.endedAt === undefined) return null;
  const result = getAuctionAwards(state);
  const players = new Map(state.players.map(player => [player.id, player]));
  const teams = new Map(state.teams.map(team => [team.id, team]));
  function winner(entry: AwardWinner) {
    const player = entry.playerId ? players.get(entry.playerId) : undefined;
    return <li key={entry.id} className="auction-award-winner"><span className={`award-winner-art${player ? " has-player" : ""}`}>{player ? <PlayerImage player={player}/> : entry.teamIds.map(id => { const team = teams.get(id); return team ? <TeamCrest key={id} team={team}/> : null; })}</span><span><strong>{entry.name}</strong><small>{entry.detail}</small></span></li>;
  }
  return <section className="auction-awards" aria-labelledby="auction-awards-title">
    <header className="auction-awards-heading"><span className="award-heading-symbol"><Award size={28} strokeWidth={1.3}/></span><div><span className="award-overline">THE HONOURS BOARD</span><h2 id="auction-awards-title">Auction awards<span>.</span></h2><p>Final signings. Real bidding battles. Shared honours when tied.</p></div></header>
    {!result.bidHistoryComplete && <p className="award-history-note">Sale awards are available. Bidding awards are withheld because this older room no longer has its complete bid history.</p>}
    <div className="auction-awards-grid">{result.awards.map(award => { const Icon = ICONS[award.id]; return <article key={award.id} className={`auction-award-card award-${award.id}${award.winners.length ? " is-awarded" : ""}`} data-award={award.id}>
      <div className="award-card-heading"><h3>{award.title}</h3><Icon size={23} strokeWidth={1.5}/></div>
      <div className="award-card-metric"><strong>{award.metric}</strong>{award.winners.length > 1 && <span>{award.winners.length} tied</span>}</div>
      {award.winners.length ? <><ul className="award-winners">{award.winners.slice(0, 3).map(winner)}</ul>{award.winners.length > 3 && <details className="award-extra-winners"><summary>View all {award.winners.length} shared winners</summary><ul className="award-winners">{award.winners.slice(3).map(winner)}</ul></details>}</> : <p className="award-empty">{award.unavailable}</p>}
      <details className="award-criterion"><summary>How this is decided</summary><p>{award.criterion}</p></details>
    </article>; })}</div>
    <p className="award-record-note">Sale corrections update purchase awards. Bidding awards reflect the accepted bids that actually took place.</p>
  </section>;
}
