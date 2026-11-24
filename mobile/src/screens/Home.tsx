// Главный экран «Эфир»: центр управления стримом. HypeCut AI сам смотрит эфир и находит моменты,
// а стример здесь только принимает или отклоняет их. Монтаж — уже потом, в Studio.
import React, { useCallback, useEffect, useState } from "react";
import { Linking, Modal, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { api, Channel, Clip, Me, Source } from "../api";
import { L } from "../i18n";
import { Button, c, H1, Icon, P, platformColor, s, Tag } from "../ui";
import Channels from "./Channels";
import CreateClips, { ENGINE_STEPS, SCENARIOS } from "./CreateClips";
import { streamClock } from "./Clips";
import Editor from "./Editor";
import Live from "./Live";
import Scrub, { justScrubbed } from "./Scrub";

const short = (n: number) => (n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n)).replace(".0", "");
const uptime = (since: number) => {
  const t = Math.max(0, Date.now() / 1000 - since);
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
};

function Stat({ n, label, color }: { n: number; label: string; color?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: c.raised, borderRadius: 12, paddingVertical: 10, alignItems: "center" }}>
      <P style={{ fontSize: 26, fontWeight: "800", color: color ?? c.fg }}>{n}</P>
      <P dim style={{ fontSize: 12 }}>{label}</P>
    </View>
  );
}

/** Карточка канала в эфире: статус, зрители, время и что нашёл HypeCut за этот стрим. */
function LiveCard({ ch, clips, onWatch }: { ch: Channel; clips: Clip[]; onWatch: () => void }) {
  const key = (k: string) => k.replace("@", "").toLowerCase();
  const mine = clips.filter((x) => key(x.channel_key) === key(ch.key) && (!ch.live_since || x.created >= ch.live_since));
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(id); }, []);
  return (
    <View style={[s.card, { gap: 12, borderColor: c.danger }]}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: platformColor(ch.platform), alignItems: "center", justifyContent: "center" }}>
          <P style={{ color: "#fff", fontWeight: "800", fontSize: 20 }}>{(ch.display ?? ch.name).replace("@", "")[0].toUpperCase()}</P>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ backgroundColor: c.danger, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
              <P style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>● {L("В ЭФИРЕ", "LIVE", "ЭФИРДЕ")}</P>
            </View>
            <P dim style={{ fontSize: 12 }}>{ch.platform_title}</P>
          </View>
          <P style={{ fontWeight: "800", fontSize: 18 }} numberOfLines={1}>{ch.display ?? ch.name}</P>
          {(ch.title || ch.game) && <P dim numberOfLines={1} style={{ fontSize: 12 }}>{[ch.title, ch.game].filter(Boolean).join(" · ")}</P>}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 16 }}>
        {ch.viewers != null && (
          <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
            <Icon name="eye-outline" size={16} color={c.dim} />
            <P style={{ fontSize: 14 }}>{ch.viewers.toLocaleString("ru-RU")} {L("зрителей", "viewers", "көрермен")}</P>
          </View>
        )}
        {ch.live_since && (
          <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
            <Icon name="time-outline" size={16} color={c.dim} />
            <P style={{ fontSize: 14 }}>{uptime(ch.live_since)} {L("в эфире", "live", "эфирде")}</P>
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Stat n={mine.length} label={L("Найдено", "Found", "Табылды")} />
        <Stat n={mine.filter((x) => x.status === "approved").length} label={L("Принято", "Approved", "Қабылданды")} color={c.accent} />
        <Stat n={mine.filter((x) => (x.status ?? "pending") === "pending").length} label={L("Ожидают", "Waiting", "Күтуде")} color="#FFB020" />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button style={{ flex: 1 }} icon="play" title={L("Смотреть", "Watch", "Көру")} onPress={onWatch} />
        <Button style={{ flex: 1 }} kind="outline" icon="open-outline" title={L("Канал", "Channel", "Арна")} onPress={() => Linking.openURL(ch.url)} />
      </View>
    </View>
  );
}

const KIND_ICON: Record<string, React.ComponentProps<typeof Icon>["name"]> = {
  live: "radio-outline", upload: "videocam-outline", url: "link-outline", meeting: "people-outline", event: "mic-outline",
};
const len = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Длинное видео в работе: какой шаг AI-движка идёт сейчас и сколько осталось. */
function SourceCard({ x, onRemove }: { x: Source; onRemove: () => void }) {
  const steps = ENGINE_STEPS();
  const done = x.status === "done";
  const cur = steps.findIndex((st) => st.id === x.status);
  const sc = SCENARIOS().find((it) => it.id === x.scenario);
  return (
    <View style={[s.card, { gap: 10, borderWidth: 1, borderColor: done ? c.accent : c.raised }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
          <Icon name={KIND_ICON[x.kind] ?? "videocam-outline"} size={20} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <P style={{ fontWeight: "700" }} numberOfLines={1}>{x.title}</P>
          <P dim style={{ fontSize: 12 }} numberOfLines={1}>
            {[x.duration ? len(x.duration) : null, sc?.title, x.speakers.length ? `${x.speakers.length} ${L("спикера", "speakers", "спикер")}` : null].filter(Boolean).join(" · ")}
          </P>
        </View>
        <Pressable hitSlop={8} onPress={onRemove}><Icon name="close" size={18} color={c.dim} /></Pressable>
      </View>
      {done ? (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Icon name="checkmark-circle" size={18} color={c.accent} />
          <P style={{ fontSize: 13, flex: 1 }}>{L(`Готово: ${x.clips} моментов ждут решения ниже`, `Done: ${x.clips} moments are waiting below`, `Дайын: ${x.clips} сәт`)}</P>
        </View>
      ) : (
        <>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: c.raised, overflow: "hidden" }}>
            <View style={{ height: 6, width: `${Math.max(4, Math.round(x.progress * 100))}%`, backgroundColor: c.accent }} />
          </View>
          <View style={{ gap: 5 }}>
            {steps.map((st, i) => {
              const ok = i < cur, now = i === cur;
              return (
                <View key={st.id} style={{ flexDirection: "row", gap: 8, alignItems: "center", opacity: ok || now ? 1 : 0.45 }}>
                  <Icon name={ok ? "checkmark-circle" : now ? st.icon : "ellipse-outline"} size={15} color={ok || now ? c.accent : c.dim} />
                  <P style={{ fontSize: 12, fontWeight: now ? "700" : "400" }}>{st.title}{now ? "…" : ""}</P>
                </View>
              );
            })}
          </View>
          {x.speakers.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {x.speakers.map((sp) => (
                <View key={sp} style={{ flexDirection: "row", gap: 4, alignItems: "center", backgroundColor: c.raised, borderRadius: 999, paddingHorizontal: 8, height: 22 }}>
                  <Icon name="person-outline" size={11} color={c.dim} />
                  <P style={{ fontSize: 11 }}>{sp}</P>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

/** Найденный момент в очереди: посмотреть пальцем, принять, отклонить или открыть в Studio. */
function QueueItem({ clip, onReview, onOpen }: { clip: Clip; onReview: (st: "approved" | "rejected") => void; onOpen: () => void }) {
  const score = clip.score ?? 0;
  const hot = score >= 85 ? c.accent : score >= 70 ? "#FFB020" : c.dim;
  return (
    <View style={[s.card, { gap: 10, padding: 12 }]}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Pressable style={{ width: "42%" }} onPress={() => !justScrubbed() && onOpen()}>
          <Scrub clip={clip}>
            <View style={{ position: "absolute", right: 5, bottom: 6, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 4, paddingHorizontal: 5 }}>
              <P style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{Math.round(clip.duration)}{L("с", "s")}</P>
            </View>
          </Scrub>
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ borderRadius: 6, borderWidth: 1.5, borderColor: hot, paddingHorizontal: 6 }}>
              <P style={{ color: hot, fontWeight: "800", fontSize: 13 }}>{score}/100</P>
            </View>
            <P dim style={{ fontSize: 11 }} numberOfLines={1}>{clip.reason}</P>
          </View>
          <P style={{ fontWeight: "700", fontSize: 14 }} numberOfLines={2}>{clip.title ?? clip.channel}</P>
          {clip.quote ? <P style={{ fontSize: 12, fontStyle: "italic", color: c.dim }} numberOfLines={2}>«{clip.quote}»</P> : null}
          <P dim style={{ fontSize: 11 }} numberOfLines={2}>
            {[clip.source_id ? clip.channel : null,
              clip.stream_at != null ? `${L("на", "at", "")} ${streamClock(clip.stream_at)}` : null,
              clip.speaker, clip.emotion,
              clip.viewer_clips ? `${clip.viewer_clips} × !clip` : null].filter(Boolean).join(" · ")}
          </P>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={() => onReview("rejected")}
                   style={{ width: 48, height: 42, borderRadius: 10, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={22} color={c.danger} />
        </Pressable>
        <Button style={{ flex: 1, height: 42 }} kind="outline" icon="create-outline" title={L("В Studio", "Studio", "Studio")} onPress={onOpen} />
        <Button style={{ flex: 1.3, height: 42 }} icon="checkmark" title={L("Принять", "Approve", "Қабылдау")} onPress={() => onReview("approved")} />
      </View>
    </View>
  );
}

export default function Home({ me, onChange, onUpgrade, onClips }: { me: Me; onChange: () => void; onUpgrade: () => void; onClips: () => void }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);
  const [watching, setWatching] = useState<Channel | null>(null);
  const [editing, setEditing] = useState<Clip | null>(null);
  const [manage, setManage] = useState(false);
  const [all, setAll] = useState(false);
  const [create, setCreate] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setClips(await api.clips()); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); api.sources().then(setSources).catch(() => null); }, [load]);
  // пока видео разбирается, спрашиваем сервер каждые 2 секунды; как только готово — забираем новые моменты
  const working = sources.some((x) => x.status !== "done" && x.status !== "failed");
  useEffect(() => {
    if (!working) return;
    const id = setInterval(async () => {
      try {
        const next = await api.sources();
        setSources((prev) => {
          if (next.some((x) => x.status === "done" && prev.find((p) => p.id === x.id)?.status !== "done")) load();
          return next;
        });
      } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [working, load]);

  function review(id: string, status: "approved" | "rejected") {
    setClips((l) => l.map((x) => (x.id === id ? { ...x, status } : x)));
    api.review(id, status).catch(() => load());
  }

  const live = me.channels.filter((x) => x.live);
  const pending = clips.filter((x) => (x.status ?? "pending") === "pending").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const approved = clips.filter((x) => x.status === "approved");

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 24 }}
                  refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { load(); onChange(); }} tintColor={c.accent} />}>
        <View style={s.row}>
          <H1>{L("Эфир", "Live", "Эфир")}</H1>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.raised, borderRadius: 999, paddingHorizontal: 10, height: 28 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live.length ? c.accent : c.dim }} />
            <P style={{ fontSize: 12, fontWeight: "700" }}>HypeCut AI {live.length ? L("смотрит", "watching", "қарап тұр") : L("ждёт", "waiting", "күтуде")}</P>
          </View>
        </View>

        <Button icon="add" title={L("Создать клипы", "Create Clips", "Клип жасау")} onPress={() => setCreate(true)} />

        {sources.length > 0 && (
          <View style={{ gap: 10 }}>
            <P style={{ fontWeight: "800", fontSize: 17 }}>{L("Видео в работе", "Videos in progress", "Өңделіп жатқан видео")}</P>
            {sources.slice(0, 4).map((x) => (
              <SourceCard key={x.id} x={x} onRemove={() => { setSources((l) => l.filter((y) => y.id !== x.id)); api.deleteSource(x.id).catch(() => null); }} />
            ))}
          </View>
        )}

        {live.length ? live.map((ch) => <LiveCard key={ch.key} ch={ch} clips={clips} onWatch={() => setWatching(ch)} />) : (
          <View style={[s.card, { gap: 6 }]}>
            <P style={{ fontWeight: "700" }}>{L("Сейчас никто не в эфире", "Nobody is live right now", "Қазір ешкім эфирде емес")}</P>
            <P dim style={{ fontSize: 13 }}>
              {L("Как только стример включит эфир, HypeCut сам начнёт искать моменты. Ничего нажимать не нужно.",
                 "As soon as a streamer goes live, HypeCut starts finding moments by itself. Nothing to press.",
                 "Стример эфирді қосқанда HypeCut сәттерді өзі іздей бастайды.")}
            </P>
          </View>
        )}

        <View style={[s.row, { marginTop: 4 }]}>
          <P style={{ fontWeight: "800", fontSize: 17 }}>{L("Ждут решения", "Waiting for you", "Шешім күтуде")} · {pending.length}</P>
          {pending.length > 1 && (
            <Pressable onPress={() => pending.filter((x) => (x.score ?? 0) >= 80).forEach((x) => review(x.id, "approved"))}>
              <P style={{ color: c.accent, fontWeight: "700", fontSize: 13 }}>{L("Принять все от 80", "Approve all 80+", "80-нен жоғарыны қабылдау")}</P>
            </Pressable>
          )}
        </View>
        {pending.length ? (all ? pending : pending.slice(0, 3)).map((x) => (
          <QueueItem key={x.id} clip={x} onReview={(st) => review(x.id, st)} onOpen={() => setEditing(x)} />
        )) : (
          <View style={[s.card, { flexDirection: "row", gap: 10, alignItems: "center" }]}>
            <Icon name="checkmark-done" size={22} color={c.accent} />
            <P dim style={{ flex: 1, fontSize: 13 }}>{L("Все моменты разобраны. Новые появятся здесь сами.", "All caught up. New moments will appear here.", "Барлығы қаралды.")}</P>
          </View>
        )}
        {pending.length > 3 && !all && (
          <Button kind="outline" title={L(`Показать ещё ${pending.length - 3}`, `Show ${pending.length - 3} more`)} onPress={() => setAll(true)} />
        )}

        {approved.length > 0 && (
          <View style={{ gap: 10 }}>
            <View style={s.row}>
              <P style={{ fontWeight: "800", fontSize: 17 }}>{L("Готовые хайлайты", "Ready highlights", "Дайын сәттер")} · {approved.length}</P>
              <Pressable onPress={onClips}><P style={{ color: c.accent, fontWeight: "700", fontSize: 13 }}>{L("Все клипы", "All clips", "Барлық клип")}</P></Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {approved.map((x) => (
                <Pressable key={x.id} onPress={() => !justScrubbed() && setEditing(x)} style={{ width: 190, gap: 6 }}>
                  <Scrub clip={x}>
                    <View style={{ position: "absolute", left: 6, top: 6 }}><Tag>{x.score ?? 0}/100</Tag></View>
                  </Scrub>
                  <P numberOfLines={1} style={{ fontSize: 13, fontWeight: "600" }}>{x.title ?? x.channel}</P>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        <Pressable onPress={() => setManage(true)} style={[s.card, s.row, { paddingVertical: 12 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
            <Icon name="radio-outline" size={22} color={c.accent} />
            <View style={{ flex: 1 }}>
              <P style={{ fontWeight: "700" }}>{L("Каналы", "Channels", "Арналар")} · {me.channels.length}/{me.plan?.channels ?? 0}</P>
              <P dim numberOfLines={1} style={{ fontSize: 12 }}>{me.channels.map((x) => x.display ?? x.name).join(", ") || L("Добавь стримера", "Add a streamer")}</P>
            </View>
          </View>
          <Icon name="chevron-forward" size={20} color={c.dim} />
        </Pressable>
      </ScrollView>

      <Modal visible={!!watching} animationType="slide" onRequestClose={() => setWatching(null)}>
        {watching && <Live channel={watching} me={me} onClose={() => { setWatching(null); load(); }} />}
      </Modal>
      <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing && <Editor clip={editing} me={me} onClose={() => setEditing(null)} />}
      </Modal>
      <Modal visible={create} animationType="slide" onRequestClose={() => setCreate(false)}>
        <CreateClips me={me} onClose={() => setCreate(false)} onLive={() => { setCreate(false); setManage(true); }}
                     onStarted={(x) => { setCreate(false); setSources((l) => [x, ...l.filter((y) => y.id !== x.id)]); onChange(); }}
                     onPlans={() => { setCreate(false); onUpgrade(); }} />
      </Modal>
      <Modal visible={manage} animationType="slide" onRequestClose={() => setManage(false)}>
        <View style={{ flex: 1, backgroundColor: c.bg, padding: 16 }}>
          <Pressable hitSlop={10} onPress={() => setManage(false)} style={{ alignSelf: "flex-end" }}><Icon name="close" size={26} /></Pressable>
          <Channels me={me} onChange={onChange} onUpgrade={() => { setManage(false); onUpgrade(); }} />
        </View>
      </Modal>
    </View>
  );
}
