# Season statistics

The Auction Season page includes all 21 named sections in the supplied three-page POINTS PDF, plus its roster columns, totals and podium. It derives them from the room's current confirmed purchases, saved XI/captaincy and latest source snapshot. It does not import the PDF's historical owners or fixed cell coordinates.

Let **raw** mean a player's source Total Impact; **weighted** means raw ×2 for the saved captain, ×1.5 for the saved vice captain, or ×1 otherwise. **Source mean** is the raw MVP average across every row in the source snapshot. Prices are stored in lakhs and converted to crores by dividing by 100.

Managers can appoint either leader directly in **My Squad**, from any purchased player, before or after the auction ends. Captaincy does not depend on filling the Playing XI. These shared selections also appear in **Build my XI**, public team lineups, recap downloads and posters. A saved change recalculates season points without fetching the source again; moving a player within the XI or bench does not remove their leadership role.

| PDF section | Calculation |
| --- | --- |
| Overall Leaderboard | Sum of known weighted points across every purchased player, including substitutes and reserves. |
| Avg Pts/Mat Leaderboard | Sum of individual weighted-points-per-match rates across each squad; coverage requires a known score and a positive match count. |
| Tournament Stats | Source player count, raw total, raw mean, and all tied highest/lowest players. |
| Top 20 MVP | Highest raw points across the source, annotated with verified auction ownership. |
| Team MVP Standings | Raw totals by real IPL franchise, independent of mock-auction ownership. |
| Efficient Franchises | Each real franchise's raw total divided by tracked players in that franchise. |
| Purist Leaderboard | Raw squad totals without C/VC multipliers. |
| Franchise Loyalty | Largest purchased-player group from one real IPL franchise; all tied franchises are named. |
| Best Value Signings | Highest raw MVP per crore spent; positive prices only. Top ten and cutoff ties. |
| Worst Value Signings | Lowest raw MVP per crore among purchases costing at least ₹2 Cr. Top five and cutoff ties. |
| Undrafted Gems | Highest raw MVP among verified available or unsold players in this room's pool. Unmapped source players are not assumed to be available. |
| Captains Leaderboard | Saved captain's weighted points; missing selections or scores stay pending. |
| Dead Weight | Count of known zero/negative scorers, with unmatched purchases shown separately as pending. |
| Hardest Carry | Leading individual weighted contribution divided by a positive known weighted squad total. |
| The Dynamic Duo | Weighted captain plus weighted vice-captain points; both assignments and scores must be known. |
| Roster Depth | Known points excluding the saved captain and vice captain; leadership assignments must be saved first. |
| Orange Cap | Highest known positive run totals across the source, with ownership. Top ten and cutoff ties. |
| Purple Cap | Highest known positive wicket totals across the source, with ownership. Top ten and cutoff ties. |
| Captaincy Regret | Best known raw squad score minus the captain's raw score, floored at zero. This is a captain-only comparison, not a hypothetical optimal C/VC gain. |
| Heavy Top Order | Raw points from actual saved XI batting positions 1–3 divided by the positive known raw squad total. Unfilled or unmatched top positions stay pending. |
| Expensive Duds | Lowest non-negative raw scores among purchases costing at least ₹5 Cr. Top five and cutoff ties; ranked by raw points rather than ROI. |

## Roster and ranking details

- **Deviation** is raw MVP minus the source mean, matching the predominant PDF column calculation. The older scraper's weighted deviation and hardcoded KL Rahul cell correction are not used.
- **Player points per match** is weighted points divided by known matches greater than zero. Negative rates retain their sign. Full precision is used before display formatting, instead of copying the PDF's truncated/absolute-value artefacts.
- **Squad points per match** is the sum of those rates, not an average of players' rates or squad points divided by an invented team match count.
- **Podium** includes every squad with competition rank 1, 2 or 3; ties share rank. Empty squads are unranked.
- Unknown scores are not zero. Partial metrics show coverage; per-match and source-franchise coverage are independent of MVP-score coverage. Nonpositive percentage denominators are unavailable. Negative contributions may legitimately produce percentages above 100%.
- Heavy Top Order uses saved batting positions because this app has no worksheet row order. It never substitutes the best three performers or the first three populated cards.
- The workbook's **POINTS** sheet includes deviation and weighted points/match. **Tournament stats** includes source totals/extremes and podium; **Season analytics** contains every leaderboard, including its formula and coverage. Empty sections remain identifiable in the workbook.

No extra ESPN request, database migration, chart library or scoring bonus is introduced. New source snapshots, corrected sales and saved XI/captaincy changes recalculate the statistics through the existing season read path.
