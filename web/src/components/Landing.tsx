// src/components/Landing.tsx
import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <main className="landing">
      <section className="hero">
        <div className="label">AI-assisted job search</div>
        <h1 className="display">
          Precision AI search<br />for job seekers.
        </h1>
        <p className="lede">
          Job Butler finds roles that match your skills and intent — blending curated sources,
          smart filtering, and seed boosts from links you love. Track, score, and apply
          faster with a clean, distraction-free workflow.
        </p>

        <div className="hero-actions">
          <Link to="/login" className="btn dark">Login to get started</Link>
          <Link to="/how-it-works" className="btn">See how it works</Link>
        </div>
      </section>

      <section className="info-cards">
        <div className="card soft">
          <h3>Built to match you</h3>
          <p>
            Persona-driven search (roles, skills, locations) + seed links to over-index on your
            favorite companies. Ranked results keep your focus sharp, email digests keep you in the loop.
          </p>
        </div>
        <div className="card soft">
          <h3>Sources, unified</h3>
          <p>
            RemoteOK, Adzuna, Greenhouse/Lever boards — plus Naukri/LinkedIn mail ingests.
            One clean list, de-duplicated and scored for recency, relevance, and seed similarity.
          </p>
        </div>
      </section>
    </main>
  );
}
