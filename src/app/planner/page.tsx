
"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  BookOpen, LayoutDashboard, Plus, Search, CheckCircle2, Circle,
  Trash2, ChevronRight, ArrowLeft, Upload, GraduationCap, Target,
  Menu, X, Download, Activity, TrendingUp, CalendarDays, Layers,
  FileSpreadsheet, Clock3, Sparkles, Cloud, RefreshCw
} from "lucide-react";

type Chapter = {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: string | null;
};

type Subject = {
  id: string;
  title: string;
  chapters: Chapter[];
};

type SyncStatus = "loading" | "saving" | "synced" | "error";

const STORAGE = "personal_study_planner_v1";

function dateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSubjects(data: unknown): data is Subject[] {
  return Array.isArray(data) && data.every(s =>
    s &&
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    Array.isArray(s.chapters) &&
    s.chapters.every((c: Chapter) =>
      c &&
      typeof c.id === "string" &&
      typeof c.title === "string" &&
      typeof c.completed === "boolean"
    )
  );
}

export default function Home() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [view, setView] = useState<"dashboard" | "public">("dashboard");
  const [selected, setSelected] = useState<string | null>(null);
  const [subjectTitle, setSubjectTitle] = useState("");
  const [chapterText, setChapterText] = useState("");
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState(false);

  // Load cloud data. If no cloud record exists, migrate old browser data once.
  useEffect(() => {
    let cancelled = false;

    async function loadCloudData() {
      setLoaded(false);
      setCloudReady(false);
      setLoadError("");
      setSyncStatus("loading");

      try {
        const supabase = getSupabase();

        if (!supabase) {
          throw new Error("Supabase configuration missing. Check .env.local.");
        }

        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        const user = sessionData.session?.user;

        if (!user) {
          throw new Error("Your login session has expired. Please sign in again.");
        }

        const { data: cloudRow, error: fetchError } = await supabase
          .from("planner_data")
          .select("subjects")
          .eq("user_id", user.id)
          .maybeSingle();

        if (fetchError) throw fetchError;

        let initialSubjects: Subject[] = [];

        if (cloudRow) {
          if (!isValidSubjects(cloudRow.subjects)) {
            throw new Error("Cloud data format is invalid. Your data was not changed.");
          }

          // Cloud data is the source of truth once it exists.
          initialSubjects = cloudRow.subjects;
        } else {
          // First login on this account: migrate old localStorage data.
          const saved = localStorage.getItem(STORAGE);

          if (saved) {
            const parsed: unknown = JSON.parse(saved);

            if (!Array.isArray(parsed)) {
              throw new Error("Old browser data is invalid. It has not been deleted.");
            }

            // Normalize older records while preserving IDs and completion history.
            initialSubjects = parsed.map((s: unknown) => {
              const subject = isRecord(s) ? s : {};
              const chapters = Array.isArray(subject.chapters)
                ? subject.chapters.map((c: unknown) => {
                    const chapter = isRecord(c) ? c : {};
                    return {
                      id: typeof chapter.id === "string" ? chapter.id : makeId(),
                      title: String(chapter.title || ""),
                      completed: Boolean(chapter.completed),
                      completedAt: typeof chapter.completedAt === "string"
                        ? chapter.completedAt
                        : null
                    };
                  })
                : [];
              return {
                id: typeof subject.id === "string" ? subject.id : makeId(),
                title: String(subject.title || ""),
                chapters
              };
            });
          }

          const { error: insertError } = await supabase
            .from("planner_data")
            .insert({
              user_id: user.id,
              subjects: initialSubjects,
              updated_at: new Date().toISOString()
            });

          if (insertError) {
            // Another device may have created the first row at the same time.
            if (insertError.code === "23505") {
              const { data: latestRow, error: latestError } = await supabase
                .from("planner_data")
                .select("subjects")
                .eq("user_id", user.id)
                .single();

              if (latestError) throw latestError;

              if (!isValidSubjects(latestRow.subjects)) {
                throw new Error("Cloud data format is invalid.");
              }

              initialSubjects = latestRow.subjects;
            } else {
              throw insertError;
            }
          }
        }

        if (cancelled) return;

        setSubjects(initialSubjects);
        setCloudReady(true);
        setSyncStatus("synced");
        setLoaded(true);
      } catch (error) {        console.error(
          "Cloud loading failed:",
          error instanceof Error ? error.message : String(error)
        );

        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not connect to cloud storage."
          );
          setSyncStatus("error");
          setLoaded(true);
        }
      }
    }

    loadCloudData();

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // Automatically save changes to this user's Supabase record.
  useEffect(() => {
    if (!loaded || !cloudReady) return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        setSyncStatus("saving");

        const supabase = getSupabase();

        if (!supabase) {
          throw new Error("Supabase configuration missing.");
        }

        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        const user = sessionData.session?.user;

        if (!user) {
          throw new Error("Please sign in again.");
        }

        const { error } = await supabase
          .from("planner_data")
          .upsert({
            user_id: user.id,
            subjects: subjects,
            updated_at: new Date().toISOString()
          });

        if (error) throw error;

        if (!cancelled) setSyncStatus("synced");
      } catch (error) {
        console.error("Cloud save failed:", error);

        if (!cancelled) setSyncStatus("error");
      }
    }, 800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [subjects, loaded, cloudReady]);

  const total = subjects.reduce((n, s) => n + s.chapters.length, 0);

  const done = subjects.reduce(
    (n, s) => n + s.chapters.filter(c => c.completed).length,
    0
  );

  const pending = total - done;
  const progress = total ? Math.round(done / total * 100) : 0;

  const preview = useMemo(() =>
    chapterText.split(/\r?\n/)
      .map(line => line.replace(/^\s*(?:[-*â€¢]|\d+[.)])\s*/, "").trim())
      .filter(Boolean),
    [chapterText]
  );

  const current = subjects.find(s => s.id === selected);

  const subjectStats = useMemo(() => subjects.map(s => {
    const completed = s.chapters.filter(c => c.completed).length;
    const count = s.chapters.length;

    return {
      ...s,
      completed,
      count,
      percent: count ? Math.round(completed / count * 100) : 0
    };
  }).sort((a, b) => b.percent - a.percent), [subjects]);

  const weekActivity = useMemo(() => {
    const today = new Date();

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setHours(0, 0, 0, 0);
      date.setDate(today.getDate() - (6 - index));

      const key = dateKey(date);

      const count = subjects.reduce((sum, s) =>
        sum + s.chapters.filter(c =>
          c.completed &&
          c.completedAt &&
          dateKey(new Date(c.completedAt)) === key
        ).length, 0
      );

      return {
        key,
        label: date.toLocaleDateString("en", { weekday: "short" }),
        count
      };
    });
  }, [subjects]);

  const recentCompletions = useMemo(() => subjects.flatMap(s =>
    s.chapters
      .filter(c => c.completed && c.completedAt)
      .map(c => ({
        id: c.id,
        title: c.title,
        subject: s.title,
        completedAt: c.completedAt as string
      }))
  ).sort((a, b) =>
    new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
  ).slice(0, 6), [subjects]);

  const weeklyTotal = weekActivity.reduce((sum, d) => sum + d.count, 0);

  const bestDay = weekActivity.reduce(
    (best, day) => day.count > best.count ? day : best,
    { key: "", label: "â€”", count: 0 }
  );

  const filteredSubjects = subjects.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase())
  );

  function addSubject() {
    if (!subjectTitle.trim() || !preview.length) {
      alert("Subject title aur chapters dono add karo.");
      return;
    }

    const subject: Subject = {
      id: makeId(),
      title: subjectTitle.trim(),
      chapters: preview.map(title => ({
        id: makeId(),
        title,
        completed: false,
        completedAt: null
      }))
    };

    setSubjects(prev => [...prev, subject]);
    setSubjectTitle("");
    setChapterText("");
    setSelected(subject.id);
    setView("public");
    alert("Subject successfully added!");
  }

  function addMoreChapters() {
    if (!selected || !preview.length) return;

    setSubjects(prev => prev.map(s =>
      s.id === selected
        ? {
            ...s,
            chapters: [
              ...s.chapters,
              ...preview.map(title => ({
                id: makeId(),
                title,
                completed: false,
                completedAt: null
              }))
            ]
          }
        : s
    ));

    setChapterText("");
    alert("New chapters added successfully!");
  }

  function toggleChapter(subjectId: string, chapterId: string) {
    setSubjects(prev => prev.map(s =>
      s.id === subjectId
        ? {
            ...s,
            chapters: s.chapters.map(c => {
              if (c.id !== chapterId) return c;

              const next = !c.completed;

              return {
                ...c,
                completed: next,
                completedAt: next ? new Date().toISOString() : null
              };
            })
          }
        : s
    ));
  }

  function deleteSubject(id: string) {
    if (!confirm("Delete this subject and all its chapters?")) return;

    setSubjects(prev => prev.filter(s => s.id !== id));

    if (selected === id) setSelected(null);
  }

  function deleteChapter(subjectId: string, chapterId: string) {
    if (!confirm("Delete this chapter?")) return;

    setSubjects(prev => prev.map(s =>
      s.id === subjectId
        ? { ...s, chapters: s.chapters.filter(c => c.id !== chapterId) }
        : s
    ));
  }

  function exportBackup() {
    const blob = new Blob(
      [JSON.stringify(subjects, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = "my-study-planner-backup.json";
    a.click();

    URL.revokeObjectURL(url);
  }

  function importBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = event => {
      try {
        const data: unknown = JSON.parse(String(event.target?.result));

        if (!Array.isArray(data) || !data.every((s: unknown) =>
          isRecord(s) &&
          typeof s.title === "string" &&
          Array.isArray(s.chapters) &&
          s.chapters.every((c: unknown) =>
            isRecord(c) &&
            typeof c.title === "string" &&
            typeof c.completed === "boolean"
          )
        )) {
          throw new Error("Invalid backup");
        }

        if (!confirm("Import subjects into your planner?")) return;

        const normalized = (data as Subject[]).map(s => ({
          ...s,
          id: s.id || makeId(),
          chapters: s.chapters.map(c => ({
            ...c,
            id: c.id || makeId(),
            completedAt: c.completedAt ?? null
          }))
        }));

        setSubjects(prev => [...prev, ...normalized]);
        alert("Backup imported successfully!");
      } catch {
        alert("Invalid planner backup file.");
      }
    };

    reader.readAsText(file);
    e.target.value = "";
  }

  function exportCSV() {
    const rows = [
      ["Subject", "Chapter", "Status", "Completed At"],
      ...subjects.flatMap(s => s.chapters.map(c => [
        s.title,
        c.title,
        c.completed ? "Completed" : "Pending",
        c.completedAt || ""
      ]))
    ];

    const csv = rows.map(row => row.map(value =>
      '"' + String(value).replace(/"/g, '""') + '"'
    ).join(",")).join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = "study-chapter-progress.csv";
    a.click();

    URL.revokeObjectURL(url);
  }

  // Do not show an empty planner when cloud loading fails.
  if (!loaded) {
    return (
      <div className="study-loading">
        <Cloud size={22}/>
        <p>Connecting to your secure cloud study space...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <main className="study-loading" style={{ padding: 30 }}>
        <Cloud size={32}/>
        <h2>Cloud connection failed</h2>
        <p style={{ maxWidth: 440, textAlign: "center" }}>{loadError}</p>
        <button
          className="study-primary"
          onClick={() => setLoadAttempt(prev => prev + 1)}
        >
          <RefreshCw size={17}/> Retry connection
        </button>
        <p style={{ fontSize: 12 }}>
          Your existing browser data has not been deleted.
        </p>
      </main>
    );
  }

  return (
    <main className="study-app">
      <aside className={`study-sidebar ${menu ? "open" : ""}`}>
        <div className="study-brand">
          <div className="study-logo">S</div>
          <div><b>STUDY</b><span>PLANNER OS</span></div>
          <button className="close-menu" onClick={() => setMenu(false)}><X/></button>
        </div>

        <div className="study-label">MY WORKSPACE</div>

        <button
          className={view === "dashboard" ? "study-nav active" : "study-nav"}
          onClick={() => {
            setView("dashboard");
            setSelected(null);
            setMenu(false);
          }}
        >
          <LayoutDashboard/> Dashboard
        </button>

        <button
          className={view === "public" ? "study-nav active" : "study-nav"}
          onClick={() => {
            setView("public");
            setSelected(null);
            setMenu(false);
          }}
        >
          <BookOpen/> My Subjects
        </button>

        <div className="study-sidebar-bottom">
          <GraduationCap size={25}/>
          <b>One chapter at a time.</b>
          <p>Consistency is the key to completing your syllabus.</p>

          <div className="sidebar-mini-progress">
            <span>YOUR PROGRESS</span>
            <b>{progress}%</b>
            <i><span style={{ width: `${progress}%` }}/></i>
          </div>
        </div>
      </aside>

      {menu && <div className="study-overlay" onClick={() => setMenu(false)}/>}

      <section className="study-main">
        <header className="study-topbar">
          <button className="open-menu" onClick={() => setMenu(true)}><Menu/></button>

          <span>
            MY STUDY SPACE / {view === "dashboard" ? "OVERVIEW" : "SUBJECT LIBRARY"}
          </span>

          <div className="study-top-right">
            <i/> PERSONAL STUDY TRACKER

            <span style={{
              marginLeft: 12,
              padding: "6px 11px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              background: syncStatus === "error" ? "#fde8e7" : "#e7f2e9",
              color: syncStatus === "error" ? "#b42318" : "#315d49"
            }}>
              {syncStatus === "loading" ? "CONNECTING..." :
               syncStatus === "saving" ? "SAVING..." :
               syncStatus === "synced" ? "\u2601 CLOUD SYNCED" :
               "SYNC ERROR"}
            </span>
          </div>
        </header>

        <div className="study-content">
          {view === "dashboard" && <>
            <div className="analytics-hero">
              <div>
                <span className="study-eyebrow">
                  <Sparkles size={13}/> PERSONAL STUDY TRACKER
                </span>
                <h1><em>SACHIN</em><br/>CHAUDHARY</h1>

                <div className="hero-actions">
                  <button className="study-primary" onClick={() => {
                    document.getElementById("add-subject-form")?.scrollIntoView({
                      behavior: "smooth"
                    });
                  }}>
                    <Plus/> Add New Subject
                  </button>

                  <button className="study-secondary" onClick={() => setView("public")}>
                    <BookOpen/> Explore Subjects
                  </button>
                </div>
              </div>

              <div className="hero-date">
                <CalendarDays size={19}/>
                <span>{new Date().toLocaleDateString("en-IN", {
                  weekday: "long", day: "numeric", month: "long", year: "numeric"
                })}</span>
                <b>{subjects.length ? "KEEP THE MOMENTUM" : "YOUR JOURNEY STARTS HERE"}</b>
              </div>
            </div>

            <div className="study-stats">
              <div><BookOpen/><span>TOTAL SUBJECTS</span><b>{subjects.length}</b><small>In your library</small></div>
              <div><Layers/><span>TOTAL CHAPTERS</span><b>{total}</b><small>Across all subjects</small></div>
              <div><CheckCircle2/><span>COMPLETED</span><b>{done}</b><small>{pending} still remaining</small></div>
              <div><Target/><span>OVERALL PROGRESS</span><b>{progress}%</b><small>All chapters combined</small></div>
            </div>

            <div className="analytics-grid">
              <section className="study-panel ring-panel">
                <div className="analytics-panel-heading">
                  <div>
                    <span className="study-eyebrow">YOUR BIG PICTURE</span>
                    <h2>Overall progress</h2>
                  </div>
                  <span className="analytics-icon"><TrendingUp/></span>
                </div>

                <div className="ring-layout">
                  <div className="progress-ring" style={{
                    background: `conic-gradient(#315d49 ${progress * 3.6}deg, #e9e8df 0deg)`
                  }}>
                    <div><b>{progress}%</b><span>COMPLETED</span></div>
                  </div>

                  <div className="ring-legend">
                    <div><i className="legend-done"/><span>Completed</span><b>{done}</b></div>
                    <div><i className="legend-pending"/><span>Remaining</span><b>{pending}</b></div>
                    <div className="ring-total"><span>Total chapters</span><b>{total}</b></div>
                  </div>
                </div>

                <div className="ring-footnote">
                  {total === 0 ? "Add your first subject to begin tracking." :
                    progress === 100 ? "Excellent! Every chapter is complete." :
                    `${pending} chapters between you and your goal. Keep going!`}
                </div>
              </section>

              <section className="study-panel activity-panel">
                <div className="analytics-panel-heading">
                  <div>
                    <span className="study-eyebrow">LAST 7 DAYS</span>
                    <h2>Study activity</h2>
                  </div>
                  <span className="activity-total"><b>{weeklyTotal}</b><small>completed</small></span>
                </div>

                <div className="activity-chart">
                  {weekActivity.map(day => {
                    const max = Math.max(1, ...weekActivity.map(d => d.count));
                    const height = day.count ? Math.max(9, day.count / max * 100) : 3;

                    return (
                      <div className="activity-day" key={day.key}>
                        <div className="activity-bar-wrap">
                          <span className="activity-value">{day.count || ""}</span>
                          <i style={{ height: `${height}%` }}/>
                        </div>
                        <span className="activity-label">{day.label}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="activity-insight">
                  <Activity size={16}/>
                  {weeklyTotal === 0
                    ? "Your completed chapters will appear here."
                    : `Your most productive day: ${bestDay.label} (${bestDay.count} chapters)`}
                </div>
              </section>
            </div>

            <section className="study-panel subject-analytics">
              <div className="analytics-panel-heading">
                <div>
                  <span className="study-eyebrow">SUBJECT BREAKDOWN</span>
                  <h2>Progress by subject</h2>
                </div>
                <button className="study-text-btn" onClick={() => setView("public")}>
                  View library <ChevronRight size={16}/>
                </button>
              </div>

              {subjectStats.length === 0 ? (
                <div className="analytics-empty">
                  <BookOpen/>
                  <b>Your subject analytics will appear here</b>
                  <span>Add a subject to start tracking progress.</span>
                </div>
              ) : (
                <div className="subject-analytics-list">
                  {subjectStats.slice(0, 7).map(s => (
                    <button
                      className="subject-analytics-row"
                      key={s.id}
                      onClick={() => {
                        setSelected(s.id);
                        setView("public");
                      }}
                    >
                      <span className="subject-analytics-name">{s.title}</span>
                      <span className="subject-analytics-track">
                        <i style={{ width: `${s.percent}%` }}/>
                      </span>
                      <span className="subject-analytics-count">{s.completed}/{s.count}</span>
                      <b>{s.percent}%</b>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <div className="dashboard-bottom-grid">
              <section className="study-panel recent-panel">
                <div className="analytics-panel-heading">
                  <div>
                    <span className="study-eyebrow">YOUR LATEST WINS</span>
                    <h2>Recently completed</h2>
                  </div>
                  <Clock3/>
                </div>

                {recentCompletions.length === 0 ? (
                  <div className="recent-empty">
                    Completed chapters will show up here with their dates.
                  </div>
                ) : recentCompletions.map(item => (
                  <div className="recent-item" key={item.id}>
                    <span className="recent-check"><CheckCircle2 size={17}/></span>
                    <div><b>{item.title}</b><span>{item.subject}</span></div>
                    <time>{new Date(item.completedAt).toLocaleDateString("en-IN", {
                      day: "numeric", month: "short"
                    })}</time>
                  </div>
                ))}
              </section>

              <section className="study-panel data-panel">
                <div className="analytics-panel-heading">
                  <div>
                    <span className="study-eyebrow">YOUR FILES</span>
                    <h2>Data & backup</h2>
                  </div>
                  <Download/>
                </div>

                <p>Keep a copy of your study progress or move it to another device.</p>

                <button onClick={exportBackup}>
                  <Download size={17}/> Download full backup
                </button>

                <button onClick={exportCSV}>
                  <FileSpreadsheet size={17}/> Export progress CSV
                </button>

                <label className="data-import">
                  <Upload size={17}/> Restore from backup
                  <input type="file" accept=".json" onChange={importBackup}/>
                </label>
              </section>
            </div>

            <section className="study-panel add-subject-panel" id="add-subject-form">
              <div className="analytics-panel-heading">
                <div>
                  <span className="study-eyebrow">BUILD YOUR LIBRARY</span>
                  <h2>Add a new subject</h2>
                </div>
                <span className="analytics-icon"><Plus/></span>
              </div>

              <label className="study-field">
                <span>SUBJECT NAME</span>
                <input
                  value={subjectTitle}
                  onChange={e => setSubjectTitle(e.target.value)}
                  placeholder="Example: Indian Polity"
                />
              </label>

              <label className="study-field">
                <span>CHAPTER LIST Â· ONE CHAPTER PER LINE</span>
                <textarea
                  rows={6}
                  value={chapterText}
                  onChange={e => setChapterText(e.target.value)}
                  placeholder={"Paste your chapter list here...\n\nHistorical Background\nMaking of the Constitution\nFundamental Rights\nDirective Principles"}
                />
              </label>

              <div className="chapter-preview-head">
                <b>LIVE PREVIEW</b>
                <span>{preview.length} CHAPTERS DETECTED</span>
              </div>

              {preview.length > 0 ? (
                <div className="chapter-preview">
                  {preview.slice(0, 8).map((name, i) => (
                    <div key={`${i}-${name}`}>
                      <span>{String(i + 1).padStart(2, "0")}</span>{name}
                    </div>
                  ))}
                  {preview.length > 8 && (
                    <div className="preview-more">
                      + {preview.length - 8} more chapters
                    </div>
                  )}
                </div>
              ) : (
                <div className="study-empty-preview">
                  Your chapter preview will appear here as you type.
                </div>
              )}

              <button
                className="study-primary upload-subject"
                disabled={!subjectTitle.trim() || preview.length === 0}
                onClick={addSubject}
              >
                <Plus/> CREATE SUBJECT Â· {preview.length} CHAPTERS
              </button>
            </section>

            <div className="study-section-title">
              <div>
                <span className="study-eyebrow">YOUR COLLECTION</span>
                <h2>My subjects</h2>
              </div>
              <button className="study-text-btn" onClick={() => setView("public")}>
                View all <ChevronRight size={16}/>
              </button>
            </div>

            {subjects.length === 0 ? <EmptyStudy/> : (
              <div className="subject-grid">
                {subjects.slice(0, 4).map(s => (
                  <SubjectCard
                    key={s.id}
                    subject={s}
                    open={() => {
                      setSelected(s.id);
                      setView("public");
                    }}
                    remove={() => deleteSubject(s.id)}
                  />
                ))}
              </div>
            )}
          </>}

          {view === "public" && <>
            {current ? <>
              <button className="study-back" onClick={() => setSelected(null)}>
                <ArrowLeft/> Back to Subjects
              </button>

              <div className="study-heading">
                <div>
                  <span className="study-eyebrow">SUBJECT / CHAPTER TRACKER</span>
                  <h1>{current.title}</h1>
                  <p>Tick each chapter when you have completed your study.</p>
                </div>

                <button className="danger-btn" onClick={() => deleteSubject(current.id)}>
                  <Trash2 size={16}/> Delete subject
                </button>
              </div>

              <section className="study-panel add-chapters-inline">
                <div className="analytics-panel-heading">
                  <div>
                    <span className="study-eyebrow">EXPAND YOUR SYLLABUS</span>
                    <h2>Add more chapters</h2>
                  </div>
                  <Plus/>
                </div>

                <textarea
                  className="extra-chapters"
                  rows={4}
                  placeholder={"Paste additional chapters, one per line..."}
                  value={chapterText}
                  onChange={e => setChapterText(e.target.value)}
                />

                <div className="add-chapters-footer">
                  <span>{preview.length} new chapters detected</span>
                  <button
                    className="study-primary"
                    disabled={!preview.length}
                    onClick={addMoreChapters}
                  >
                    <Plus/> Add chapters
                  </button>
                </div>
              </section>

              <ChapterList
                subject={current}
                toggle={toggleChapter}
                remove={deleteChapter}
              />
            </> : <>
              <div className="study-heading">
                <div>
                  <span className="study-eyebrow">YOUR STUDY LIBRARY</span>
                  <h1>My <em>Subjects.</em></h1>
                  <p>Every subject, every chapter, one organized space.</p>
                </div>

                <button
                  className="study-primary"
                  onClick={() => {
                    setView("dashboard");
                    setTimeout(() => {
                      document.getElementById("add-subject-form")?.scrollIntoView({
                        behavior: "smooth"
                      });
                    }, 50);
                  }}
                >
                  <Plus/> Add Subject
                </button>
              </div>

              <div className="study-search">
                <Search/>
                <input
                  placeholder="Search your subjects..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              {filteredSubjects.length === 0 ? <EmptyStudy/> : (
                <div className="subject-grid">
                  {filteredSubjects.map(s => (
                    <SubjectCard
                      key={s.id}
                      subject={s}
                      open={() => setSelected(s.id)}
                      remove={() => deleteSubject(s.id)}
                    />
                  ))}
                </div>
              )}
            </>}
          </>}

          <footer className="study-footer">
            MY STUDY PLANNER <span>â€¢</span> LEARN. TRACK. COMPLETE.
          </footer>
        </div>
      </section>
    </main>
  );
}

function SubjectCard({ subject, open, remove }: {
  subject: Subject;
  open: () => void;
  remove?: () => void;
}) {
  const done = subject.chapters.filter(c => c.completed).length;
  const total = subject.chapters.length;
  const percent = total ? Math.round(done / total * 100) : 0;

  return (
    <div
      className="subject-card"
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === "Enter") open();
      }}
    >
      <div className="subject-card-top">
        <div className="subject-book-icon"><BookOpen/></div>
        <ChevronRight/>

        {remove && (
          <button
            type="button"
            className="danger-btn"
            title="Delete Subject"
            aria-label={`Delete ${subject.title}`}
            onClick={e => {
              e.stopPropagation();
              remove();
            }}
          >
            <Trash2 size={16}/>
          </button>
        )}
      </div>

      <h3>{subject.title}</h3>

      <div className="subject-card-meta">
        <span>{total} CHAPTERS</span>
        <b>{percent}%</b>
      </div>

      <div className="study-progress small">
        <i style={{ width: `${percent}%` }}/>
      </div>

      <p>{done} completed Â· {total - done} remaining</p>
    </div>
  );
}

function ChapterList({ subject, toggle, remove }: {
  subject: Subject;
  toggle: (s: string, c: string) => void;
  remove: (s: string, c: string) => void;
}) {
  const done = subject.chapters.filter(c => c.completed).length;

  const percent = subject.chapters.length
    ? Math.round(done / subject.chapters.length * 100)
    : 0;

  return (
    <section className="study-panel chapter-panel">
      <div className="study-panel-head">
        <div>
          <span className="study-eyebrow">CHAPTER CHECKLIST</span>
          <h2>{subject.title}</h2>
        </div>
        <b className="progress-number">{percent}%</b>
      </div>

      <div className="study-progress">
        <i style={{ width: `${percent}%` }}/>
      </div>

      <div className="chapter-count">
        {done} of {subject.chapters.length} chapters completed
      </div>

      {subject.chapters.map((c, i) => (
        <div
          className={`chapter-row ${c.completed ? "chapter-done" : ""}`}
          key={c.id}
        >
          <button
            className="chapter-check"
            onClick={() => toggle(subject.id, c.id)}
            aria-label={c.completed ? "Mark as pending" : "Mark as completed"}
          >
            {c.completed ? <CheckCircle2/> : <Circle/>}
          </button>

          <span className="chapter-number">
            {String(i + 1).padStart(2, "0")}
          </span>

          <span className="chapter-name">{c.title}</span>

          <span className="chapter-status">
            {c.completed ? "DONE" : "PENDING"}
          </span>

          <button
            className="chapter-delete"
            onClick={() => remove(subject.id, c.id)}
            aria-label={`Delete ${c.title}`}
          >
            <Trash2/>
          </button>
        </div>
      ))}
    </section>
  );
}

function EmptyStudy() {
  return (
    <div className="study-empty">
      <BookOpen size={32}/>
      <b>No subjects added yet</b>
      <p>Use the Add New Subject section to build your study library.</p>
    </div>
  );
}





