// src/pages/Support.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { api } from "../lib/api";

type SupportRequestItem = {
  id: string;
  createdAt: Date | null;
  sortKey: number;
};

export default function Support() {
  const nav = useNavigate();
  const prefillDone = useRef(false);

  const [uid, setUid] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+91");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    phone?: string;
    message?: string;
  }>({});

  const [requests, setRequests] = useState<SupportRequestItem[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsErr, setRequestsErr] = useState<string | null>(null);

  const markEdited = () => {
    prefillDone.current = true;
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      nav(-1);
    } else {
      nav("/dashboard");
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUid(null);
        nav("/login");
        return;
      }
      setUid(u.uid);
    });
    return () => unsub();
  }, [nav]);

  useEffect(() => {
    if (!uid) return;
    setRequestsLoading(true);
    setRequestsErr(null);

    const q = query(
      collection(db, "supportRequests"),
      where("uid", "==", uid)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => {
          const data = d.data() as any;
          const createdAt = data?.createdAt?.toDate
            ? data.createdAt.toDate()
            : data?.createdAt
            ? new Date(data.createdAt)
            : null;
          const sortKey = data?.createdAt?.toMillis
            ? data.createdAt.toMillis()
            : data?.createdAt?.seconds
            ? data.createdAt.seconds * 1000
            : createdAt
            ? createdAt.getTime()
            : 0;
          return { id: d.id, createdAt, sortKey };
        });

        items.sort((a, b) => b.sortKey - a.sortKey);
        setRequests(items.slice(0, 20));
        setRequestsLoading(false);
      },
      (error) => {
        console.error("Failed to load support requests", error);
        setRequestsErr("Could not load requests.");
        setRequests([]);
        setRequestsLoading(false);
      }
    );

    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (!uid || prefillDone.current) return;
    const u = auth.currentUser;

    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) return;
        if (prefillDone.current) return;

        const data = snap.data() as any;
        prefillDone.current = true;

        setName(data.fullName || data.name || "");
        setEmail(data.email || "");

        const authPhone = u?.phoneNumber || "";
        const profilePhone = data.phoneNumber || "";
        setPhone(authPhone || profilePhone || "+91");
      } catch {
        // ignore prefill errors
      }
    })();
  }, [uid]);

  const validate = () => {
    const next: { name?: string; phone?: string; message?: string } = {};
    if (!name.trim()) next.name = "Name is required.";
    if (!phone.trim()) next.phone = "Phone is required.";
    if (!msg.trim()) next.message = "Message is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    setOk(null);
    setSubmitErr(null);
    if (!validate()) return;
    if (!uid) {
      setSubmitErr("Please sign in to submit a support request.");
      return;
    }

    setSaving(true);
    const createdAtISO = new Date().toISOString();
    const trimmed = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      message: msg.trim(),
    };

    try {
      await addDoc(collection(db, "supportRequests"), {
        uid,
        name: trimmed.name,
        phone: trimmed.phone,
        email: trimmed.email || null,
        message: trimmed.message,
        createdAt: serverTimestamp(),
        status: "submitted",
      });

      setMsg("");
      setErrors((prev) => ({ ...prev, message: undefined }));

      try {
        const res = await api.post("/support/notify", {
          uid,
          name: trimmed.name,
          phone: trimmed.phone,
          email: trimmed.email || null,
          message: trimmed.message,
          createdAtISO,
        });
        if (res.data?.ok === false) {
          console.warn("Support notify not configured", res.data);
        }
      } catch {
        console.warn("Support notify failed");
      }

      setOk("Request submitted.");

    } catch {
      setSubmitErr("Could not submit right now. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="page">
      <div className="auth-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <header className="signup-card-header">
            <button
              type="button"
              className="back-arrow"
              onClick={handleBack}
              aria-label="Back to home"
            >
              ←
            </button>
          </header>
        </div>

        <h1>Support</h1>
        <p className="muted">Share feedback or issues. We will get back soon.</p>

        <div className="grid" style={{ gap: 12 }}>
          <div className="stack">
            <label>Name *</label>
            <input
              value={name}
              onChange={(e) => {
                markEdited();
                setName(e.target.value);
              }}
              required
            />
            {errors.name && <div className="error">{errors.name}</div>}
          </div>

          <div className="stack">
            <label>Email (optional)</label>
            <input
              value={email}
              onChange={(e) => {
                markEdited();
                setEmail(e.target.value);
              }}
            />
          </div>

          <div className="stack">
            <label>Phone *</label>
            <input
              value={phone}
              onChange={(e) => {
                markEdited();
                setPhone(e.target.value);
              }}
              required
            />
            {errors.phone && <div className="error">{errors.phone}</div>}
          </div>
        </div>

        <div className="stack" style={{ marginTop: 12 }}>
          <label>Message *</label>
          <textarea
            rows={4}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            required
          />
          {errors.message && <div className="error">{errors.message}</div>}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="dash-pill auth-pill"
            type="button"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "Submitting..." : "Submit"}
          </button>
          <button
            className="dash-pill"
            type="button"
            onClick={() => {
              setMsg("");
              setErrors((prev) => ({ ...prev, message: undefined }));
              setSubmitErr(null);
              setOk(null);
            }}
          >
            Clear
          </button>
        </div>

        {submitErr && <div className="error">{submitErr}</div>}
        {ok && <div className="dash-muted">{ok}</div>}

        <div style={{ marginTop: 24 }}>
          <h2>Requests</h2>
          {requestsLoading ? (
            <div className="dash-muted">Loading requests...</div>
          ) : requestsErr ? (
            <div className="error">{requestsErr}</div>
          ) : requests.length === 0 ? (
            <div className="dash-muted">No support requests yet.</div>
          ) : (
            requests.map((r) => {
              const when = r.createdAt
                ? r.createdAt.toLocaleString()
                : "just now";
              return (
                <div key={r.id} className="dash-muted" style={{ marginTop: 8 }}>
                  Request submitted on {when}. It will be addressed in 48 hours.
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
