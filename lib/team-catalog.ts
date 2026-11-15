/** Lightweight franchise choices shared by the UI and server; no player data. */
export const TEAM_CATALOG_VERSION = 3;

export const TEAM_SEEDS = [
  { id: "csk", name: "Chennai Super Kings", shortName: "CSK", color: "#edc447" },
  { id: "mi", name: "Mumbai Indians", shortName: "MI", color: "#4d8dff" },
  { id: "rcb", name: "Royal Challengers Bengaluru", shortName: "RCB", color: "#ef595e" },
  { id: "kkr", name: "Kolkata Knight Riders", shortName: "KKR", color: "#a68ce5" },
  { id: "srh", name: "Sunrisers Hyderabad", shortName: "SRH", color: "#f79651" },
  { id: "rr", name: "Rajasthan Royals", shortName: "RR", color: "#ec79ae" },
  { id: "dc", name: "Delhi Capitals", shortName: "DC", color: "#61bde9" },
  { id: "pbks", name: "Punjab Kings", shortName: "PBKS", color: "#e87878" },
  { id: "dch", name: "Deccan Chargers", shortName: "DCH", color: "#a9c5df" },
  { id: "pwi", name: "Pune Warriors India", shortName: "PWI", color: "#62c6d4" },
  { id: "gt", name: "Gujarat Titans", shortName: "GT", color: "#d8bd7c" },
  { id: "lsg", name: "Lucknow Super Giants", shortName: "LSG", color: "#70afff" },
] as const;

export const PRACTICE_MANAGER_NAMES: Readonly<Record<string, string>> = {
  csk: "Aarav", mi: "Priya", rcb: "Anmol", kkr: "Kabir", srh: "Riya",
  rr: "Arjun", dc: "Neha", pbks: "Dev", dch: "Ishaan", pwi: "Meera", gt: "Rohan", lsg: "Sana",
};
