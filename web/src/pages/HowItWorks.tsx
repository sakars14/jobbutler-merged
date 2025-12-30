// src/pages/HowItWorks.tsx
export default function HowItWorks() {
  return (
    <main className="page">
      <section className="hero hero-compact">
        <h1>How it works</h1>
        <p className="muted">
          Job Butler blends persona-driven search (roles, skills, locations) with seed links
          (company careers, ATS boards, curated lists) and email ingests to unify your leads
          into a single, clean list — ranked by recency, similarity and de-duplication.
        </p>
      </section>

      <section className="features">
        <div className="feature">
          <h3>1) Tell us your persona</h3>
          <p>Pick roles, must-have skills and locations. Save once, reuse everywhere.</p>
        </div>
        <div className="feature">
          <h3>2) Add seeds</h3>
          <p>Paste company or board URLs. We harvest and keep them fresh.</p>
        </div>
        <div className="feature">
          <h3>3) Search & apply</h3>
          <p>Filter by keyword/source, open matched roles, track progress.</p>
        </div>
      </section>
    </main>
  );
}
