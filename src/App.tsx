import { memo, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

import ham1 from "./assets/ham1.gif";
import ham2 from "./assets/ham2.gif";
import ham3 from "./assets/ham3.gif";
import ham4 from "./assets/ham4.gif";
import ham5 from "./assets/ham5.gif";
import ham_ag from "./assets/ham_ag.gif";

type Screen =
  | "onboarding"
  | "ham1"
  | "ham2"
  | "ham3"
  | "ham4"
  | "ham5"
  | "ham_ag";

const IMAGES: Record<Exclude<Screen, "onboarding">, string> = {
  ham1,
  ham2,
  ham3,
  ham4,
  ham5,
  ham_ag,
};

const isIGValid = (ig: string) =>
  /^[A-Za-z0-9._]{1,30}$/.test(ig.replace(/^@/, ""));

/** ✅ ใช้ IG แบบ canonical เป็นตัวพิมพ์เล็กเสมอ */
const normalizeIG = (ig: string) => {
  const clean = ig.trim().replace(/^@/, "");
  return clean ? `@${clean.toLowerCase()}` : "";
};

/* ====== CONFIG: Google Apps Script Web App URL ====== */
const SHEET_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbxJHR93D1OHO7SJp8dlwFP4Gyy8m4Inoe-BM9EwCiLTKeZqp0Ry9Fh-kzpSu45LFnvc/exec";

/* ====== LocalStorage Keys ====== */
const LS_KEYS = {
  hamsterName: "hamsterName",
  playerIG: "playerIG",
  onboarded: "onboarded",
  localFeedCount: "localFeedCount",
} as const;

/* ====== Logger → Google Sheet ====== */
function logToSheet(payload: {
  hamsterName?: string;
  playerIG?: string;
  event: "start" | "feed";
}) {
  try {
    fetch(SHEET_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "no-cors",
      body: JSON.stringify({ ...payload, ua: navigator.userAgent }),
      keepalive: true,
    });
  } catch (e) {
    console.warn("logToSheet failed", e);
  }
}

/* ====== Leaderboard: remote fetch (with timeout & JSONP fallback) ====== */
async function fetchWithTimeout(input: RequestInfo, ms = 6000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(input, {
      signal: ctrl.signal,
      cache: "no-store",
      credentials: "omit",
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/** JSONP helper — ข้าม CORS/redirect ได้ */
function jsonp<T = any>(url: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const cbName = "__jsonp_cb_" + Math.random().toString(36).slice(2);
    const src = url + (url.includes("?") ? "&" : "?") + "callback=" + cbName;

    const script = document.createElement("script");
    let timer: number | undefined;

    (window as any)[cbName] = (data: T) => {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete (window as any)[cbName];
      } catch {}
      if (timer) window.clearTimeout(timer);
    }

    script.src = src;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load error"));
    };
    document.head.appendChild(script);

    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout"));
    }, timeoutMs);
  });
}

/** รวมผล leaderboard จาก server → canonical (ไม่แยกพิมพ์เล็ก-ใหญ่) */
function mergeIGCaseInsensitive(items: Array<{ ig: string; count: number }>) {
  const map = new Map<string, number>();
  for (const r of items || []) {
    const key = normalizeIG(r.ig);
    map.set(key, (map.get(key) || 0) + (Number(r.count) || 0));
  }
  return Array.from(map, ([ig, count]) => ({ ig, count })).sort(
    (a, b) => b.count - a.count
  );
}

/** ลอง fetch ปกติ → ถ้า fail ใช้ JSONP */
async function fetchLeaderboard(): Promise<{
  ok: boolean;
  data: Array<{ ig: string; count: number }>;
  error?: string;
}> {
  const url = `${SHEET_ENDPOINT}?leaderboard=1&limit=3`;

  try {
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text(); // ถ้าโดนหน้า login HTML → JSON.parse จะ throw
    const json = JSON.parse(text);
    const data = Array.isArray(json?.data)
      ? mergeIGCaseInsensitive(json.data)
      : [];
    return { ok: true, data };
  } catch (e: any) {
    try {
      const j: any = await jsonp(url, 8000);
      const data = Array.isArray(j?.data) ? mergeIGCaseInsensitive(j.data) : [];
      return { ok: true, data };
    } catch (e2: any) {
      return {
        ok: false,
        data: [],
        error: e2?.message || e?.message || "Fetch failed",
      };
    }
  }
}

/* ====== Fallback (local) ====== */
function incLocalFeedCount(ig: string) {
  const key = normalizeIG(ig);
  if (!key) return;
  const raw = localStorage.getItem(LS_KEYS.localFeedCount);
  const obj = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  obj[key] = (obj[key] || 0) + 1;
  localStorage.setItem(LS_KEYS.localFeedCount, JSON.stringify(obj));
}

function getLocalTopN(n = 3): Array<{ ig: string; count: number }> {
  const raw = localStorage.getItem(LS_KEYS.localFeedCount);
  const obj = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return Object.entries(obj)
    .map(([ig, count]) => ({ ig, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

/** 🔹 ดึงจำนวน feed สำหรับ IG หนึ่งคนจาก localStorage (fallback) */
function getLocalFeedCountFor(ig: string): number {
  const key = normalizeIG(ig);
  if (!key) return 0;
  const raw = localStorage.getItem(LS_KEYS.localFeedCount);
  const obj = raw ? (JSON.parse(raw) as Record<string, number>) : {};
  return Number(obj[key] || 0);
}

/** ⭐ ดึงจำนวน Feed "ทั้งหมด" ของ IG นี้จาก Google Sheet (รวมทุกวัน / ทุกเครื่อง)
 *    - ถ้าออนไลน์โอเค → คืนค่าเป็น number (0+)
 *    - ถ้าเน็ต/ชีตพัง → คืน null ให้ไป fallback เป็น local
 */
async function fetchMyTotalFeed(ig: string): Promise<number | null> {
  const key = normalizeIG(ig);
  if (!key) return null;

  const url = `${SHEET_ENDPOINT}?leaderboard=1&limit=9999`;

  try {
    const res = await fetchWithTimeout(url, 6000);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const json = JSON.parse(text);
    const data = Array.isArray(json?.data)
      ? mergeIGCaseInsensitive(json.data)
      : [];

    const row = data.find((r) => normalizeIG(r.ig) === key);
    if (!row) return 0;
    return Number(row.count || 0);
  } catch (e: any) {
    try {
      const j: any = await jsonp(url, 8000);
      const data = Array.isArray(j?.data) ? mergeIGCaseInsensitive(j.data) : [];
      const row = data.find((r) => normalizeIG(r.ig) === key);
      if (!row) return 0;
      return Number(row.count || 0);
    } catch {
      return null;
    }
  }
}

/* ====== Preload helper ====== */
const preload = (src: string) =>
  new Promise<void>((resolve) => {
    const i = new Image();
    i.src = src;
    i.decoding = "async";
    i.onload = () => resolve();
    i.onerror = () => resolve();
  });

/* ====== Hook: ตรวจหน้าจอเล็ก (มือถือ) ====== */
function useIsMobile(breakpoint = 480) {
  const [mobile, setMobile] = useState<boolean>(
    () => window.innerWidth <= breakpoint
  );
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= breakpoint);
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return mobile;
}

/* ====== PlayButton (memo เพื่อลด re-render) ====== */
const PlayButtonDock = memo(function PlayButtonDock() {
  const styles: Record<string, React.CSSProperties> = {
    fab: {
      position: "fixed",
      left: 12,
      bottom: 12,
      width: 52,
      height: 52,
      borderRadius: "50%",
      background: "linear-gradient(145deg, #202020, #111)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 20,
      fontWeight: 700,
      cursor: "pointer",
      zIndex: 1000,
      userSelect: "none",
      boxShadow:
        "0 6px 14px rgba(0,0,0,0.45), inset 0 0 8px rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.15)",
      transition: "transform .15s ease, filter .15s ease, box-shadow .15s ease",
      WebkitTapHighlightColor: "transparent",
    },
    hover: {
      filter: "brightness(1.15)",
      transform: "translateY(-2px) scale(1.03)",
      boxShadow: "0 10px 18px rgba(0,0,0,0.55)",
    },
    active: {
      transform: "translateY(0) scale(0.97)",
      boxShadow: "0 4px 10px rgba(0,0,0,0.35)",
    },
  };

  const TRACK_URL =
    "https://open.spotify.com/track/7eJMfftS33KTjuF7lTsMCx?utm_source=generator";

  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);

  return (
    <button
      aria-label="Play music"
      title="Play"
      onClick={() => window.open(TRACK_URL, "_blank", "noopener,noreferrer")}
      style={{
        ...styles.fab,
        ...(hover ? styles.hover : {}),
        ...(down ? styles.active : {}),
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setDown(false);
      }}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
    >
      ▶
    </button>
  );
});

/* ====== TOP 3 Box (mobile = small bottom-right) ====== */
const Top3Box = memo(function Top3Box(props: {
  items: Array<{ ig: string; count: number }>;
  loading: boolean;
  error?: string | null;
  onRefresh?: () => void;
  mobile: boolean;
}) {
  const { items, loading, error, onRefresh, mobile } = props;

  const base: React.CSSProperties = {
    position: "fixed",
    right: mobile ? 10 : 14,
    bottom: mobile ? 10 : 14,
    width: mobile ? 210 : 260,
    background: "rgba(0,0,0,0.78)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 12,
    padding: mobile ? 10 : 12,
    color: "#fff",
    zIndex: 999,
    backdropFilter: "blur(6px)",
    boxShadow: "0 8px 18px rgba(0,0,0,0.35)",
    WebkitTapHighlightColor: "transparent",
  };

  const titleStyle: React.CSSProperties = {
    fontWeight: 700,
    fontSize: mobile ? 14 : 16,
  };

  const btnStyle: React.CSSProperties = {
    padding: mobile ? "4px 8px" : "2px 8px",
    fontSize: mobile ? 12 : 12,
    borderRadius: 8,
    lineHeight: 1.1,
    background: "#3ee680",
    color: "#000",
    border: "1px solid #2fbf68",
    fontWeight: 600,
    cursor: "pointer",
  };

  const listItemStyle: React.CSSProperties = {
    marginBottom: 4,
    lineHeight: 1.25,
    fontSize: mobile ? 13 : 14,
  };

  const footerStyle: React.CSSProperties = {
    fontSize: mobile ? 10 : 12,
    opacity: 0.7,
    marginTop: 6,
  };

  return (
    <div style={base} aria-label="Top feeders">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: mobile ? 4 : 6,
          gap: 6,
        }}
      >
        <div style={titleStyle}>🏆 TOP 3</div>
        <button
          onClick={onRefresh}
          className="button"
          style={btnStyle}
          aria-label="Refresh leaderboard"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ opacity: 0.85, fontSize: mobile ? 12 : 14 }}>
          Loading…
        </div>
      ) : error ? (
        <div style={{ color: "#ffb3b3", fontSize: mobile ? 12 : 14 }}>
          Failed to load
          <br />
          <small style={{ opacity: 0.8 }}>{error}</small>
        </div>
      ) : items.length === 0 ? (
        <div style={{ opacity: 0.85, fontSize: mobile ? 12 : 14 }}>
          Try feeding it!
        </div>
      ) : (
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {items.map((r) => (
            <li key={r.ig} style={listItemStyle}>
              <span style={{ fontWeight: 600 }}>{normalizeIG(r.ig)}</span>
              <span style={{ opacity: 0.85 }}> — {r.count} feed</span>
            </li>
          ))}
        </ol>
      )}

      <div style={footerStyle}>(Auto-updates every 20 seconds)</div>
    </div>
  );
});

/* ===========================
   Main App
   =========================== */
export default function App() {
  const isMobile = useIsMobile(520);

  const savedHam = useMemo(
    () => localStorage.getItem(LS_KEYS.hamsterName) || "",
    []
  );
  const savedIG = useMemo(
    () => localStorage.getItem(LS_KEYS.playerIG) || "",
    []
  );
  const savedOnboarded = useMemo(
    () => localStorage.getItem(LS_KEYS.onboarded) === "1",
    []
  );

  const [screen, setScreen] = useState<Screen>(
    savedOnboarded ? "ham1" : "onboarding"
  );
  const [hamsterName, setHamsterName] = useState<string>(savedHam);
  const [playerIGInput, setPlayerIGInput] = useState<string>(savedIG);
  const playerIG = normalizeIG(playerIGInput);
  const formValid = hamsterName.trim().length > 0 && isIGValid(playerIG);

  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => setImgLoaded(false), [screen]);

  // Preload ต่อเนื่องให้ภาพมาไว
  useEffect(() => {
    (async () => {
      if (screen === "ham1") await preload(IMAGES.ham2);
      if (screen === "ham2") await preload(IMAGES.ham3);
      if (screen === "ham3") await preload(IMAGES.ham4);
      if (screen === "ham4") await preload(IMAGES.ham5);
      if (screen !== "ham_ag") await preload(IMAGES.ham_ag);
    })();
  }, [screen]);

  const goScreen = async (next: Screen) => {
    if (next !== "onboarding") {
      const src = IMAGES[next as Exclude<Screen, "onboarding">];
      await preload(src);
    }
    setScreen(next);
  };

  const startGame = () => {
    if (!formValid) return;
    localStorage.setItem(LS_KEYS.hamsterName, hamsterName.trim());
    localStorage.setItem(LS_KEYS.playerIG, playerIG);
    localStorage.setItem(LS_KEYS.onboarded, "1");
    logToSheet({ hamsterName: hamsterName.trim(), playerIG, event: "start" });
    goScreen("ham1");
  };

  const [beforeEditHam, setBeforeEditHam] = useState<string>("");
  const [beforeEditIG, setBeforeEditIG] = useState<string>("");

  const enterEditProfile = () => {
    setBeforeEditHam(localStorage.getItem(LS_KEYS.hamsterName) || hamsterName);
    setBeforeEditIG(localStorage.getItem(LS_KEYS.playerIG) || playerIG);
    setHamsterName(localStorage.getItem(LS_KEYS.hamsterName) || hamsterName);
    setPlayerIGInput(localStorage.getItem(LS_KEYS.playerIG) || playerIG);
    setScreen("onboarding");
  };

  const backToGame = () => {
    const oldName =
      beforeEditHam || localStorage.getItem(LS_KEYS.hamsterName) || "";
    const oldIG = beforeEditIG || localStorage.getItem(LS_KEYS.playerIG) || "";
    setHamsterName(oldName);
    setPlayerIGInput(oldIG);
    goScreen("ham1");
  };

  /* ====== Leaderboard State ====== */
  const [leaderboard, setLeaderboard] = useState<
    Array<{ ig: string; count: number }>
  >([]);
  const [lbLoading, setLbLoading] = useState<boolean>(false);
  const [lbError, setLbError] = useState<string | null>(null);

  // 🔹 จำนวนครั้งที่ผู้เล่นคนนี้กด Feed (อ่านจากชีตรวมทุกวัน + fallback local)
  const [myFeedCount, setMyFeedCount] = useState<number>(0);

  // กันเรียกซ้อน (ทำให้ลื่น)
  const refreshingRef = useRef(false);

  const hasChoices =
    screen === "ham1" ||
    screen === "ham2" ||
    screen === "ham3" ||
    screen === "ham4";
  const displayHamsterName =
    localStorage.getItem(LS_KEYS.hamsterName) || hamsterName;
  const displayIG = localStorage.getItem(LS_KEYS.playerIG) || playerIG;

  const refreshLeaderboard = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;

    setLbLoading(true);
    setLbError(null);

    const remote = await fetchLeaderboard();

    if (remote.ok && remote.data.length) {
      setLeaderboard(remote.data.slice(0, 3));
    } else {
      const local = getLocalTopN(3);
      setLeaderboard(local);
      if (!remote.ok) setLbError(remote.error || "Unknown error");
    }

    setLbLoading(false);
    refreshingRef.current = false;
  };

  // ออโต้รีเฟรช leaderboard (ไม่ยุ่งกับ myFeedCount)
  useEffect(() => {
    let timer: number | undefined;

    const loop = async () => {
      await refreshLeaderboard();
      timer = window.setTimeout(loop, 20000);
    };

    const onVis = () => {
      if (document.hidden) {
        if (timer) clearTimeout(timer);
      } else {
        if (timer) clearTimeout(timer);
        loop();
      }
    };

    loop();
    document.addEventListener("visibilitychange", onVis, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // 🔹 sync myFeedCount ตาม IG ปัจจุบัน
  //    - ถ้าออนไลน์ → ใช้ค่าจากชีต (รวมทุกวัน / ทุกเครื่อง)
  //    - ถ้าเน็ต/ชีตล่ม → ใช้ค่าจาก localStorage แทน
  useEffect(() => {
    if (!displayIG) {
      setMyFeedCount(0);
      return;
    }

    (async () => {
      const backendCount = await fetchMyTotalFeed(displayIG);
      if (backendCount == null) {
        const localCount = getLocalFeedCountFor(displayIG);
        setMyFeedCount(localCount);
      } else {
        setMyFeedCount(backendCount);
      }
    })();
  }, [displayIG]);

  const handleYes = () => {
    if (displayIG) {
      const ig = normalizeIG(displayIG);

      // อัปเดตใน localStorage ไว้เป็น backup เวลา offline
      incLocalFeedCount(ig);

      // ให้เลขเด้งขึ้นทันที 1 ครั้ง
      setMyFeedCount((prev) => prev + 1);

      setLeaderboard(getLocalTopN(3));
      logToSheet({
        hamsterName: displayHamsterName?.trim(),
        playerIG: ig,
        event: "feed",
      });

      // ดึงค่าจริงจากชีตมาตามหลัง
      setTimeout(() => {
        (async () => {
          const remote = await fetchMyTotalFeed(ig);
          if (remote != null) {
            setMyFeedCount((prev) => Math.max(prev, remote));
          }
          refreshLeaderboard();
        })();
      }, 800);
    }

    if (screen === "ham1") return goScreen("ham2");
    if (screen === "ham2") return goScreen("ham3");
    if (screen === "ham3") return goScreen("ham4");
    if (screen === "ham4") return goScreen("ham5");
  };

  const handleNo = () => goScreen("ham_ag");

  return (
    <>
      <PlayButtonDock />
      <Top3Box
        items={leaderboard}
        loading={lbLoading}
        error={lbError}
        onRefresh={refreshLeaderboard}
        mobile={isMobile}
      />

      <div className="val-container">
        {screen === "onboarding" && (
          <button
            className="back-start"
            onClick={backToGame}
            aria-label="Back to game"
          >
            ←
          </button>
        )}

        {screen !== "onboarding" && (
          <>
            {/* 🔵 กล่อง IG (มุมขวาบน) */}
            <div
              style={{
                position: "fixed",
                top: 10,
                right: 10,
                padding: isMobile ? "6px 10px" : "8px 12px",
                background: "rgba(0,0,0,0.55)",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#fff",
                fontSize: isMobile ? 14 : 15,
                fontWeight: 600,
                zIndex: 1000,
              }}
            >
              👫 {normalizeIG(displayIG)}
              <button
                className="reset-btn"
                onClick={enterEditProfile}
                aria-label="Edit name/IG"
              >
                🍄
              </button>
            </div>

            {/* 🟠 กล่อง Cookie Counter (อยู่ใต้ IG และชิดขวา) */}
            <div
              style={{
                position: "fixed",
                top: isMobile ? 50 : 54,
                right: 10,
                padding: isMobile ? "4px 10px" : "6px 12px",
                background: "rgba(0,0,0,0.55)",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.2)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "#fff",
                fontSize: isMobile ? 13 : 14,
                fontWeight: 700,
                zIndex: 1000,
              }}
            >
              🍪 <span>{myFeedCount}</span>
            </div>
          </>
        )}

        <div
          className="val-card"
          style={{ padding: isMobile ? 12 : undefined }}
        >
          {screen === "onboarding" ? (
            <div className="onboard">
              <div
                className="onboard-row"
                style={{ gap: isMobile ? 10 : undefined }}
              >
                <div className="field">
                  <label className="label" htmlFor="hamster-name">
                    🐹 Hamster&apos;s name
                  </label>
                  <input
                    id="hamster-name"
                    className="input thin"
                    placeholder="Sample NUNU"
                    value={hamsterName}
                    onChange={(e) => setHamsterName(e.target.value)}
                    aria-label="Hamster name"
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor="player-ig">
                    👫 Your Instagram
                  </label>
                  <input
                    id="player-ig"
                    className="input thin"
                    placeholder="@username"
                    value={playerIGInput}
                    onChange={(e) => setPlayerIGInput(e.target.value)}
                    aria-label="Player Instagram"
                  />
                </div>

                <button
                  className="button primary thin"
                  onClick={startGame}
                  disabled={!formValid}
                >
                  Start
                </button>
              </div>

              {!formValid && (
                <div className="small-text hint">
                  Enter your name and Instagram in the format @username
                  <br />
                  (letters, numbers, . or _, 1–30 characters).
                </div>
              )}
            </div>
          ) : (
            <>
              <div
                className="gif-wrapper"
                style={{ minHeight: isMobile ? 220 : undefined }}
              >
                <img
                  src={IMAGES[screen]}
                  alt={screen}
                  className={`gif ${imgLoaded ? "loaded" : ""}`}
                  decoding="async"
                  loading="eager"
                  onLoad={() => setImgLoaded(true)}
                  style={{
                    maxWidth: "100%",
                    height: "auto",
                    willChange: "transform",
                  }}
                />
                <div
                  className="hamster-name-overlay"
                  style={{ fontSize: isMobile ? 16 : undefined }}
                >
                  {displayHamsterName}
                </div>
              </div>

              {screen === "ham1" && (
                <div className="val-text big-text">
                  Feed me or fight me 🤤💢
                </div>
              )}
              {screen === "ham2" && (
                <div className="val-text">Donate 1 cookie pls 😂</div>
              )}
              {screen === "ham3" && (
                <div className="val-text">More now!! 🍪</div>
              )}
              {screen === "ham4" && (
                <div className="val-text">Refill the cookie tank 🍪🥺</div>
              )}
              {screen === "ham5" && (
                <div className="val-text">
                  Yay! Overdosed on cookies 🐹💤 <br /> Thank you ❤️❤️❤️
                </div>
              )}
              {screen === "ham_ag" && (
                <div className="val-text">
                  No cookie...? The killer hamster 😈
                </div>
              )}

              <div
                className="btn-row"
                style={{ marginTop: 10, gap: isMobile ? 8 : 12 }}
              >
                {hasChoices ? (
                  <>
                    <button
                      className="button yes-button"
                      onClick={handleYes}
                      style={{ padding: isMobile ? "10px 14px" : undefined }}
                    >
                      Feed
                    </button>
                    <button
                      className="button no-button"
                      onClick={handleNo}
                      style={{ padding: isMobile ? "10px 14px" : undefined }}
                    >
                      Skip
                    </button>
                  </>
                ) : (
                  <button
                    className="button restart-button"
                    onClick={() => goScreen("ham1")}
                    style={{ padding: isMobile ? "10px 14px" : undefined }}
                  >
                    Restart
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
