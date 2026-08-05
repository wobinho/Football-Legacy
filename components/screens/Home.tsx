"use client";

// Home (§15.1): inbox, news ticker, next fixture, mini table — the spine.

import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { formatDay, formatDayShort } from "@/lib/calendar";
import { computeTable } from "@/lib/season";
import { INBOX_TAG_META, groupedInbox, type InboxGroup, type InboxGroupId } from "@/lib/inbox";
import { isRivalryFixture } from "@/lib/rivalry";
import { TUNING } from "@/lib/config/tuning";
import type { Fixture, InboxItem } from "@/lib/types";
import { Card, Crest, Section, GhostButton } from "../ui";
import Calendar from "../Calendar";

export default function HomeScreen() {
  const game = useGame((s) => s.game)!;
  useGame((s) => s.rev);
  const markRead = useGame((s) => s.markRead);
  const markAllRead = useGame((s) => s.markAllRead);
  const deleteMail = useGame((s) => s.deleteMail);
  const deleteAllMail = useGame((s) => s.deleteAllMail);
  const markGroupReadAction = useGame((s) => s.markGroupReadAction);
  const deleteGroupMail = useGame((s) => s.deleteGroupMail);
  const setScreen = useGame((s) => s.setScreen);
  // One item open at a time — the inbox is a list of headlines you drill into.
  const [expanded, setExpanded] = useState<string | null>(null);
  // Which FOLDERS are open (v1.94). A Set rather than a single id: folders are
  // independent, and the whole point of pre-grouping is that the manager can
  // leave the two they care about open and never see the others.
  //
  // Everything starts CLOSED. That is the feature — the default view is four
  // rows with counts rather than a wall of headlines.
  const [openGroups, setOpenGroups] = useState<Set<InboxGroupId>>(new Set());
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const team = game.teams[game.userTeamId];
  const mine = game.fixtures.filter((f) => f.homeId === game.userTeamId || f.awayId === game.userTeamId);
  const next = mine.filter((f) => !f.played).sort((a, b) => a.day - b.day)[0];
  const lastFive = mine
    .filter((f) => f.played)
    .sort((a, b) => b.day - a.day)
    .slice(0, 5)
    .reverse();
  const unread = game.inbox.filter((i) => !i.read).length;
  // The folders, always all of them and always in the same order — the grouping
  // rule is `lib/inbox.ts`'s, not this screen's.
  const groups = groupedInbox(game.inbox);

  const toggleGroup = (id: InboxGroupId) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const league = game.leagues[team.leagueId];
  const table = computeTable(game.fixtures, league.id, league.teamIds);
  const myPos = table.findIndex((r) => r.teamId === game.userTeamId);
  const slice = table.slice(Math.max(0, Math.min(myPos - 2, table.length - 5)), Math.max(5, Math.min(myPos + 3, table.length)));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Section
          title="Inbox"
          right={
            game.inbox.length > 0 ? (
              <span className="flex items-center gap-3">
                {unread > 1 && (
                  <button onClick={markAllRead} className="text-xs text-faint transition-colors hover:text-dim">
                    Mark all read ({unread})
                  </button>
                )}
                {confirmClearAll ? (
                  <span className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => {
                        deleteAllMail();
                        setConfirmClearAll(false);
                        setExpanded(null);
                      }}
                      className="text-loss transition-colors hover:text-loss/80"
                    >
                      Delete all?
                    </button>
                    <button onClick={() => setConfirmClearAll(false)} className="text-faint transition-colors hover:text-dim">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmClearAll(true)}
                    className="text-xs text-faint transition-colors hover:text-loss"
                  >
                    Delete all
                  </button>
                )}
              </span>
            ) : undefined
          }
        >
          {/* Pre-grouped folders (v1.94), collapsed by default. The mail is
              filed the moment it arrives rather than piling into one list, so
              the resting state of this column is four rows and a count — the
              manager opens the folder they came for. The whole column still
              scrolls inside itself (v1.67) so the page stays one screen tall. */}
          <div className="max-h-[calc(100vh-13rem)] min-h-[18rem] space-y-2 overflow-y-auto pr-1">
            {groups.map((group) => (
              <InboxFolder
                key={group.id}
                group={group}
                open={openGroups.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
                expandedId={expanded}
                onExpand={(item) => {
                  const isOpen = expanded === item.id;
                  setExpanded(isOpen ? null : item.id);
                  if (!isOpen && !item.read) markRead(item.id);
                }}
                onDelete={(item) => {
                  if (expanded === item.id) setExpanded(null);
                  deleteMail(item.id);
                }}
                onMarkGroupRead={() => markGroupReadAction(group.id)}
                onClearGroup={() => {
                  setExpanded(null);
                  deleteGroupMail(group.id);
                }}
                hasPendingOffer={(item) =>
                  !!item.offerId && game.offers.find((o) => o.id === item.offerId)?.status === "pending"
                }
                onRespond={() => setScreen("transfers")}
              />
            ))}
            {game.inbox.length === 0 && (
              <div className="px-1 pt-1 text-center text-xs text-faint">
                Hit <span className="display text-gold">CONTINUE ▸</span> to start the season.
              </div>
            )}
          </div>
        </Section>
      </div>

      <div className="space-y-6">
        <Section title="Calendar">
          <Calendar />
        </Section>

        <Section title="Next Fixture">
          {next ? (
            <Card className="p-4">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-widest text-faint">
                <span className="min-w-0 truncate">
                  {next.competition === "CUP" ? `Cup · ${game.cup.roundNames[next.round - 1]}` : `${game.leagues[next.competition]?.name} · Round ${next.round}`}
                </span>
                {/* A derby says so on the card the manager is already looking at
                    (v1.94). The multiplier lands whether or not this is here,
                    but a bonus the player only discovers in the ledger
                    afterwards isn't a rivalry — it's an accounting quirk. */}
                {isRivalryFixture(game, next, TUNING) && (
                  <span className="display shrink-0 rounded-sm border border-loss/50 px-1.5 py-px text-[9px] font-bold tracking-wider text-loss">
                    Derby
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 py-2">
                {[game.teams[next.homeId], game.teams[next.awayId]].map((t, i) => (
                  <div key={i} className={`flex flex-1 items-center gap-2 ${i === 1 ? "flex-row-reverse text-right" : ""}`}>
                    <Crest colors={t.colors} short={t.short} size={34} />
                    <div className={`display text-sm font-bold leading-tight ${t.id === game.userTeamId ? "gold-text" : ""}`}>
                      {t.name}
                    </div>
                  </div>
                ))}
              </div>
              <div className="display text-center text-xs text-faint">{formatDay(next.day)}</div>
            </Card>
          ) : (
            <div className="text-sm text-faint">Season complete. Continue to roll over.</div>
          )}
        </Section>

        <Section
          title={league.name}
          right={lastFive.length > 0 ? <FormGuide fixtures={lastFive} userTeamId={game.userTeamId} /> : undefined}
        >
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {slice.map((row) => {
                  const t = game.teams[row.teamId];
                  const pos = table.indexOf(row) + 1;
                  const mineRow = row.teamId === game.userTeamId;
                  return (
                    <tr key={row.teamId} className={`border-b border-line last:border-0 ${mineRow ? "bg-hover" : ""}`}>
                      <td className="w-8 py-1.5 pl-3 tnum text-faint">{pos}</td>
                      <td className="py-1.5">
                        <span className={`flex items-center gap-2 ${mineRow ? "font-semibold" : ""}`}>
                          <Crest colors={t.colors} short={t.short} size={18} />
                          <span className="truncate">{t.short}</span>
                        </span>
                      </td>
                      <td className="w-10 py-1.5 text-center tnum text-dim">{row.played}</td>
                      <td className={`w-12 py-1.5 pr-3 text-right tnum font-semibold ${mineRow ? "gold-text" : ""}`}>{row.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <button onClick={() => setScreen("competition")} className="mt-2 text-xs text-faint hover:text-dim">
            Full table →
          </button>
        </Section>

        <Section title="Around the League">
          <ul className="space-y-1.5">
            {game.news.slice(0, 8).map((n, i) => (
              <li key={i} className="text-[13px] leading-snug text-dim">
                <span className="gold-text mr-1.5">·</span>
                {n}
              </li>
            ))}
            {game.news.length === 0 && <li className="text-sm text-faint">No headlines yet.</li>}
          </ul>
        </Section>
      </div>
    </div>
  );
}

/**
 * One inbox folder (v1.94): a header row that is always present, and the mail
 * inside it once opened.
 *
 * The header is the resting state of the inbox, so it carries everything needed
 * to decide whether to open it — the folder's name, how much unread mail it
 * holds, and how much mail there is in total. An empty folder still renders, in
 * a muted state with its blurb: the set of folders is fixed, and a folder that
 * came and went as post arrived would move the rest of the list under the
 * cursor.
 *
 * The per-folder actions only appear while it is open, which keeps a closed
 * inbox to one clean row per folder and puts "delete all of this" next to the
 * thing it would delete rather than above the whole mailbox.
 */
function InboxFolder({
  group,
  open,
  onToggle,
  expandedId,
  onExpand,
  onDelete,
  onMarkGroupRead,
  onClearGroup,
  hasPendingOffer,
  onRespond,
}: {
  group: InboxGroup;
  open: boolean;
  onToggle: () => void;
  expandedId: string | null;
  onExpand: (item: InboxItem) => void;
  onDelete: (item: InboxItem) => void;
  onMarkGroupRead: () => void;
  onClearGroup: () => void;
  hasPendingOffer: (item: InboxItem) => boolean;
  onRespond: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const empty = group.items.length === 0;

  return (
    <Card className={`overflow-hidden ${empty ? "opacity-60" : ""}`}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-hover"
        onClick={onToggle}
        aria-expanded={open}
        disabled={empty && !open}
        title={empty ? group.blurb : open ? "Collapse" : "Open"}
      >
        <span
          className={`text-[10px] text-faint transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▸
        </span>
        <span
          className="display text-xs font-bold uppercase tracking-wider"
          style={{ color: group.color }}
        >
          {group.label}
        </span>
        {group.unread > 0 && (
          <span
            className="display rounded-full px-1.5 py-px text-[10px] font-bold tnum text-black"
            style={{ backgroundColor: group.color }}
          >
            {group.unread}
          </span>
        )}
        <span className="ml-auto text-[11px] tnum text-faint">
          {empty ? "—" : `${group.items.length}`}
        </span>
      </button>

      {open && (
        <div className="border-t border-line/60">
          {empty ? (
            <p className="px-3 py-3 text-[12px] text-faint">{group.blurb}</p>
          ) : (
            <>
              <div className="space-y-px">
                {group.items.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    open={expandedId === item.id}
                    onExpand={() => onExpand(item)}
                    onDelete={() => onDelete(item)}
                    showRespond={hasPendingOffer(item)}
                    onRespond={onRespond}
                  />
                ))}
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-line/60 px-3 py-1.5">
                {group.unread > 0 && (
                  <button
                    onClick={onMarkGroupRead}
                    className="text-[11px] text-faint transition-colors hover:text-dim"
                  >
                    Mark read ({group.unread})
                  </button>
                )}
                {confirmClear ? (
                  <span className="flex items-center gap-2 text-[11px]">
                    <button
                      onClick={() => {
                        onClearGroup();
                        setConfirmClear(false);
                      }}
                      className="text-loss transition-colors hover:text-loss/80"
                    >
                      Delete {group.label}?
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="text-faint transition-colors hover:text-dim"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="text-[11px] text-faint transition-colors hover:text-loss"
                  >
                    Clear folder
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/** One message inside a folder. Collapsed to a headline; opening it is the act
 * that marks it read — unchanged from the flat list this replaced. */
function InboxRow({
  item,
  open,
  onExpand,
  onDelete,
  showRespond,
  onRespond,
}: {
  item: InboxItem;
  open: boolean;
  onExpand: () => void;
  onDelete: () => void;
  showRespond: boolean;
  onRespond: () => void;
}) {
  const tag = INBOX_TAG_META[item.type];
  return (
    <div className={`px-3 py-2 ${item.read && !open ? "opacity-60" : ""} ${open ? "bg-hover" : ""}`}>
      <div className="flex items-baseline gap-2">
        <button
          className="min-w-0 flex-1 text-left"
          onClick={onExpand}
          aria-expanded={open}
          title={open ? "Collapse" : "Read"}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={`flex min-w-0 items-baseline gap-1.5 text-[13px] font-semibold ${
                !item.read ? "text-ink" : "text-dim"
              }`}
            >
              {!item.read && (
                <span
                  className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-gold"
                  aria-label="Unread"
                />
              )}
              {tag && (
                <span
                  className="display shrink-0 self-center rounded-sm border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider"
                  style={{ color: tag.color, borderColor: `${tag.color}66` }}
                >
                  {tag.label}
                </span>
              )}
              {item.type === "offer" && <span className="gold-text">◈</span>}
              <span className="min-w-0 truncate">{item.title}</span>
            </span>
            <span className="shrink-0 text-[11px] tnum text-faint">{formatDayShort(item.day)}</span>
          </div>
        </button>
        <button
          onClick={onDelete}
          className="shrink-0 self-center rounded px-1 text-sm leading-none text-faint transition-colors hover:text-loss"
          title="Delete this message"
          aria-label="Delete message"
        >
          ✕
        </button>
      </div>
      {open && (
        <>
          <p className="mt-2 border-t border-line/60 pt-2 text-[13px] leading-relaxed text-dim">
            {item.body}
          </p>
          {showRespond && (
            <div className="mt-2">
              <GhostButton onClick={onRespond} className="!py-1 text-xs">
                Respond in Transfers →
              </GhostButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Last five results as W/D/L chips, oldest → newest. */
function FormGuide({ fixtures, userTeamId }: { fixtures: Fixture[]; userTeamId: string }) {
  const game = useGame((s) => s.game)!;
  return (
    <span className="flex items-center gap-1" title="Form, last 5 (oldest → newest)">
      {fixtures.map((f) => {
        const isHome = f.homeId === userTeamId;
        const gf = isHome ? f.homeGoals! : f.awayGoals!;
        const ga = isHome ? f.awayGoals! : f.homeGoals!;
        const opp = game.teams[isHome ? f.awayId : f.homeId];
        const letter = gf > ga ? "W" : gf < ga ? "L" : "D";
        const cls =
          letter === "W" ? "bg-win/15 text-win" : letter === "L" ? "bg-loss/15 text-loss" : "bg-line/40 text-dim";
        return (
          <span
            key={f.id}
            className={`display flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold ${cls}`}
            title={`${gf}–${ga} ${isHome ? "vs" : "at"} ${opp?.short ?? "?"}`}
          >
            {letter}
          </span>
        );
      })}
    </span>
  );
}
