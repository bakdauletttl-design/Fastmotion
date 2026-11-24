// Превью клипа с перемоткой: ведёшь пальцем по картинке и видишь кадры, не открывая видео.
// Кадры берутся из одной полоски-картинки (strip), где они стоят подряд.
import { Image } from "expo-image";
import React, { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Clip, withToken } from "../api";
import { c, withFont } from "../ui";

let lastScrub = 0;
/** Только что листали кадры: тогда касание не считается нажатием на клип. */
export const justScrubbed = () => Date.now() - lastScrub < 400;

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function Scrub({ clip, children }: { clip: Clip; children?: React.ReactNode }) {
  const [w, setW] = useState(0);
  const [frac, setFrac] = useState<number | null>(null); // где палец: 0..1, null — не трогают
  const left = useRef(0);
  const wRef = useRef(0);
  wRef.current = w;
  const dur = clip.source_duration ?? clip.duration;
  const frames = clip.strip ? Math.max(1, clip.strip_frames ?? Math.round(dur)) : 0;

  // простые касания без перехвата жеста: список листается как обычно, а движение вбок листает кадры
  const box = useRef<any>(null);
  const touch = useRef({ x0: 0, y0: 0, on: false });
  // на телефоне координаты лежат в самом событии, в браузере — в списке касаний
  const point = (e: any) => {
    const n = e.nativeEvent, t = n.touches?.[0] ?? n.changedTouches?.[0] ?? n;
    return { pageX: t.pageX ?? n.pageX, pageY: t.pageY ?? n.pageY };
  };
  function start(e: any) {
    const { pageX, pageY } = point(e);
    touch.current = { x0: pageX, y0: pageY, on: false };
    box.current?.measureInWindow?.((x: number) => { left.current = x; });
  }
  function move(e: any) {
    if ((e.nativeEvent.touches?.length ?? 1) > 1) return;
    const { pageX, pageY } = point(e);
    const t = touch.current;
    if (!t.on && Math.abs(pageX - t.x0) > 6 && Math.abs(pageX - t.x0) > Math.abs(pageY - t.y0)) t.on = true;
    if (t.on) {
      lastScrub = Date.now();
      setFrac(Math.min(Math.max((pageX - left.current) / Math.max(wRef.current, 1), 0), 1));
    }
  }
  function end() {
    if (touch.current.on) {
      lastScrub = Date.now();
      setTimeout(() => setFrac(null), 1500);
    }
    touch.current.on = false;
  }

  const h = (w * 9) / 16;
  const frame = frac == null || !frames ? -1 : Math.min(frames - 1, Math.floor(frac * frames));
  const t = (frac ?? 0) * dur;

  return (
    <View ref={box} onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}
          onLayout={(e) => setW(e.nativeEvent.layout.width)}
          style={{ aspectRatio: 16 / 9, borderRadius: 10, overflow: "hidden", backgroundColor: c.raised }}>
      {frame >= 0 && clip.strip ? (
        <Image source={{ uri: withToken(clip.strip) }} contentFit="fill"
               style={{ position: "absolute", top: 0, height: h, width: w * frames, left: -frame * w }} />
      ) : clip.thumb ? (
        <Image source={{ uri: withToken(clip.thumb) }} style={{ flex: 1 }} contentFit="cover" />
      ) : null}
      {frac == null ? children : (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "center", alignItems: "center" }}>
          <View style={{ backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={withFont({ color: "#fff", fontSize: 13, fontWeight: "700" })}>{clock(t)} / {clock(dur)}</Text>
          </View>
        </View>
      )}
      {/* полоска времени: где палец и где самый яркий момент */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "rgba(255,255,255,0.25)" }}>
        {clip.moment != null && <View style={{ position: "absolute", left: `${(clip.moment / dur) * 100}%`, width: 3, top: -2, bottom: 0, backgroundColor: "#FFE500" }} />}
        {frac != null && <View style={{ width: `${frac * 100}%`, height: 3, backgroundColor: c.accent }} />}
      </View>
    </View>
  );
}
