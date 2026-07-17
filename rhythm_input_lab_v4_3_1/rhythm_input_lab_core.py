from __future__ import annotations

import argparse, csv, html, json, math, os, re, statistics, time, webbrowser
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Sequence

from fnf_importer import (
    build_chart_comparison,
    load_chart_bundle,
    merge_event_bundle,
    normalize_fnf_chart,
    render_attempt_chart_section,
    write_chart_bundle,
)

APP_NAME = "Rhythm Input Lab"
APP_VERSION = "4.3"
SUPPORTED = range(4, 10)
SETTINGS_DIR = Path(os.environ.get("APPDATA", Path.home())) / "RhythmInputLab"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"

DEFAULT_PROFILES = {
    "4": {"enabled": True, "keys": ["a", "s", "k", "l"]},
    "5": {"enabled": True, "keys": ["a", "s", "space", "k", "l"]},
    "6": {"enabled": True, "keys": ["s", "d", "f", "j", "k", "l"]},
    "7": {"enabled": True, "keys": ["s", "d", "f", "space", "j", "k", "l"]},
    "8": {"enabled": True, "keys": ["a", "s", "d", "f", "h", "j", "k", "l"]},
    "9": {"enabled": True, "keys": ["a", "s", "d", "f", "space", "h", "j", "k", "l"]},
}
DEFAULTS = {
    "profiles": DEFAULT_PROFILES,
    "dodge": {"enabled": False, "key": "space", "double_min_ms": 65.0, "double_max_ms": 350.0, "cluster_gap_ms": 500.0},
    "controls": {"start_key": "f8", "stop_key": "f9"},
    "output_root": str(Path.home() / "Documents" / "RhythmInputLab"),
    "open_report": True,
    "post_note_prompt": True,
    "live_counters": True,
    "chart": {
        "hit_window_ms": 166.6667,
        "perfect_window_ms": 45.0,
        "good_window_ms": 90.0,
        "bad_window_ms": 135.0,
        "safe_frames": 10.0,
        "safe_fps": 60.0,
        "event_window_ms": 500.0,
    },
    "thresholds": {
        "chord_ms": 35.0,
        "jack_ms": 250.0,
        "alt_ms": 250.0,
        "dense_ms": 250.0,
        "nps_window_ms": 1000.0,
        "nps_step_ms": 250.0,
        "segment_ms": 5000.0,
    },
}
ALIASES = {
    " ": "space", "spacebar": "space", "left shift": "shift_l", "right shift": "shift_r",
    "lshift": "shift_l", "rshift": "shift_r", "left ctrl": "ctrl_l", "right ctrl": "ctrl_r",
    "lctrl": "ctrl_l", "rctrl": "ctrl_r", "left alt": "alt_l", "right alt": "alt_r",
    "lalt": "alt_l", "ralt": "alt_r", "up arrow": "up", "down arrow": "down",
    "left arrow": "left", "right arrow": "right", "semicolon": ";", "comma": ",",
    "period": ".", "slash": "/",
}
INVALID_NAMES = {"con", "prn", "aux", "nul", *[f"com{i}" for i in range(1, 10)], *[f"lpt{i}" for i in range(1, 10)]}

@dataclass
class Event:
    time_ms: float
    key: str
    role: str
    event: str
    held_ms: Optional[float] = None

@dataclass
class Press:
    time_ms: float
    key: str
    role: str
    held_ms: Optional[float] = None

def clone(v: Any) -> Any:
    return json.loads(json.dumps(v))

def merge(current: Any, default: Any) -> Any:
    if isinstance(default, dict):
        current = current if isinstance(current, dict) else {}
        out = {k: merge(current.get(k), v) for k, v in default.items()}
        out.update({k: v for k, v in current.items() if k not in out})
        return out
    return default if current is None else current

def norm_key(value: Any) -> str:
    text = str(value).strip().lower()
    return ALIASES.get(text, text)

def parse_keys(text: str) -> list[str]:
    return [norm_key(x) for x in text.split(",") if norm_key(x)]

def key_name(key: Any) -> str:
    try:
        from pynput import keyboard
        if isinstance(key, keyboard.KeyCode):
            if key.char is not None:
                return key.char.lower()
            if key.vk is not None:
                return f"vk_{key.vk}"
    except Exception:
        pass
    text = str(key)
    return text[4:].lower() if text.startswith("Key.") else text.lower()

def save_settings(settings: dict) -> None:
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2), encoding="utf-8")

def validate(settings: dict) -> dict:
    for n in SUPPORTED:
        p = settings["profiles"].setdefault(str(n), clone(DEFAULT_PROFILES[str(n)]))
        p["enabled"] = bool(p.get("enabled", True))
        keys = [norm_key(k) for k in p.get("keys", [])]
        p["keys"] = keys if len(keys) == n and len(set(keys)) == n else clone(DEFAULT_PROFILES[str(n)])["keys"]
    settings["dodge"]["key"] = norm_key(settings["dodge"].get("key", "space"))
    settings["controls"]["start_key"] = norm_key(settings["controls"].get("start_key", "f8"))
    settings["controls"]["stop_key"] = norm_key(settings["controls"].get("stop_key", "f9"))
    if settings["controls"]["start_key"] == settings["controls"]["stop_key"]:
        settings["controls"] = {"start_key": "f8", "stop_key": "f9"}
    settings["output_root"] = str(Path(settings.get("output_root") or DEFAULTS["output_root"]).expanduser())
    return settings

def load_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            current = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            current = {}
    else:
        current = {}
    settings = validate(merge(current, DEFAULTS))
    save_settings(settings)
    return settings

def safe_name(text: str, fallback: str = "Untitled Song") -> str:
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text.strip())
    text = re.sub(r"\s+", " ", text).strip(" .") or fallback
    if text.casefold() in INVALID_NAMES:
        text = "_" + text
    return text[:120]

def song_id(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", safe_name(text).casefold()).strip("-") or "untitled-song"

def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    return input(f"{prompt}{suffix}: ").strip() or default

def ask_bool(prompt: str, default: bool) -> bool:
    value = input(f"{prompt} [{'Y/n' if default else 'y/N'}]: ").strip().lower()
    return default if not value else value in {"y", "yes", "1", "true", "on"}

def avg(values: Sequence[float]) -> Optional[float]:
    return statistics.fmean(values) if values else None

def med(values: Sequence[float]) -> Optional[float]:
    return statistics.median(values) if values else None

def dev(values: Sequence[float]) -> Optional[float]:
    return statistics.pstdev(values) if len(values) > 1 else None

def pct(values: Sequence[float], p: float) -> Optional[float]:
    if not values: return None
    ordered = sorted(values)
    pos = (len(ordered) - 1) * p
    lo, hi = math.floor(pos), math.ceil(pos)
    return ordered[lo] if lo == hi else ordered[lo] * (hi-pos) + ordered[hi] * (pos-lo)

def fnum(value: Optional[float], digits: int = 1, suffix: str = "") -> str:
    return "—" if value is None else f"{value:.{digits}f}{suffix}"

def ftime(ms: Optional[float]) -> str:
    if ms is None: return "—"
    seconds = max(0.0, ms / 1000)
    return f"{int(seconds//60)}:{seconds%60:05.2f}"

def load_events(path: Path) -> list[Event]:
    out: list[Event] = []
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not {"time_ms", "key", "event"}.issubset(reader.fieldnames or []):
            raise ValueError("CSV needs time_ms, key, and event columns")
        for row_no, row in enumerate(reader, 2):
            try:
                kind = row["event"].strip().lower()
                if kind not in {"down", "up"}: continue
                held = (row.get("held_ms") or "").strip()
                role = (row.get("role") or "lane").strip().lower()
                out.append(Event(float(row["time_ms"]), norm_key(row["key"]), role if role in {"lane","dodge"} else "lane", kind, float(held) if held else None))
            except Exception as exc:
                raise ValueError(f"Bad CSV row {row_no}: {exc}") from exc
    out.sort(key=lambda x: x.time_ms)
    if not out: raise ValueError("No usable events found")
    return out

def pair_presses(events: Sequence[Event]) -> list[Press]:
    presses: list[Press] = []
    waiting: dict[tuple[str,str], deque[int]] = defaultdict(deque)
    for e in events:
        ident = (e.key, e.role)
        if e.event == "down":
            presses.append(Press(e.time_ms, e.key, e.role))
            waiting[ident].append(len(presses)-1)
        elif waiting[ident]:
            idx = waiting[ident].popleft()
            presses[idx].held_ms = max(0.0, e.held_ms if e.held_ms is not None else e.time_ms - presses[idx].time_ms)
    return presses

def detect_chords(presses: Sequence[Press], window: float) -> list[dict]:
    out, i = [], 0
    while i < len(presses):
        start, group, seen, j = presses[i].time_ms, [presses[i]], {presses[i].key}, i+1
        while j < len(presses) and presses[j].time_ms - start <= window:
            if presses[j].key not in seen:
                group.append(presses[j]); seen.add(presses[j].key)
            j += 1
        if len(group) >= 2:
            out.append({"time_ms": start, "keys": [p.key for p in group], "size": len(group), "span_ms": group[-1].time_ms-group[0].time_ms})
            i = j
        else: i += 1
    return out

def detect_jacks(presses: Sequence[Press], max_gap: float) -> dict:
    by_key: dict[str,list[Press]] = defaultdict(list)
    for p in presses: by_key[p.key].append(p)
    runs, pairs = [], 0
    for key, lane in by_key.items():
        start = 0
        for i in range(1, len(lane)+1):
            broken = i == len(lane) or lane[i].time_ms-lane[i-1].time_ms > max_gap
            if broken:
                if i-start >= 2:
                    gaps = [lane[j].time_ms-lane[j-1].time_ms for j in range(start+1,i)]
                    pairs += len(gaps)
                    runs.append({"key":key,"start_ms":lane[start].time_ms,"end_ms":lane[i-1].time_ms,"presses":i-start,"average_gap_ms":avg(gaps),"fastest_gap_ms":min(gaps)})
                start = i
    runs.sort(key=lambda r:(r["presses"],-(r["average_gap_ms"] or 0)), reverse=True)
    return {"pair_count":pairs,"run_count":len(runs),"longest_run":runs[0] if runs else None,"top_runs":runs[:15]}

def detect_alternating(presses: Sequence[Press], max_gap: float) -> list[dict]:
    out, i = [], 0
    while i <= len(presses)-4:
        a,b = presses[i], presses[i+1]
        if a.key == b.key or b.time_ms-a.time_ms > max_gap:
            i += 1; continue
        ka,kb,expected,j = a.key,b.key,a.key,i+2
        while j < len(presses):
            if presses[j].time_ms-presses[j-1].time_ms > max_gap or presses[j].key != expected: break
            expected = kb if expected == ka else ka
            j += 1
        if j-i >= 4:
            gaps = [presses[x].time_ms-presses[x-1].time_ms for x in range(i+1,j)]
            out.append({"start_ms":a.time_ms,"end_ms":presses[j-1].time_ms,"keys":[ka,kb],"presses":j-i,"average_gap_ms":avg(gaps)})
            i = j
        else: i += 1
    out.sort(key=lambda r:(r["presses"],-(r["average_gap_ms"] or 0)), reverse=True)
    return out

def detect_dense(presses: Sequence[Press], max_gap: float) -> list[dict]:
    out, start = [], 0
    for i in range(1, len(presses)+1):
        broken = i == len(presses) or presses[i].time_ms-presses[i-1].time_ms > max_gap
        if broken:
            if i-start >= 4:
                gaps = [presses[j].time_ms-presses[j-1].time_ms for j in range(start+1,i)]
                out.append({"start_ms":presses[start].time_ms,"end_ms":presses[i-1].time_ms,"presses":i-start,"average_gap_ms":avg(gaps)})
            start = i
    out.sort(key=lambda r:(r["presses"],-(r["average_gap_ms"] or 0)), reverse=True)
    return out

def peak_window(presses: Sequence[Press], window_ms: float) -> dict:
    if not presses: return {"nps":0.0,"presses":0,"start_ms":None,"end_ms":None}
    times=[p.time_ms for p in presses]; left=best=0; start=times[0]
    for right,current in enumerate(times):
        while current-times[left] >= window_ms: left += 1
        count=right-left+1
        if count>best: best,start=count,times[left]
    return {"nps":best/(window_ms/1000),"presses":best,"start_ms":start,"end_ms":start+window_ms}

def rolling_nps(presses: Sequence[Press], start: float, end: float, window: float, step: float) -> list[dict]:
    times=[p.time_ms for p in presses]; out=[]; left=right=0; center=start
    while center <= end:
        low,high=center-window/2,center+window/2
        while left<len(times) and times[left]<low: left += 1
        right=max(right,left)
        while right<len(times) and times[right]<high: right += 1
        out.append({"time_ms":center,"nps":(right-left)/(window/1000)})
        center += step
    return out

def dodge_clusters(dodges: Sequence[Press], cfg: dict) -> dict:
    if not dodges:
        return {"total_presses":0,"cluster_count":0,"single_candidates":0,"double_candidates":0,"panic_clusters":0,"median_double_gap_ms":None,"fastest_double_gap_ms":None,"clusters":[]}
    groups, current = [], [dodges[0]]
    for p in dodges[1:]:
        if p.time_ms-current[-1].time_ms <= float(cfg["cluster_gap_ms"]): current.append(p)
        else: groups.append(current); current=[p]
    groups.append(current)
    singles=doubles=panic=0; double_gaps=[]; rows=[]
    for group in groups:
        gaps=[group[i].time_ms-group[i-1].time_ms for i in range(1,len(group))]
        if len(group)==1: kind="single"; singles+=1
        elif len(group)==2 and float(cfg["double_min_ms"]) <= gaps[0] <= float(cfg["double_max_ms"]):
            kind="double_candidate"; doubles+=1; double_gaps.append(gaps[0])
        else: kind="panic_or_multi"; panic+=1
        rows.append({"start_ms":group[0].time_ms,"end_ms":group[-1].time_ms,"presses":len(group),"gaps_ms":gaps,"kind":kind})
    return {"total_presses":len(dodges),"cluster_count":len(groups),"single_candidates":singles,"double_candidates":doubles,"panic_clusters":panic,"median_double_gap_ms":med(double_gaps),"fastest_double_gap_ms":min(double_gaps) if double_gaps else None,"clusters":rows}

def dodge_interactions(lanes: Sequence[Press], dodges: Sequence[Press]) -> dict:
    if not dodges: return {"median_lane_gap_before_ms":None,"median_lane_gap_after_ms":None,"lane_presses_within_100ms":0,"lane_presses_within_250ms":0}
    times=[p.time_ms for p in lanes]; before=[]; after=[]; n100=n250=0
    for d in dodges:
        earlier=[t for t in times if t<=d.time_ms]; later=[t for t in times if t>=d.time_ms]
        if earlier: before.append(d.time_ms-earlier[-1])
        if later: after.append(later[0]-d.time_ms)
        for t in times:
            dist=abs(t-d.time_ms)
            if dist<=100:n100+=1
            if dist<=250:n250+=1
    return {"median_lane_gap_before_ms":med(before),"median_lane_gap_after_ms":med(after),"lane_presses_within_100ms":n100,"lane_presses_within_250ms":n250}

def segments(lanes: Sequence[Press], dodges: Sequence[Press], chords: Sequence[dict], start: float, end: float, size: float) -> list[dict]:
    out=[]; cursor=start
    while cursor<end:
        finish=min(end,cursor+size)
        lp=[p for p in lanes if cursor<=p.time_ms<finish]; dp=[p for p in dodges if cursor<=p.time_ms<finish]
        holds=[p.held_ms for p in lp if p.held_ms is not None]
        out.append({"start_ms":cursor,"end_ms":finish,"lane_presses":len(lp),"dodge_presses":len(dp),"average_lane_nps":len(lp)/max(.001,(finish-cursor)/1000),"chords":sum(1 for c in chords if cursor<=c["time_ms"]<finish),"median_hold_ms":med(holds),"hold_stdev_ms":dev(holds)})
        cursor=finish
    return out

def analyze_inputs(events: Sequence[Event], metadata: dict, settings: dict) -> dict:
    presses=pair_presses(events); lanes=[p for p in presses if p.role=="lane"]; dodges=[p for p in presses if p.role=="dodge"]
    if not lanes: raise ValueError("No lane presses found")
    order=[norm_key(k) for k in metadata.get("lane_keys",[])]; order += [p.key for p in lanes if p.key not in order]
    lane_gaps=[lanes[i].time_ms-lanes[i-1].time_ms for i in range(1,len(lanes))]
    holds=[p.held_ms for p in lanes if p.held_ms is not None]
    per_lane={}
    for idx,key in enumerate(order,1):
        lp=[p for p in lanes if p.key==key]; h=[p.held_ms for p in lp if p.held_ms is not None]; repeats=[lp[i].time_ms-lp[i-1].time_ms for i in range(1,len(lp))]
        per_lane[key]={"lane_index":idx,"presses":len(lp),"share_percent":len(lp)/len(lanes)*100,"median_hold_ms":med(h),"mean_hold_ms":avg(h),"hold_stdev_ms":dev(h),"median_repeat_gap_ms":med(repeats),"fastest_repeat_gap_ms":min(repeats) if repeats else None}
    t=settings["thresholds"]; chords=detect_chords(lanes,float(t["chord_ms"])); chord_sizes=Counter(c["size"] for c in chords)
    jacks=detect_jacks(lanes,float(t["jack_ms"])); alts=detect_alternating(lanes,float(t["alt_ms"])); dense=detect_dense(lanes,float(t["dense_ms"]))
    start=min(p.time_ms for p in presses); end=max(p.time_ms for p in presses); lane_start, lane_end=lanes[0].time_ms,lanes[-1].time_ms
    segs=segments(lanes,dodges,chords,start,end,float(t["segment_ms"])); hottest=sorted(segs,key=lambda s:(s["average_lane_nps"],s["chords"]),reverse=True)[:8]
    dodge=dodge_clusters(dodges,settings["dodge"]); dodge["interaction"]=dodge_interactions(lanes,dodges)
    split=math.ceil(len(order)/2); left=set(order[:split]); right=set(order[split:]); lc=sum(p.key in left for p in lanes); rc=sum(p.key in right for p in lanes)
    return {
        "app":APP_NAME,"version":APP_VERSION,"metadata":metadata,
        "recording":{"event_count":len(events),"all_press_count":len(presses),"lane_press_count":len(lanes),"dodge_press_count":len(dodges),"active_duration_ms":end-start,"lane_active_duration_ms":lane_end-lane_start,"average_lane_nps":len(lanes)/max(.001,(lane_end-lane_start)/1000)},
        "timing":{"median_interpress_ms":med(lane_gaps),"mean_interpress_ms":avg(lane_gaps),"interpress_stdev_ms":dev(lane_gaps),"p10_interpress_ms":pct(lane_gaps,.1),"p90_interpress_ms":pct(lane_gaps,.9),"median_hold_ms":med(holds),"mean_hold_ms":avg(holds),"hold_stdev_ms":dev(holds),"p10_hold_ms":pct(holds,.1),"p90_hold_ms":pct(holds,.9)},
        "per_lane":per_lane,
        "side_split":{"left_keys":order[:split],"right_keys":order[split:],"left_presses":lc,"right_presses":rc,"left_share_percent":lc/len(lanes)*100,"right_share_percent":rc/len(lanes)*100,"note":"For odd key modes, the center lane is included in the left group."},
        "chords":{"count":len(chords),"presses_inside_chords":sum(c["size"] for c in chords),"press_share_percent":sum(c["size"] for c in chords)/len(lanes)*100,"size_counts":{str(k):v for k,v in sorted(chord_sizes.items())},"largest_size":max(chord_sizes,default=1),"median_span_ms":med([c["span_ms"] for c in chords]),"examples":chords[:30]},
        "jacks":jacks,
        "alternating_runs":{"count":len(alts),"longest":alts[0] if alts else None,"top_runs":alts[:15]},
        "dense_runs":{"count":len(dense),"longest":dense[0] if dense else None,"top_runs":dense[:15]},
        "speed":{"peak_1s":peak_window(lanes,1000),"peak_2s":peak_window(lanes,2000),"peak_5s":peak_window(lanes,5000),"nps_series":rolling_nps(lanes,lane_start,lane_end,float(t["nps_window_ms"]),float(t["nps_step_ms"])),"segments":segs,"hottest_segments":hottest},
        "dodge":dodge,
        "method_notes":{"thresholds":t,"limitations":["Physical inputs are not note accuracy or misses.","Dodge candidates are not confirmed successful dodges.","Pattern labels are timing heuristics.","Chart and replay importing are intentionally deferred."]},
    }


def analyze(events: Sequence[Event], metadata: dict, settings: dict, chart_bundle: Optional[dict] = None) -> dict:
    data = analyze_inputs(events, metadata, settings)
    if chart_bundle:
        presses = pair_presses(events)
        lane_presses = [
            {"time_ms": p.time_ms, "key": p.key, "held_ms": p.held_ms}
            for p in presses if p.role == "lane"
        ]
        dodge_presses = [
            {"time_ms": p.time_ms, "key": p.key, "held_ms": p.held_ms}
            for p in presses if p.role == "dodge"
        ]
        lane_keys = metadata.get("lane_keys", [])
        try:
            data["chart"] = build_chart_comparison(
                chart_bundle, lane_presses, dodge_presses, lane_keys, settings.get("chart", {})
            )
        except Exception as exc:
            data["chart"] = {
                "available": False,
                "error": str(exc),
                "limitations": ["The raw input analysis was still generated."],
            }
    data["method_notes"]["limitations"] = [
        "Physical input analysis is independent from the game's score screen.",
        "Chart hit/miss values are estimates unless the engine's replay or judgment data is imported.",
        "Dodge event matches are input estimates, not game-confirmed successes.",
        "Unknown FNF events and note types are preserved in mappings.json.",
    ]
    return data

def card(label: str, value: str, note: str="") -> str:
    return f'<div class="card"><div class="label">{html.escape(label)}</div><div class="big">{html.escape(value)}</div>{f"<div class=note>{html.escape(note)}</div>" if note else ""}</div>'

def svg_line(points: Sequence[dict], width=960, height=280) -> str:
    if not points:return '<p class="muted">No speed data.</p>'
    xs=[float(p["time_ms"]) for p in points]; ys=[float(p["nps"]) for p in points]; minx,maxx=min(xs),max(xs); maxy=max(max(ys),1)
    L,R,T,B=52,18,18,38; iw,ih=width-L-R,height-T-B
    xp=lambda x:L if maxx==minx else L+(x-minx)/(maxx-minx)*iw
    yp=lambda y:T+ih-y/maxy*ih
    poly=" ".join(f"{xp(x):.1f},{yp(y):.1f}" for x,y in zip(xs,ys)); parts=[]
    for i in range(5):
        val=maxy*i/4;y=yp(val);parts.append(f'<line x1="{L}" y1="{y:.1f}" x2="{width-R}" y2="{y:.1f}" class="grid"/><text x="{L-8}" y="{y+4:.1f}" text-anchor="end" class="axis">{val:.1f}</text>')
    for i in range(5):
        val=minx+(maxx-minx)*i/4;x=xp(val);parts.append(f'<text x="{x:.1f}" y="{height-10}" text-anchor="middle" class="axis">{html.escape(ftime(val))}</text>')
    parts.append(f'<polyline points="{poly}" class="line"/>')
    return f'<svg class="chart" viewBox="0 0 {width} {height}">{"".join(parts)}</svg>'

def svg_bars(per_lane: dict, width=960, height=260) -> str:
    items=list(per_lane.items()); maximum=max((d["presses"] for _,d in items),default=1); L,R,T,B=30,20,20,46; iw,ih=width-L-R,height-T-B; slot=iw/max(1,len(items)); bw=min(70,slot*.62); parts=[]
    for i,(key,data) in enumerate(items):
        x=L+i*slot+(slot-bw)/2; bh=data["presses"]/maximum*ih; y=T+ih-bh
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{bh:.1f}" rx="7" class="bar"/><text x="{x+bw/2:.1f}" y="{y-7:.1f}" text-anchor="middle" class="value">{data["presses"]}</text><text x="{x+bw/2:.1f}" y="{height-14}" text-anchor="middle" class="axis">{html.escape(key.upper())}</text>')
    return f'<svg class="chart" viewBox="0 0 {width} {height}">{"".join(parts)}</svg>'

def render_report(data: dict, path: Path) -> None:
    m=data["metadata"];r=data["recording"];t=data["timing"];s=data["speed"];c=data["chords"];d=data["dodge"];split=data["side_split"]
    overview="".join([
        card("Lane presses",f'{r["lane_press_count"]:,}'),card("Dodge presses",f'{r["dodge_press_count"]:,}'),card("Active span",ftime(r["active_duration_ms"])),
        card("Average lane NPS",fnum(r["average_lane_nps"],2)),card("Peak 1-second NPS",fnum(s["peak_1s"]["nps"],1),f'at {ftime(s["peak_1s"]["start_ms"])}'),card("Median lane hold",fnum(t["median_hold_ms"],1," ms"))])
    patterns="".join([card("Chord groups",str(c["count"]),f'{fnum(c["press_share_percent"],1,"%")} of presses'),card("Largest chord",str(c["largest_size"])),card("Jack-like pairs",str(data["jacks"]["pair_count"])),card("Alternating runs",str(data["alternating_runs"]["count"])),card("Longest dense run",f'{data["dense_runs"]["longest"]["presses"]} presses' if data["dense_runs"]["longest"] else "—"),card("Peak 5-second NPS",fnum(s["peak_5s"]["nps"],1))])
    dodge_cards="".join([card("Dodge clusters",str(d["cluster_count"])),card("Single candidates",str(d["single_candidates"])),card("Double candidates",str(d["double_candidates"])),card("Panic/multi clusters",str(d["panic_clusters"])),card("Median double gap",fnum(d["median_double_gap_ms"],1," ms")),card("Median lane resume",fnum(d["interaction"]["median_lane_gap_after_ms"],1," ms"))])
    lane_rows="".join(f'<tr><td>{x["lane_index"]}</td><td><strong>{html.escape(k.upper())}</strong></td><td>{x["presses"]}</td><td>{fnum(x["share_percent"],1,"%")}</td><td>{fnum(x["median_hold_ms"],1," ms")}</td><td>{fnum(x["hold_stdev_ms"],1," ms")}</td><td>{fnum(x["fastest_repeat_gap_ms"],1," ms")}</td></tr>' for k,x in data["per_lane"].items())
    hot_rows="".join(f'<tr><td>{ftime(x["start_ms"])}</td><td>{ftime(x["end_ms"])}</td><td>{x["lane_presses"]}</td><td>{fnum(x["average_lane_nps"],2)}</td><td>{x["chords"]}</td><td>{x["dodge_presses"]}</td></tr>' for x in s["hottest_segments"])
    tags=", ".join(m.get("tags",[])) or "none"; note=m.get("post_play_note") or "none"; subtitle=" · ".join(x for x in [f'{m.get("key_count","?")}K',m.get("difficulty",""),m.get("game","")] if x)
    page=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(m.get("song_name","Untitled"))}</title><style>
:root{{color-scheme:light dark;font-family:Inter,system-ui,sans-serif;background:Canvas;color:CanvasText}}*{{box-sizing:border-box}}body{{margin:0;background:Canvas;color:CanvasText;line-height:1.45}}main{{width:min(1140px,calc(100% - 32px));margin:auto;padding:38px 0 64px}}h1{{margin:5px 0 6px;font-size:clamp(2rem,5vw,3.8rem);letter-spacing:-.045em;line-height:1}}h2{{margin:0 0 14px;font-size:1.25rem}}p{{margin:0}}.muted{{opacity:.65}}.eyebrow{{opacity:.62;font-size:.84rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase}}.section{{border:1px solid color-mix(in srgb,CanvasText 17%,transparent);border-radius:18px;padding:20px;margin-top:18px;background:color-mix(in srgb,CanvasText 3%,Canvas)}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px}}.card{{min-height:110px;padding:15px;border-radius:14px;border:1px solid color-mix(in srgb,CanvasText 14%,transparent);background:Canvas}}.label{{opacity:.65;font-size:.82rem;font-weight:650}}.big{{margin-top:7px;font-size:1.65rem;font-weight:760;letter-spacing:-.035em}}.note{{margin-top:5px;opacity:.58;font-size:.76rem}}.chart{{width:100%;height:auto;display:block}}.grid{{stroke:currentColor;opacity:.1;stroke-width:1}}.line{{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}}.bar{{fill:currentColor;opacity:.78}}.axis,.value{{fill:currentColor;font-family:inherit;font-size:12px}}.axis{{opacity:.58}}.value{{opacity:.82;font-weight:700}}.tablewrap{{overflow-x:auto}}table{{width:100%;border-collapse:collapse;font-size:.91rem}}th,td{{padding:10px 12px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent);text-align:right;white-space:nowrap}}th:first-child,td:first-child{{text-align:left}}th{{opacity:.62;font-size:.76rem;text-transform:uppercase;letter-spacing:.055em}}.callout{{padding:14px 16px;border-left:4px solid currentColor;background:color-mix(in srgb,CanvasText 5%,Canvas);border-radius:8px;opacity:.82}}.meta{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:14px}}.meta div{{padding:10px 12px;border-radius:10px;background:color-mix(in srgb,CanvasText 5%,Canvas)}}footer{{margin-top:24px;opacity:.54;font-size:.8rem}}</style></head><body><main>
<header><div class="eyebrow">Rhythm Input Lab {APP_VERSION}</div><h1>{html.escape(m.get("song_name","Untitled"))}</h1><p class="muted">{html.escape(subtitle)}</p><div class="meta"><div><strong>Attempt:</strong> {m.get("attempt_number","—")}</div><div><strong>Tags:</strong> {html.escape(tags)}</div><div><strong>Note:</strong> {html.escape(note)}</div></div></header>
<section class="section"><h2>Session overview</h2><div class="cards">{overview}</div></section><section class="section"><h2>Lane speed over time</h2><p class="muted">Dodge presses are excluded from NPS.</p>{svg_line(s["nps_series"])}</section><section class="section"><h2>Pattern heuristics</h2><div class="cards">{patterns}</div></section><section class="section"><h2>Dodge input</h2><div class="cards">{dodge_cards}</div><p class="callout" style="margin-top:14px">Dodge clusters are input attempts, not confirmed successful sawblade dodges.</p></section><section class="section"><h2>Lane usage</h2>{svg_bars(data["per_lane"])}<div class="tablewrap"><table><thead><tr><th>Index</th><th>Key</th><th>Presses</th><th>Share</th><th>Median hold</th><th>Hold deviation</th><th>Fastest repeat</th></tr></thead><tbody>{lane_rows}</tbody></table></div></section><section class="section"><h2>Side split</h2><div class="cards">{card("Left share",fnum(split["left_share_percent"],1,"%"),", ".join(k.upper() for k in split["left_keys"]))}{card("Right share",fnum(split["right_share_percent"],1,"%"),", ".join(k.upper() for k in split["right_keys"]))}</div><p class="muted" style="margin-top:10px">{html.escape(split["note"])}</p></section><section class="section"><h2>Highest-density sections</h2><div class="tablewrap"><table><thead><tr><th>Start</th><th>End</th><th>Lane presses</th><th>Average NPS</th><th>Chords</th><th>Dodges</th></tr></thead><tbody>{hot_rows}</tbody></table></div></section><footer>Generated locally by {APP_NAME} {APP_VERSION}. Raw input data is preserved separately.</footer></main></body></html>'''
    chart_section = render_attempt_chart_section(data.get("chart"))
    if chart_section:
        page = page.replace("<footer>", chart_section + "<footer>")
    path.write_text(page,encoding="utf-8")

def write_csv(events: Sequence[Event], path: Path) -> None:
    with path.open("w",newline="",encoding="utf-8") as f:
        w=csv.writer(f);w.writerow(["time_ms","key","role","event","held_ms"])
        for e in events:w.writerow([f"{e.time_ms:.3f}",e.key,e.role,e.event,"" if e.held_ms is None else f"{e.held_ms:.3f}"])

def resolve_song_folder(root: Path, name: str) -> Path:
    root.mkdir(parents=True,exist_ok=True); sid=song_id(name)
    for child in root.iterdir():
        meta=child/"song.json"
        if child.is_dir() and meta.exists():
            try:
                if json.loads(meta.read_text(encoding="utf-8")).get("song_id")==sid:return child
            except Exception:pass
    folder=root/safe_name(name);n=2
    while folder.exists():folder=root/f"{safe_name(name)} ({n})";n+=1
    folder.mkdir();(folder/"song.json").write_text(json.dumps({"song_name":name,"song_id":sid},indent=2),encoding="utf-8")
    return folder

def next_attempt(folder: Path) -> int:
    nums=[]
    for child in folder.iterdir():
        m=re.match(r"Attempt (\d+)",child.name)
        if child.is_dir() and m:nums.append(int(m.group(1)))
    return max(nums,default=0)+1

def write_attempt(folder: Path, events: Sequence[Event], metadata: dict, settings: dict) -> dict:
    if not (folder/"inputs.csv").exists():
        write_csv(events,folder/"inputs.csv")
    (folder/"session.json").write_text(json.dumps(metadata,indent=2),encoding="utf-8")
    chart_bundle = load_chart_bundle(folder.parent)
    data=analyze(events,metadata,settings,chart_bundle=chart_bundle);(folder/"analysis.json").write_text(json.dumps(data,indent=2),encoding="utf-8");render_report(data,folder/"report.html");return data

def history(song_folder: Path) -> Optional[Path]:
    attempts=[]
    for folder in sorted(song_folder.iterdir()):
        p=folder/"analysis.json"
        if folder.is_dir() and p.exists():
            try:attempts.append((folder,json.loads(p.read_text(encoding="utf-8"))))
            except Exception:pass
    if not attempts:return None
    rows=[]
    for folder,data in attempts:
        m=data["metadata"];r=data["recording"];s=data["speed"];d=data["dodge"];chart=data.get("chart",{});match=chart.get("matching",{}) if chart.get("available") else {}
        rows.append(f'<tr><td><a href="{html.escape(folder.name)}/report.html">{m.get("attempt_number","—")}</a></td><td>{html.escape(m.get("recorded_at",""))}</td><td>{m.get("key_count","?")}K</td><td>{r["lane_press_count"]}</td><td>{ftime(r["active_duration_ms"])}</td><td>{fnum(r["average_lane_nps"],2)}</td><td>{fnum(s["peak_1s"]["nps"],1)}</td><td>{d["total_presses"]}</td><td>{d["double_candidates"]}</td><td>{fnum(match.get("estimated_match_percent"),2,"%")}</td><td>{match.get("estimated_misses","—")}</td><td>{html.escape(m.get("post_play_note","") or "")}</td></tr>')
    page=f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(song_folder.name)} history</title><style>:root{{color-scheme:light dark;font-family:Inter,system-ui,sans-serif;background:Canvas;color:CanvasText}}body{{margin:0}}main{{width:min(1200px,calc(100% - 32px));margin:auto;padding:38px 0}}h1{{font-size:clamp(2rem,5vw,3.5rem);letter-spacing:-.04em}}section{{border:1px solid color-mix(in srgb,CanvasText 17%,transparent);border-radius:18px;padding:18px;overflow-x:auto}}table{{width:100%;border-collapse:collapse}}th,td{{padding:10px 12px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent);text-align:right;white-space:nowrap}}th:first-child,td:first-child{{text-align:left}}a{{color:inherit}}</style></head><body><main><h1>{html.escape(song_folder.name)}</h1><p>{len(attempts)} saved attempt(s)</p><section><table><thead><tr><th>Attempt</th><th>Recorded</th><th>Mode</th><th>Lane presses</th><th>Duration</th><th>Avg NPS</th><th>Peak 1s</th><th>Dodges</th><th>Double candidates</th><th>Chart match</th><th>Est. misses</th><th>Note</th></tr></thead><tbody>{"".join(rows)}</tbody></table></section></main></body></html>'''
    p=song_folder/"history.html";p.write_text(page,encoding="utf-8");return p

def choose_profile(settings: dict) -> tuple[int,dict]:
    enabled=[n for n in SUPPORTED if settings["profiles"][str(n)]["enabled"]]
    if not enabled:raise ValueError("All key modes are disabled")
    print("\nEnabled modes:")
    for n in enabled:print(f"  {n}K — {', '.join(k.upper() for k in settings['profiles'][str(n)]['keys'])}")
    while True:
        try:n=int(ask("Key mode",str(enabled[0])).lower().replace("k",""))
        except ValueError:continue
        if n in enabled:return n,settings["profiles"][str(n)]
        print("Choose an enabled mode from 4K through 9K.")

def record(settings: dict) -> Optional[Path]:
    try:
        from pynput import keyboard
    except ImportError:
        print("Run install.bat first so pynput is available.");return None
    key_count,profile=choose_profile(settings);lane_keys=list(profile["keys"]);lane_set=set(lane_keys)
    name=ask("Song name","Untitled Song");game=ask("Game","");difficulty=ask("Difficulty","");tags=[x.strip() for x in ask("Tags, comma-separated","").split(",") if x.strip()];pre=ask("Pre-play note","")
    dodge_on=bool(settings["dodge"]["enabled"]);dodge_key=settings["dodge"]["key"] if dodge_on else None;start_key=settings["controls"]["start_key"];stop_key=settings["controls"]["stop_key"]
    if start_key in lane_set or stop_key in lane_set:raise ValueError("Start or stop key conflicts with a lane")
    if dodge_on and dodge_key in lane_set:raise ValueError("Dodge key conflicts with a lane")
    if dodge_on and dodge_key in {start_key,stop_key}:raise ValueError("Dodge key conflicts with start or stop")
    song_folder=resolve_song_folder(Path(settings["output_root"]).expanduser(),name);attempt=next_attempt(song_folder);stamp=time.strftime("%Y-%m-%d_%H-%M-%S");folder=song_folder/f"Attempt {attempt:03d} — {stamp}";folder.mkdir()
    print(f"\n{name} — Attempt {attempt:03d}\nMode: {key_count}K\nLanes: {', '.join(k.upper() for k in lane_keys)}\nDodge: {dodge_key.upper() if dodge_on else 'disabled'}\nStart: {start_key.upper()} | Stop: {stop_key.upper()}\nOutput: {folder}\n")
    events=[];pressed=set();down={};recording=False;start_ns=0;wall=0.0;lane_count=dodge_count=0;last_print=0.0
    def role(name: str) -> Optional[str]:
        if name in lane_set:return "lane"
        if dodge_on and name==dodge_key:return "dodge"
        return None
    def on_press(key: Any):
        nonlocal recording,start_ns,wall,lane_count,dodge_count,last_print
        name_key=key_name(key)
        if name_key==start_key:
            if not recording:
                events.clear();pressed.clear();down.clear();lane_count=dodge_count=0;start_ns=time.perf_counter_ns();wall=time.perf_counter();last_print=0;recording=True;print("[ RECORDING STARTED ]")
            return
        if name_key==stop_key:
            if recording:
                now=time.perf_counter_ns()
                for ident in list(pressed):
                    k,r=ident;events.append(Event((now-start_ns)/1_000_000,k,r,"up",(now-down.get(ident,now))/1_000_000))
                recording=False;print("\n[ RECORDING STOPPED ]");return False
            return
        if not recording:return
        r=role(name_key)
        if r is None:return
        ident=(name_key,r)
        if ident in pressed:return
        now=time.perf_counter_ns();pressed.add(ident);down[ident]=now;events.append(Event((now-start_ns)/1_000_000,name_key,r,"down"))
        if r=="lane":lane_count+=1
        else:dodge_count+=1
        current=time.perf_counter()
        if settings["live_counters"] and current-last_print>=.1:
            elapsed=current-wall;print(f"\r[RECORDING] {int(elapsed//60):02d}:{int(elapsed%60):02d} | lanes {lane_count:5d} | dodges {dodge_count:3d}",end="",flush=True);last_print=current
    def on_release(key: Any):
        name_key=key_name(key)
        if not recording:return
        r=role(name_key)
        if r is None:return
        ident=(name_key,r)
        if ident not in pressed:return
        now=time.perf_counter_ns();down_ns=down.pop(ident,now);pressed.discard(ident);events.append(Event((now-start_ns)/1_000_000,name_key,r,"up",(now-down_ns)/1_000_000))
    with keyboard.Listener(on_press=on_press,on_release=on_release) as listener:listener.join()
    if not events:
        try:folder.rmdir()
        except Exception:pass
        return None
    post=ask("Post-play note","") if settings["post_note_prompt"] else ""
    events.sort(key=lambda e:e.time_ms)
    metadata={"song_name":name,"song_id":song_id(name),"attempt_number":attempt,"recorded_at":time.strftime("%Y-%m-%d %H:%M:%S"),"game":game,"difficulty":difficulty,"tags":tags,"pre_play_note":pre,"post_play_note":post,"key_count":key_count,"lane_keys":lane_keys,"dodge_enabled":dodge_on,"dodge_key":dodge_key,"recorder_version":APP_VERSION,"analyzer_version":APP_VERSION}
    write_attempt(folder,events,metadata,settings);history_path=history(song_folder)
    print(f"\nSaved attempt to:\n{folder}")
    if history_path:print(f"History: {history_path}")
    if settings["open_report"]:
        try:webbrowser.open((folder/"report.html").resolve().as_uri())
        except Exception:pass
    return folder

def analyze_existing(settings: dict, path: Path) -> Path:
    events=load_events(path);name=ask("Song name",path.stem);n=int(ask("Key mode","4"))
    if n not in SUPPORTED:raise ValueError("Only 4K through 9K are supported")
    keys=parse_keys(ask("Lane keys, left to right",",".join(settings["profiles"][str(n)]["keys"])))
    if len(keys)!=n or len(set(keys))!=n:raise ValueError(f"{n}K needs exactly {n} unique keys")
    out=path.parent/f"{safe_name(path.stem)}_v35_analysis";out.mkdir(exist_ok=True)
    metadata={"song_name":name,"song_id":song_id(name),"attempt_number":0,"recorded_at":time.strftime("%Y-%m-%d %H:%M:%S"),"game":"","difficulty":"","tags":["imported"],"pre_play_note":"","post_play_note":"Imported CSV","key_count":n,"lane_keys":keys,"dodge_enabled":any(e.role=="dodge" for e in events),"dodge_key":next((e.key for e in events if e.role=="dodge"),None),"recorder_version":"unknown","analyzer_version":APP_VERSION}
    write_attempt(out,events,metadata,settings);print(f"Saved analysis to {out}")
    if settings["open_report"]:
        try:webbrowser.open((out/"report.html").resolve().as_uri())
        except Exception:pass
    return out


def reanalyze_song_attempts(song_folder: Path, settings: dict) -> dict:
    chart_bundle = load_chart_bundle(song_folder)
    if not chart_bundle:
        raise ValueError("No imported chart was found in this song folder.")
    updated = 0
    failed = []
    for folder in sorted(song_folder.iterdir()):
        if not folder.is_dir() or not folder.name.startswith("Attempt "):
            continue
        csv_path = folder / "inputs.csv"
        session_path = folder / "session.json"
        if not (csv_path.exists() and session_path.exists()):
            continue
        try:
            events = load_events(csv_path)
            metadata = json.loads(session_path.read_text(encoding="utf-8"))
            metadata["analyzer_version"] = APP_VERSION
            write_attempt(folder, events, metadata, settings)
            updated += 1
        except Exception as exc:
            failed.append({"folder": folder.name, "error": str(exc)})
    history(song_folder)
    return {"updated": updated, "failed": failed}


def import_fnf_song_interactive(settings: dict, path: Optional[Path] = None) -> Optional[Path]:
    if path is None:
        raw = input("Drag an FNF song JSON here: ").strip().strip('"')
        if not raw:
            return None
        path = Path(raw).expanduser()
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    preview = normalize_fnf_chart(data, path.name)
    summary = preview["summary"]

    print("\nDetected FNF song")
    print(f"  Song:           {summary['song_name']}")
    print(f"  Key mode:       {summary['key_count']}K")
    print(f"  Player notes:   {summary['player_notes']}")
    print(f"  Opponent notes: {summary['opponent_notes']}")
    print(f"  Sustains:       {summary['sustain_notes']}")
    print(f"  Events:         {summary['event_count']}")
    print(f"  Duration:       {ftime(summary['duration_ms'])}")
    print(f"  BPM:            {summary['base_bpm']}")

    name = ask("Song folder name", summary["song_name"])
    try:
        key_count = int(ask("Key mode", str(summary["key_count"])).lower().replace("k", ""))
    except ValueError as exc:
        raise ValueError("Key mode must be 4 through 9.") from exc
    if key_count not in SUPPORTED:
        raise ValueError("Only 4K through 9K are supported.")
    if key_count != summary["key_count"]:
        preview = normalize_fnf_chart(data, path.name, key_count_override=key_count)
        preview["summary"]["song_name"] = name
        preview["summary"]["song_id"] = song_id(name)
    else:
        preview["summary"]["song_name"] = name
        preview["summary"]["song_id"] = song_id(name)

    adjacent_events = path.with_name("events.json")
    default_events = str(adjacent_events) if adjacent_events.exists() and adjacent_events.resolve() != path.resolve() else ""
    extra_events_raw = ask("Additional events JSON (optional)", default_events)
    if extra_events_raw:
        extra_path = Path(extra_events_raw.strip().strip('"')).expanduser()
        extra_data = json.loads(extra_path.read_text(encoding="utf-8-sig"))
        extra_bundle = normalize_fnf_chart(extra_data, extra_path.name, key_count_override=key_count)
        before_events = len(preview["events"])
        preview = merge_event_bundle(preview, extra_bundle, extra_path.name)
        print(f"Merged {len(preview['events']) - before_events} additional event(s).")

    root = Path(settings["output_root"]).expanduser()
    song_folder = resolve_song_folder(root, name)
    chart_folder = song_folder / "chart"
    write_chart_bundle(preview, chart_folder, path)

    song_meta_path = song_folder / "song.json"
    try:
        song_meta = json.loads(song_meta_path.read_text(encoding="utf-8"))
    except Exception:
        song_meta = {"song_name": name, "song_id": song_id(name)}
    song_meta["imported_chart"] = {
        "format": preview["summary"]["format"],
        "key_count": preview["summary"]["key_count"],
        "player_notes": preview["summary"]["player_notes"],
        "events": preview["summary"]["event_count"],
        "importer_version": preview["summary"]["importer_version"],
    }
    song_meta_path.write_text(json.dumps(song_meta, indent=2), encoding="utf-8")

    print(f"\nImported chart to:\n{chart_folder}")
    print(f"Song Explorer: {chart_folder / 'song_explorer.html'}")

    if ask_bool("Reanalyze existing attempts in this song folder", True):
        result = reanalyze_song_attempts(song_folder, settings)
        print(f"Reanalyzed {result['updated']} attempt(s).")
        if result["failed"]:
            print(f"{len(result['failed'])} attempt(s) could not be updated.")

    if settings.get("open_report", True):
        try:
            webbrowser.open((chart_folder / "song_explorer.html").resolve().as_uri())
        except Exception:
            pass
    return song_folder


def reanalyze_song_interactive(settings: dict) -> None:
    raw = input("Drag a saved song folder here: ").strip().strip('"')
    if not raw:
        return
    folder = Path(raw).expanduser()
    result = reanalyze_song_attempts(folder, settings)
    print(f"Updated {result['updated']} attempt(s).")
    for failed in result["failed"]:
        print(f"  {failed['folder']}: {failed['error']}")

def profile_settings(settings: dict) -> None:
    while True:
        print("\nKey-mode profiles")
        for n in SUPPORTED:
            p=settings["profiles"][str(n)];print(f"{n}. {n}K [{'enabled' if p['enabled'] else 'disabled'}] — {', '.join(k.upper() for k in p['keys'])}")
        print("10. Back");raw=input("> ").strip()
        if raw=="10":return
        try:n=int(raw)
        except ValueError:continue
        if n not in SUPPORTED:continue
        p=settings["profiles"][str(n)];print("1. Toggle enabled\n2. Rebind lanes\n3. Reset profile\n4. Back");choice=input("> ").strip()
        if choice=="1":p["enabled"]=not p["enabled"]
        elif choice=="2":
            keys=parse_keys(ask(f"Exactly {n} keys",",".join(p["keys"])))
            if len(keys)!=n or len(set(keys))!=n:print("Wrong number of keys or duplicates.");continue
            p["keys"]=keys
        elif choice=="3":settings["profiles"][str(n)]=clone(DEFAULT_PROFILES[str(n)])
        save_settings(settings)

def settings_menu(settings: dict) -> None:
    while True:
        print("\nSETTINGS\n1. 4K–9K profiles\n2. Dodge\n3. Start/stop controls\n4. Output folder\n5. Report/prompts\n6. Input analyzer thresholds\n7. FNF chart matching\n8. Reset everything\n9. Back")
        choice=input("> ").strip()
        if choice=="1":profile_settings(settings)
        elif choice=="2":
            d=settings["dodge"];d["enabled"]=ask_bool("Enable dodge",d["enabled"])
            if d["enabled"]:d["key"]=norm_key(ask("Dodge key",d["key"]))
            d["double_min_ms"]=float(ask("Minimum double gap ms",str(d["double_min_ms"])));d["double_max_ms"]=float(ask("Maximum double gap ms",str(d["double_max_ms"])));d["cluster_gap_ms"]=float(ask("Cluster gap ms",str(d["cluster_gap_ms"])));save_settings(settings)
        elif choice=="3":
            start=norm_key(ask("Start key",settings["controls"]["start_key"]));stop=norm_key(ask("Stop key",settings["controls"]["stop_key"]))
            if start==stop:print("They cannot match.")
            else:settings["controls"]={"start_key":start,"stop_key":stop};save_settings(settings)
        elif choice=="4":settings["output_root"]=str(Path(ask("Output root",settings["output_root"])).expanduser());save_settings(settings)
        elif choice=="5":settings["open_report"]=ask_bool("Open report after save",settings["open_report"]);settings["post_note_prompt"]=ask_bool("Ask for post-play note",settings["post_note_prompt"]);settings["live_counters"]=ask_bool("Show live counters",settings["live_counters"]);save_settings(settings)
        elif choice=="6":
            labels={"chord_ms":"Chord grouping window ms","jack_ms":"Jack max gap ms","alt_ms":"Alternating max gap ms","dense_ms":"Dense run max gap ms","nps_window_ms":"NPS window ms","nps_step_ms":"NPS sample step ms","segment_ms":"Report segment size ms"}
            for key,label in labels.items():settings["thresholds"][key]=float(ask(label,str(settings["thresholds"][key])))
            save_settings(settings)
        elif choice=="7":
            labels={"hit_window_ms":"Estimated hit window ms","perfect_window_ms":"Inner timing window ms","good_window_ms":"Middle timing window ms","bad_window_ms":"Outer timing window ms","event_window_ms":"Event/dodge matching window ms"}
            for key,label in labels.items():settings["chart"][key]=float(ask(label,str(settings["chart"][key])))
            save_settings(settings)
        elif choice=="8":
            if ask_bool("Reset every setting",False):settings.clear();settings.update(clone(DEFAULTS));save_settings(settings)
        elif choice=="9":return

def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--analyze",type=Path)
    parser.add_argument("--import-chart",type=Path)
    args=parser.parse_args();settings=load_settings()
    if args.analyze:
        analyze_existing(settings,args.analyze);return
    if args.import_chart:
        import_fnf_song_interactive(settings,args.import_chart);return
    while True:
        print(f"\n{'='*68}\n{APP_NAME} {APP_VERSION}\n{'='*68}\n1. Record and analyze a song\n2. Analyze an existing CSV\n3. Import an FNF song JSON\n4. Reanalyze a saved song\n5. Open output folder\n6. Settings\n7. Exit")
        choice=input("> ").strip()
        try:
            if choice=="1":record(settings)
            elif choice=="2":
                raw=input("Drag a CSV here: ").strip().strip('"')
                if raw:analyze_existing(settings,Path(raw).expanduser())
            elif choice=="3":import_fnf_song_interactive(settings)
            elif choice=="4":reanalyze_song_interactive(settings)
            elif choice=="5":
                folder=Path(settings["output_root"]).expanduser();folder.mkdir(parents=True,exist_ok=True)
                if os.name=="nt":os.startfile(folder)  # type: ignore[attr-defined]
                else:print(folder)
            elif choice=="6":settings_menu(settings);settings=load_settings()
            elif choice=="7":return
        except Exception as exc:print(f"\nError: {exc}")

if __name__=="__main__":main()
