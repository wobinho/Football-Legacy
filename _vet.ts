import { generateWorld } from "./lib/worldgen";
import { advanceUntilEvent, applyMatchResult, afterUserMatch, matchSeed, ensureUserLineup, runSeasonRollover } from "./lib/gameloop";
import { simulateMatch } from "./lib/engine/match";
import { buildSideInput } from "./lib/selection";
import { TUNING as T } from "./lib/config/tuning";
const s = generateWorld({ saveName:"a", managerName:"m", userTeamId:"ENG1_t9", playableCountry:"ENG", viewCountries:["ESP","ITA"], seed:777 });
function d(){const l=Object.values(s.players).filter(p=>p&&!p.retired);
const vets=l.filter(p=>p.age>=34);
const vetAtt=vets.filter(p=>p.clubId).length, vetFA=vets.length-vetAtt;
const sim=vets.filter(p=>p.clubId&&!s.leagues[s.teams[p.clubId!]?.leagueId]?.playable).length;
const play=vetAtt-sim;
const decl=vets.filter(p=>p.overall<60).length;
return `S${s.season} 34+=${vets.length} (onClub ${vetAtt}: playable ${play}, sim ${sim} | FA ${vetFA}) under60=${decl}`;}
console.log(d());
let g=0;
while(s.season<=10&&g++<8000){const st=advanceUntilEvent(s);
if(st.kind==="matchday"){const f=s.fixtures.find(x=>x.id===s.pendingMatchFixtureId)!;const ul=ensureUserLineup(s);
const mk=(id:string,fx?:typeof ul)=>{const t=s.teams[id];return buildSideInput(id,t.name,t.short,t.playerIds.map(p=>s.players[p]).filter(p=>p&&!p.retired),t.tactic,T,fx);};
applyMatchResult(s,f,simulateMatch(mk(f.homeId,f.homeId===s.userTeamId?ul:undefined),mk(f.awayId,f.awayId===s.userTeamId?ul:undefined),T,matchSeed(s,f)));afterUserMatch(s);}
else if(st.kind==="seasonEnd"){runSeasonRollover(s);console.log(d());}else if(st.kind==="idle")break;}
